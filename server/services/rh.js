'use strict';
// Módulo RH / DP: espelho de ponto, banco de horas, assiduidade, atestados,
// férias, 13º, comissão do grid, EPI e fechamento mensal.

const crud = require('../crud');
const auth = require('../auth');
const core = require('./core');
const { paramNum } = require('../db');
const {
  HttpError, hm, minToHm, round2, num, sum, today, addDays, addYears, addMonths, diffDays,
  monthStart, monthEnd, competencia, onlyDigits, parseDate, weekday,
} = require('../util');

const NOTURNO_INI = 22 * 60;
const NOTURNO_FIM = 5 * 60;

// Minutos dentro do intervalo noturno (22h–5h) entre a e b (b pode passar da meia-noite)
function minutosNoturnos(a, b) {
  if (a == null || b == null) return 0;
  if (b < a) b += 1440;
  let n = 0;
  for (const [ini, fim] of [[0, NOTURNO_FIM], [NOTURNO_INI, 1440 + NOTURNO_FIM], [1440 + NOTURNO_INI, 2880]]) {
    n += Math.max(0, Math.min(b, fim) - Math.max(a, ini));
  }
  return n;
}

function span(a, b) {
  if (a == null || b == null) return 0;
  return b >= a ? b - a : b + 1440 - a;
}

// Cálculo de um dia de ponto
function calcularDia(p, func, tol = 10) {
  const jornada = num(func?.jornada_min) || 440;
  const out = { trabalhado: 0, previsto: 0, atraso: 0, extra50: 0, extra100: 0, noturno: 0, saldo: 0, falta: 0 };
  const oc = p.ocorrencia || 'normal';
  if (['folga', 'ferias', 'atestado', 'falta_justificada'].includes(oc)) return out;
  out.previsto = jornada;
  if (oc === 'falta_injustificada') {
    out.falta = 1;
    out.saldo = -jornada;
    return out;
  }
  const e = hm(p.entrada), si = hm(p.saida_intervalo), ri = hm(p.retorno_intervalo), s = hm(p.saida);
  if (e == null || s == null) {
    // marcação incompleta: não computa saldo até correção
    return { ...out, incompleto: true };
  }
  let trabalhado;
  let noturnoReal;
  if (si != null && ri != null) {
    trabalhado = span(e, si) + span(ri, s);
    noturnoReal = minutosNoturnos(e, si) + minutosNoturnos(ri, s);
  } else {
    trabalhado = span(e, s);
    noturnoReal = minutosNoturnos(e, s);
  }
  out.trabalhado = trabalhado;
  // hora noturna reduzida: 52min30s equivalem a 60min
  out.noturno = Math.round(noturnoReal * 60 / 52.5);
  const entradaPrevista = hm(func?.horario_entrada);
  if (entradaPrevista != null) {
    const atraso = e - entradaPrevista;
    if (atraso > 0 && atraso < 600 && atraso > tol) out.atraso = atraso;
  }
  if (p.feriado) {
    out.extra100 = trabalhado;
    out.saldo = 0;
    return out;
  }
  const dif = trabalhado - jornada;
  if (Math.abs(dif) <= tol) return out; // variações dentro da tolerância não contam
  if (dif > 0) out.extra50 = dif;
  out.saldo = dif;
  return out;
}

function espelho(ctx, funcionarioId, comp = competencia(today())) {
  const func = crud.raw(ctx.db, 'funcionarios', funcionarioId);
  if (!func) throw new HttpError(404, 'Funcionário não encontrado');
  if (auth.selfOnly(ctx.user, 'ponto') || !auth.canRead(ctx.user, 'ponto')) {
    if (ctx.user.funcionario_id !== Number(funcionarioId)) throw new HttpError(403, 'Sem permissão');
  }
  const de = comp + '-01';
  const ate = monthEnd(de);
  const tol = paramNum(ctx.db, 'tolerancia_ponto_min', 10);
  const dias = ctx.db.prepare('SELECT * FROM ponto WHERE funcionario_id = ? AND data BETWEEN ? AND ? ORDER BY data').all(funcionarioId, de, ate)
    .map((p) => ({ ...p, calc: calcularDia(p, func, tol) }));
  const tot = { trabalhado: 0, previsto: 0, atraso: 0, extra50: 0, extra100: 0, noturno: 0, saldo: 0, faltas: 0, faltas_justificadas: 0, atestados: 0, atrasos: 0, saidas_antecipadas: 0 };
  for (const d of dias) {
    for (const k of ['trabalhado', 'previsto', 'atraso', 'extra50', 'extra100', 'noturno', 'saldo']) tot[k] += d.calc[k];
    tot.faltas += d.calc.falta;
    if (d.ocorrencia === 'falta_justificada') tot.faltas_justificadas++;
    if (d.ocorrencia === 'atestado') tot.atestados++;
    if (d.calc.atraso) tot.atrasos++;
    if (d.calc.saldo < 0 && !d.calc.falta) tot.saidas_antecipadas++;
  }
  const escalados = dias.filter((d) => !['folga', 'ferias'].includes(d.ocorrencia)).length;
  tot.assiduidade = escalados ? round2(100 * (1 - (tot.faltas + tot.faltas_justificadas + tot.atestados) / escalados)) : 100;
  return { funcionario: { id: func.id, nome: func.nome, funcao: func.funcao, jornada_min: func.jornada_min, escala_tipo: func.escala_tipo }, competencia: comp, dias, totais: tot };
}

// Banco de horas acumulado de todos os meses
function bancoHoras(ctx, funcionarioId) {
  const func = crud.raw(ctx.db, 'funcionarios', funcionarioId);
  const tol = paramNum(ctx.db, 'tolerancia_ponto_min', 10);
  const rows = ctx.db.prepare('SELECT * FROM ponto WHERE funcionario_id = ?').all(funcionarioId);
  return rows.reduce((a, p) => a + calcularDia(p, func, tol).saldo, 0);
}

function resumoEquipe(ctx, comp = competencia(today())) {
  auth.requireRead(ctx.user, 'ponto');
  const funcs = ctx.db.prepare(`SELECT * FROM funcionarios WHERE ativo = 1 ${ctx.postoId ? 'AND posto_id = ?' : ''} ORDER BY nome`)
    .all(...(ctx.postoId ? [ctx.postoId] : []));
  const limiteMes = paramNum(ctx.db, 'limite_he_mes_min', 2640);
  const de12 = addMonths(comp + '-01', -11);
  const faltas12 = new Map(ctx.db.prepare(`SELECT funcionario_id, COUNT(*) AS n FROM ponto WHERE ocorrencia = 'falta_injustificada' AND data >= ? GROUP BY funcionario_id`)
    .all(de12).map((x) => [x.funcionario_id, x.n]));
  const linhas = funcs.map((f) => {
    const e = espelho(ctx, f.id, comp);
    return {
      funcionario_id: f.id, nome: f.nome, funcao: f.funcao, ...e.totais,
      faltas_12m: faltas12.get(f.id) || 0,
      banco_horas: bancoHoras(ctx, f.id),
      excesso_he: e.totais.extra50 + e.totais.extra100 > limiteMes,
    };
  });
  const media = linhas.length ? round2(sum(linhas, (l) => l.assiduidade) / linhas.length) : 100;
  return { competencia: comp, linhas, assiduidade_equipe: media, limite_he_mes_min: limiteMes };
}

// ------------------------------------------------------------------ AFD (relógio de ponto)
// Aceita o layout antigo (Portaria 1510: NSR, tipo 3, ddmmaaaa, hhmm, PIS)
// e o layout da Portaria 671 (NSR, tipo 3, data/hora ISO, CPF).
function parseAfd(texto) {
  const marcas = [];
  for (const raw of String(texto).split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.length < 22 || line[9] !== '3') continue;
    if (line[14] === '-' && line[20] === 'T') {
      const dt = line.slice(10, 34);
      marcas.push({ data: dt.slice(0, 10), hora: dt.slice(11, 16), id: onlyDigits(line.slice(34, 46)) });
    } else {
      const d = line.slice(10, 18);
      marcas.push({ data: `${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}`, hora: `${line.slice(18, 20)}:${line.slice(20, 22)}`, id: onlyDigits(line.slice(22, 34)) });
    }
  }
  return marcas;
}

function importarAfd(ctx, texto) {
  auth.requireWrite(ctx.user, 'ponto');
  const marcas = parseAfd(texto);
  const funcs = ctx.db.prepare('SELECT id, cpf, pis FROM funcionarios').all();
  const porDoc = new Map();
  for (const f of funcs) {
    if (f.cpf) porDoc.set(onlyDigits(f.cpf).replace(/^0+/, ''), f.id);
    if (f.pis) porDoc.set(onlyDigits(f.pis).replace(/^0+/, ''), f.id);
  }
  const grupos = new Map();
  const naoIdentificados = new Set();
  for (const m of marcas) {
    const fid = porDoc.get(m.id.replace(/^0+/, ''));
    if (!fid) { naoIdentificados.add(m.id); continue; }
    const k = `${fid}|${m.data}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(m.hora);
  }
  let dias = 0;
  for (const [k, horas] of grupos) {
    const [fid, data] = k.split('|');
    horas.sort();
    const campos = horas.length >= 4
      ? { entrada: horas[0], saida_intervalo: horas[1], retorno_intervalo: horas[2], saida: horas[horas.length - 1] }
      : { entrada: horas[0], saida: horas.length > 1 ? horas[horas.length - 1] : null };
    const existe = ctx.db.prepare('SELECT id FROM ponto WHERE funcionario_id = ? AND data = ?').get(Number(fid), data);
    if (existe) crud.update(ctx, 'ponto', existe.id, { ...campos, origem: 'afd', ocorrencia: 'normal' }, { noAudit: true });
    else crud.create(ctx, 'ponto', { funcionario_id: Number(fid), data, ...campos, origem: 'afd', ocorrencia: 'normal' }, { noAudit: true });
    dias++;
  }
  crud.audit(ctx.db, ctx.user, 'importar_afd', 'ponto', null, null, { marcacoes: marcas.length, dias });
  return { marcacoes: marcas.length, dias_atualizados: dias, nao_identificados: [...naoIdentificados] };
}

// Registro de ponto pelo aplicativo (com geolocalização)
function baterPonto(ctx, { lat, lng }) {
  const fid = ctx.user.funcionario_id;
  if (!fid) throw new HttpError(400, 'Usuário sem funcionário vinculado');
  const data = today();
  const now = new Date();
  const hora = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const geo = lat != null ? `${lat},${lng}` : null;
  const p = ctx.db.prepare('SELECT * FROM ponto WHERE funcionario_id = ? AND data = ?').get(fid, data);
  const ordem = ['entrada', 'saida_intervalo', 'retorno_intervalo', 'saida'];
  if (!p) {
    crud.create(ctx, 'ponto', { funcionario_id: fid, data, entrada: hora, origem: 'app', geo, ocorrencia: 'normal' }, { internal: true });
    return { campo: 'entrada', hora };
  }
  const campo = ordem.find((c) => !p[c]);
  if (!campo) throw new HttpError(400, 'Todas as marcações do dia já foram feitas');
  crud.update(ctx, 'ponto', p.id, { [campo]: hora, origem: 'app', geo }, { internal: true });
  return { campo, hora };
}

// ------------------------------------------------------------------ Atestados
function atestadosInss(ctx) {
  const limite = paramNum(ctx.db, 'atestado_inss_dias', 15);
  const desde = addDays(today(), -60);
  return ctx.db.prepare(`SELECT a.funcionario_id, f.nome, SUM(a.dias) AS dias FROM atestados a JOIN funcionarios f ON f.id = a.funcionario_id
    WHERE a.data_inicio >= ? ${ctx.postoId ? 'AND a.posto_id = ?' : ''} GROUP BY a.funcionario_id HAVING SUM(a.dias) > ?`)
    .all(desde, ...(ctx.postoId ? [ctx.postoId] : []), limite);
}

// ------------------------------------------------------------------ Férias
function situacaoFerias(ctx, ref = today()) {
  const funcs = ctx.db.prepare(`SELECT * FROM funcionarios WHERE ativo = 1 AND admissao IS NOT NULL ${ctx.postoId ? 'AND posto_id = ?' : ''} ORDER BY nome`)
    .all(...(ctx.postoId ? [ctx.postoId] : []));
  const out = [];
  for (const f of funcs) {
    const ferias = ctx.db.prepare("SELECT * FROM ferias WHERE funcionario_id = ? AND status <> 'cancelada'").all(f.id);
    for (let ini = f.admissao; addYears(ini, 1) <= addDays(ref, 365 * 2); ini = addYears(ini, 1)) {
      const fimAquisitivo = addDays(addYears(ini, 1), -1);
      if (fimAquisitivo > addYears(ref, 1)) break;
      const limite = addDays(addYears(ini, 2), -1);
      const marcada = ferias.find((x) => x.aquisitivo_inicio === ini);
      if (marcada && marcada.status === 'gozada') continue;
      const completo = fimAquisitivo < ref;
      const diasLimite = diffDays(ref, limite);
      let situacao;
      if (marcada) situacao = 'programada';
      else if (!completo) situacao = 'em_aquisicao';
      else if (diasLimite < 0) situacao = 'vencida_dobro';
      else if (diasLimite <= 30) situacao = 'vence_30';
      else if (diasLimite <= 60) situacao = 'vence_60';
      else situacao = 'a_programar';
      if (situacao === 'em_aquisicao' && diffDays(ref, fimAquisitivo) > 90) continue;
      out.push({
        funcionario_id: f.id, nome: f.nome, funcao: f.funcao, aquisitivo_inicio: ini, aquisitivo_fim: fimAquisitivo,
        limite_concessivo: limite, dias_para_limite: diasLimite, situacao,
        programada_inicio: marcada?.inicio || null, programada_dias: marcada?.dias || null,
      });
    }
  }
  return out;
}

// Turnos descobertos: dias em que férias programadas deixam a equipe abaixo do mínimo
function conflitosFerias(ctx, ano = today().slice(0, 4)) {
  const ferias = ctx.db.prepare(`SELECT fe.*, f.nome, f.funcao FROM ferias fe JOIN funcionarios f ON f.id = fe.funcionario_id
    WHERE fe.status = 'programada' AND substr(fe.inicio,1,4) = ? ${ctx.postoId ? 'AND fe.posto_id = ?' : ''}`)
    .all(String(ano), ...(ctx.postoId ? [ctx.postoId] : []));
  const conflitos = [];
  for (let i = 0; i < ferias.length; i++) {
    for (let j = i + 1; j < ferias.length; j++) {
      const a = ferias[i], b = ferias[j];
      if (a.funcao !== b.funcao) continue;
      const fimA = addDays(a.inicio, (a.dias || 30) - 1), fimB = addDays(b.inicio, (b.dias || 30) - 1);
      if (a.inicio <= fimB && b.inicio <= fimA) {
        conflitos.push({ funcao: a.funcao, funcionarios: [a.nome, b.nome], de: a.inicio > b.inicio ? a.inicio : b.inicio, ate: fimA < fimB ? fimA : fimB });
      }
    }
  }
  return conflitos;
}

// ------------------------------------------------------------------ 13º salário
function decimoTerceiro(ctx, ano = Number(today().slice(0, 4))) {
  const funcs = ctx.db.prepare(`SELECT * FROM funcionarios WHERE ativo = 1 ${ctx.postoId ? 'AND posto_id = ?' : ''} ORDER BY nome`)
    .all(...(ctx.postoId ? [ctx.postoId] : []));
  const linhas = funcs.map((f) => {
    let avos = 0;
    for (let m = 1; m <= 12; m++) {
      const ini = `${ano}-${String(m).padStart(2, '0')}-01`;
      const fim = monthEnd(ini);
      const de = f.admissao > ini ? f.admissao : ini;
      const ate = f.demissao && f.demissao < fim ? f.demissao : fim;
      if (de <= ate && diffDays(de, ate) + 1 >= 15) avos++;
    }
    const remuneracao = round2(num(f.salario) * (f.periculosidade ? 1.3 : 1));
    const total = round2(remuneracao * avos / 12);
    return {
      funcionario_id: f.id, nome: f.nome, remuneracao, avos, total,
      parcela1: round2(total / 2), parcela2: round2(total - total / 2),
      provisao_mensal: round2(remuneracao / 12),
    };
  });
  return {
    ano, linhas,
    prazo_1: `${ano}-11-30`, prazo_2: `${ano}-12-20`,
    total: round2(sum(linhas, (l) => l.total)),
    provisao_mensal: round2(sum(linhas, (l) => l.provisao_mensal)),
  };
}

// ------------------------------------------------------------------ Comissão do grid
function comissoes(ctx, comp = competencia(today())) {
  const de = comp + '-01', ate = monthEnd(de);
  const rows = ctx.db.prepare(`SELECT v.funcionario_id, f.nome, f.meta_grid, v.produto_id, p.nome AS produto, p.comissao_pct, SUM(v.quantidade) AS qtd, SUM(v.valor) AS valor
    FROM vendas_grid v JOIN funcionarios f ON f.id = v.funcionario_id JOIN produtos p ON p.id = v.produto_id
    WHERE v.data BETWEEN ? AND ? ${ctx.postoId ? 'AND v.posto_id = ?' : ''}
    ${auth.selfOnly(ctx.user, 'vendas_grid') ? 'AND v.funcionario_id = ' + Number(ctx.user.funcionario_id || -1) : ''}
    GROUP BY v.funcionario_id, v.produto_id`).all(de, ate, ...(ctx.postoId ? [ctx.postoId] : []));
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.funcionario_id)) map.set(r.funcionario_id, { funcionario_id: r.funcionario_id, nome: r.nome, meta: num(r.meta_grid), vendas: 0, comissao: 0, itens: [] });
    const a = map.get(r.funcionario_id);
    const com = round2(r.valor * num(r.comissao_pct) / 100);
    a.vendas = round2(a.vendas + r.valor);
    a.comissao = round2(a.comissao + com);
    a.itens.push({ produto: r.produto, qtd: r.qtd, valor: round2(r.valor), pct: r.comissao_pct, comissao: com });
  }
  const ranking = [...map.values()].map((a) => ({ ...a, atingimento: a.meta ? round2(100 * a.vendas / a.meta) : null }))
    .sort((a, b) => b.vendas - a.vendas);
  return { competencia: comp, ranking, total_comissao: round2(sum(ranking, (r) => r.comissao)), total_vendas: round2(sum(ranking, (r) => r.vendas)) };
}

// ------------------------------------------------------------------ EPI
crud.registerHooks('epi_entregas', {
  beforeSave(ctx, data, old) {
    if (!old && data.item_id) {
      const item = crud.raw(ctx.db, 'epi_itens', data.item_id);
      if (item?.tipo === 'epi' && item.ca_validade && item.ca_validade < (data.data || today())) {
        throw new HttpError(400, `CA ${item.ca} do item "${item.nome}" está vencido — não entregue este EPI`);
      }
      if (!data.ca && item) data.ca = item.ca;
    }
    return data;
  },
  afterSave(ctx, row, old) {
    if (!old) ctx.db.prepare('UPDATE epi_itens SET estoque = COALESCE(estoque,0) - ? WHERE id = ?').run(num(row.quantidade) || 1, row.item_id);
  },
});

function fichasEpi(ctx) {
  const funcs = ctx.db.prepare(`SELECT id, nome, funcao FROM funcionarios WHERE ativo = 1 ${ctx.postoId ? 'AND posto_id = ?' : ''} ORDER BY nome`)
    .all(...(ctx.postoId ? [ctx.postoId] : []));
  return funcs.map((f) => {
    const entregas = ctx.db.prepare(`SELECT e.*, i.nome AS item, i.ca_validade, i.troca_dias, i.tipo FROM epi_entregas e JOIN epi_itens i ON i.id = e.item_id
      WHERE e.funcionario_id = ? ORDER BY e.data DESC`).all(f.id);
    const ultimaPorItem = new Map();
    for (const e of entregas) if (!ultimaPorItem.has(e.item_id)) ultimaPorItem.set(e.item_id, e);
    const pendencias = [];
    for (const e of ultimaPorItem.values()) {
      if (!e.assinado_at) pendencias.push(`${e.item}: entrega sem assinatura`);
      if (e.troca_dias && diffDays(e.data, today()) > e.troca_dias) pendencias.push(`${e.item}: troca periódica vencida`);
      if (e.tipo === 'epi' && e.ca_validade && e.ca_validade < today()) pendencias.push(`${e.item}: CA vencido`);
    }
    if (!entregas.length && /Frentista|Chefe|GNV|Lavador|Trocador/i.test(f.funcao || '')) pendencias.push('Sem ficha de EPI');
    return { funcionario_id: f.id, nome: f.nome, funcao: f.funcao, entregas: entregas.length, pendencias, em_dia: !pendencias.length };
  });
}

// ------------------------------------------------------------------ Linha do tempo
function linhaDoTempo(ctx, funcionarioId) {
  const sensivel = ['gerente', 'rh'].includes(ctx.user.perfil);
  const f = crud.raw(ctx.db, 'funcionarios', funcionarioId);
  if (!f) throw new HttpError(404, 'Funcionário não encontrado');
  const ev = [{ data: f.admissao, tipo: 'Admissão', texto: f.funcao }];
  if (f.demissao) ev.push({ data: f.demissao, tipo: 'Demissão', texto: '' });
  for (const a of ctx.db.prepare('SELECT * FROM advertencias WHERE funcionario_id = ?').all(funcionarioId)) {
    ev.push({ data: a.data, tipo: a.tipo === 'suspensao' ? `Suspensão (${a.dias_suspensao || 0} dias)` : 'Advertência', texto: a.motivo });
  }
  for (const t of ctx.db.prepare('SELECT * FROM treinamentos WHERE funcionario_id = ?').all(funcionarioId)) {
    ev.push({ data: t.data, tipo: 'Treinamento', texto: t.tipo });
  }
  for (const x of ctx.db.prepare("SELECT * FROM ferias WHERE funcionario_id = ? AND status <> 'cancelada'").all(funcionarioId)) {
    ev.push({ data: x.inicio, tipo: 'Férias', texto: `${x.dias} dias (${x.status})` });
  }
  if (sensivel) {
    for (const a of ctx.db.prepare('SELECT * FROM atestados WHERE funcionario_id = ?').all(funcionarioId)) {
      ev.push({ data: a.data_inicio, tipo: 'Atestado', texto: `${a.dias} dia(s)${a.cid ? ' — CID ' + a.cid : ''}` });
    }
    for (const a of ctx.db.prepare('SELECT * FROM asos WHERE funcionario_id = ?').all(funcionarioId)) {
      ev.push({ data: a.data, tipo: 'ASO', texto: `${a.tipo} — ${a.resultado || ''}` });
    }
  }
  for (const fc of ctx.db.prepare('SELECT * FROM faltas_caixa WHERE funcionario_id = ?').all(funcionarioId)) {
    ev.push({ data: fc.data, tipo: 'Falta de caixa', texto: `R$ ${fc.valor.toFixed(2)} — ${fc.tratamento}` });
  }
  const aud = ctx.db.prepare("SELECT * FROM auditoria WHERE tabela = 'funcionarios' AND registro_id = ? AND acao = 'alterar' ORDER BY id").all(funcionarioId);
  for (const a of aud) {
    try {
      const antes = JSON.parse(a.antes), depois = JSON.parse(a.depois);
      if (antes.funcao !== depois.funcao) ev.push({ data: a.at.slice(0, 10), tipo: 'Promoção / mudança de função', texto: `${antes.funcao} → ${depois.funcao}` });
      if (antes.salario !== depois.salario) ev.push({ data: a.at.slice(0, 10), tipo: 'Alteração salarial', texto: `R$ ${antes.salario} → R$ ${depois.salario}` });
    } catch { /* ignora */ }
  }
  return ev.filter((e) => e.data).sort((a, b) => (a.data < b.data ? 1 : -1));
}

// ------------------------------------------------------------------ Escalas
function conflitosEscala(ctx, de, ate) {
  const rows = ctx.db.prepare(`SELECT e.*, f.nome, f.escala_tipo, f.gnv_habilitado FROM escalas e JOIN funcionarios f ON f.id = e.funcionario_id
    WHERE e.data BETWEEN ? AND ? ${ctx.postoId ? 'AND e.posto_id = ?' : ''} ORDER BY e.funcionario_id, e.data`)
    .all(de, ate, ...(ctx.postoId ? [ctx.postoId] : []));
  const avisos = [];
  const porFunc = new Map();
  for (const r of rows) {
    if (!porFunc.has(r.funcionario_id)) porFunc.set(r.funcionario_id, []);
    porFunc.get(r.funcionario_id).push(r);
  }
  for (const [, dias] of porFunc) {
    let seguidos = 0;
    let prev = null;
    const datas = new Map();
    for (const d of dias) {
      if (datas.has(d.data) && d.turno !== 'folga' && datas.get(d.data) !== 'folga') avisos.push({ data: d.data, nome: d.nome, aviso: 'Escalado em dois turnos no mesmo dia' });
      datas.set(d.data, d.turno);
      if (d.turno === 'folga') { seguidos = 0; prev = d.data; continue; }
      seguidos = prev && diffDays(prev, d.data) === 1 ? seguidos + 1 : 1;
      prev = d.data;
      if (seguidos === 7) avisos.push({ data: d.data, nome: d.nome, aviso: '7º dia seguido sem folga (DSR)' });
      if (d.gnv && !d.gnv_habilitado) avisos.push({ data: d.data, nome: d.nome, aviso: 'Escalado no GNV sem habilitação' });
    }
    // domingos trabalhados seguidos (folga em domingo ao menos 1x a cada 3 semanas — comércio, Lei 10.101)
    const domingos = dias.filter((d) => weekday(d.data) === 0);
    let seq = 0;
    for (const d of domingos) {
      seq = d.turno === 'folga' ? 0 : seq + 1;
      if (seq === 3) avisos.push({ data: d.data, nome: d.nome, aviso: '3º domingo seguido trabalhado' });
    }
  }
  return avisos;
}

core.onApproval('troca_folga', {
  aprovar(ctx, ap) {
    const t = crud.raw(ctx.db, 'trocas_folga', ap.ref_id);
    crud.update(ctx, 'trocas_folga', ap.ref_id, { status: 'aprovada' }, { internal: true });
    const folga = ctx.db.prepare("SELECT id FROM escalas WHERE funcionario_id = ? AND data = ? AND turno = 'folga'").get(t.funcionario_id, t.data_folga);
    const nova = ctx.db.prepare('SELECT * FROM escalas WHERE funcionario_id = ? AND data = ?').get(t.funcionario_id, t.data_nova);
    if (folga && nova) {
      ctx.db.prepare('UPDATE escalas SET turno = ? WHERE id = ?').run(nova.turno, folga.id);
      ctx.db.prepare("UPDATE escalas SET turno = 'folga' WHERE id = ?").run(nova.id);
    }
  },
  recusar: (ctx, ap) => crud.update(ctx, 'trocas_folga', ap.ref_id, { status: 'recusada' }, { internal: true }),
});

crud.registerHooks('trocas_folga', {
  beforeSave(ctx, data, old) {
    const gestor = ['gerente', 'rh'].includes(ctx.user.perfil);
    if (!old && !gestor) data.funcionario_id = ctx.user.funcionario_id;
    if (old && !gestor && old.funcionario_id !== ctx.user.funcionario_id) throw new HttpError(403, 'Pedido de outro funcionário');
    if (old && data.status && data.status !== old.status && ctx.user.perfil !== 'gerente') {
      throw new HttpError(403, 'A troca de folga é aprovada pelo gerente');
    }
    return data;
  },
  afterSave(ctx, row, old) {
    if (!old) {
      const f = crud.raw(ctx.db, 'funcionarios', row.funcionario_id);
      core.solicitarAprovacao(ctx, { tipo: 'troca_folga', ref_tabela: 'trocas_folga', ref_id: row.id, descricao: `Troca de folga de ${f?.nome}: ${row.data_folga} → ${row.data_nova}` });
    }
  },
});

// Abono de falta no ponto exige aprovação do gerente
crud.registerHooks('ponto', {
  beforeSave(ctx, data, old) {
    if (old && old.ocorrencia === 'falta_injustificada' && data.ocorrencia && data.ocorrencia !== 'falta_injustificada' && ctx.user?.perfil !== 'gerente') {
      const f = crud.raw(ctx.db, 'funcionarios', old.funcionario_id);
      core.solicitarAprovacao(ctx, {
        tipo: 'abono_ponto', ref_tabela: 'ponto', ref_id: old.id,
        descricao: `Abono de falta de ${f?.nome} em ${old.data} → ${data.ocorrencia}`, valor: null,
      });
      ctx.db.prepare('UPDATE ponto SET obs = ? WHERE id = ?').run(`abono solicitado: ${data.ocorrencia}`, old.id);
      data.ocorrencia = 'falta_injustificada';
    }
    return data;
  },
});

core.onApproval('abono_ponto', {
  aprovar(ctx, ap) {
    const p = crud.raw(ctx.db, 'ponto', ap.ref_id);
    const nova = (p.obs || '').replace('abono solicitado: ', '') || 'falta_justificada';
    crud.update(ctx, 'ponto', ap.ref_id, { ocorrencia: nova, obs: 'abonado pelo gerente' }, { internal: true });
  },
});

// ------------------------------------------------------------------ Fechamento do DP
const ITENS_DP = [
  'Espelhos de ponto conferidos',
  'Horas extras aprovadas',
  'Faltas e descontos lançados',
  'Faltas de caixa com termo de desconto',
  'Comissões do grid apuradas',
  'Atestados lançados',
  'Admissões e demissões informadas',
  'Eventos de SST no eSocial conferidos',
];

function fechamentoDp(ctx, comp) {
  let f = ctx.db.prepare(`SELECT * FROM fechamentos WHERE tipo = 'dp' AND competencia = ? ${ctx.postoId ? 'AND posto_id = ?' : ''}`)
    .get(comp, ...(ctx.postoId ? [ctx.postoId] : []));
  if (!f) {
    f = crud.raw(ctx.db, 'fechamentos', crud.create(ctx, 'fechamentos', { competencia: comp, tipo: 'dp', itens: ITENS_DP.map((t) => ({ titulo: t, ok: false })) }, { internal: true }).id);
  }
  const de = comp + '-01', ate = monthEnd(de);
  const pp = ctx.postoId ? [ctx.postoId] : [];
  const pf = ctx.postoId ? 'AND posto_id = ?' : '';
  const resumo = {
    admissoes: ctx.db.prepare(`SELECT nome, admissao FROM funcionarios WHERE admissao BETWEEN ? AND ? ${pf}`).all(de, ate, ...pp),
    demissoes: ctx.db.prepare(`SELECT nome, demissao FROM funcionarios WHERE demissao BETWEEN ? AND ? ${pf}`).all(de, ate, ...pp),
    he_nao_aprovadas: ctx.db.prepare(`SELECT COUNT(*) AS n FROM ponto WHERE data BETWEEN ? AND ? AND COALESCE(he_aprovada,0) = 0 ${pf}`).get(de, ate, ...pp).n,
    descontos_sem_termo: ctx.db.prepare(`SELECT COUNT(*) AS n FROM faltas_caixa WHERE data BETWEEN ? AND ? AND tratamento = 'desconto' AND (autorizacao IS NULL OR autorizacao = '[]') ${pf}`).get(de, ate, ...pp).n,
    faltas_pendentes: ctx.db.prepare(`SELECT COUNT(*) AS n FROM faltas_caixa WHERE data BETWEEN ? AND ? AND tratamento IN ('pendente','abono_solicitado') ${pf}`).get(de, ate, ...pp).n,
  };
  return { fechamento: crud.parseRow(crud.resource('fechamentos'), f), resumo };
}

module.exports = {
  calcularDia, minutosNoturnos, espelho, bancoHoras, resumoEquipe, parseAfd, importarAfd, baterPonto,
  atestadosInss, situacaoFerias, conflitosFerias, decimoTerceiro, comissoes, fichasEpi, linhaDoTempo,
  conflitosEscala, fechamentoDp, ITENS_DP, minToHm, parseDate,
};
