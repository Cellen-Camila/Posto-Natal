'use strict';
// Módulo Combustíveis: LMC, estoque dos tanques e previsão de pedido,
// qualidade na descarga, aferição e GNV.

const crud = require('../crud');
const auth = require('../auth');
const core = require('./core');
const { param, paramNum } = require('../db');
const { HttpError, round2, num, sum, today, addDays, toCsv } = require('../util');

const pscope = (ctx, alias = '') => (ctx.postoId ? { sql: `AND ${alias}posto_id = ?`, p: [ctx.postoId] } : { sql: '', p: [] });

function faixa(s) {
  const [a, b] = String(s || '').split('-').map((x) => Number(x.replace(',', '.')));
  return Number.isFinite(a) && Number.isFinite(b) ? [a, b] : null;
}

// Avalia os testes de qualidade da descarga e retorna os motivos de reprovação
function avaliarQualidade(db, comb, d) {
  const motivos = [];
  if (d.aspecto === 'reprovado') motivos.push('Aspecto não conforme');
  if (d.cor === 'reprovado') motivos.push('Cor não conforme');
  const tipo = comb?.tipo_teste;
  if (tipo && tipo !== 'gnv' && d.densidade != null && d.densidade !== '') {
    const f = faixa(param(db, `densidade_${tipo}`, ''));
    if (f && (d.densidade < f[0] || d.densidade > f[1])) motivos.push(`Massa específica ${d.densidade} fora da faixa ${f[0]}–${f[1]} kg/m³`);
  }
  if (tipo === 'gasolina' && d.teor_etanol != null && d.teor_etanol !== '') {
    const alvo = paramNum(db, 'etanol_gasolina_pct', 30);
    const tol = paramNum(db, 'etanol_gasolina_tol', 1);
    if (Math.abs(d.teor_etanol - alvo) > tol) motivos.push(`Teor de etanol ${d.teor_etanol}% fora de ${alvo}% ± ${tol}`);
  }
  return motivos;
}

crud.registerHooks('descargas', {
  beforeSave(ctx, data, old) {
    const m = { ...(old || {}), ...data };
    const comb = crud.raw(ctx.db, 'combustiveis', m.combustivel_id);
    const tanque = crud.raw(ctx.db, 'tanques', m.tanque_id);
    if (tanque && comb && tanque.combustivel_id !== comb.id) throw new HttpError(400, `O tanque ${tanque.nome} não é de ${comb.nome}`);
    if (old && old.status === 'recusada' && ctx.user?.perfil !== 'gerente') {
      throw new HttpError(403, 'Descarga recusada: registro bloqueado. Somente o gerente pode reabrir.');
    }
    const motivos = avaliarQualidade(ctx.db, comb, m);
    data.status = motivos.length ? 'recusada' : 'aprovada';
    data.reprovacoes = motivos.join('; ') || null;
    if (!m.amostra_descarte && m.data) data.amostra_descarte = addDays(m.data, paramNum(ctx.db, 'amostra_guarda_dias', 30));
    if (tanque && m.medicao_antes != null && num(m.medicao_antes) + num(m.volume_nf) > num(tanque.capacidade) && tanque.capacidade) {
      throw new HttpError(400, `Volume da nota não cabe no tanque (${tanque.capacidade} L de capacidade)`);
    }
    return data;
  },
  afterSave(ctx, row, old) {
    if (row.status === 'aprovada' && (!old || old.custo_unitario !== row.custo_unitario)) {
      const last = ctx.db.prepare("SELECT custo_unitario FROM descargas WHERE combustivel_id = ? AND status = 'aprovada' ORDER BY data DESC, id DESC LIMIT 1").get(row.combustivel_id);
      if (last) ctx.db.prepare('UPDATE combustiveis SET custo_medio = ? WHERE id = ?').run(last.custo_unitario, row.combustivel_id);
    }
  },
});

crud.registerHooks('equipamentos', {
  beforeSave(ctx, data, old) {
    const m = { ...(old || {}), ...data };
    if (m.tipo === 'Aferição de bomba (20 L)' && m.volume_medido != null && m.volume_medido !== '') {
      const erroMl = Math.round((Number(m.volume_medido) - 20) * 1000);
      const tol = paramNum(ctx.db, 'afericao_tolerancia_ml', 100);
      data.resultado = `${erroMl >= 0 ? '+' : ''}${erroMl} mL — ${Math.abs(erroMl) <= tol ? 'dentro da tolerância' : 'FORA da tolerância: acionar manutenção/IPEM'}`;
    }
    if (m.tipo === 'Lacre de bomba' && m.bico_id && m.lacre_numero) {
      ctx.db.prepare('UPDATE bicos SET lacre = ? WHERE id = ?').run(m.lacre_numero, m.bico_id);
    }
    return data;
  },
  afterSave(ctx, row) {
    if (row.tipo === 'Aferição de bomba (20 L)') core.concluirChave(ctx, 'afericao', row.data);
  },
});

// LMC diário por produto
function lmc(ctx, data = today(), combustivelId) {
  const tol = paramNum(ctx.db, 'lmc_tolerancia_pct', 0.6);
  const ps = pscope(ctx, 't.');
  const combs = ctx.db.prepare('SELECT * FROM combustiveis ORDER BY id').all().filter((c) => !combustivelId || c.id === Number(combustivelId));
  return combs.map((c) => {
    const tanques = ctx.db.prepare(`SELECT t.* FROM tanques t WHERE t.combustivel_id = ? ${ps.sql}`).all(c.id, ...ps.p);
    if (!tanques.length) return null;
    let abertura = 0, fechamento = 0, temAbertura = true, temFechamento = true;
    for (const t of tanques) {
      const a = ctx.db.prepare("SELECT volume FROM medicoes_tanque WHERE tanque_id = ? AND data = ? AND momento = 'abertura' ORDER BY id LIMIT 1").get(t.id, data)
        || ctx.db.prepare("SELECT volume FROM medicoes_tanque WHERE tanque_id = ? AND data < ? AND momento = 'fechamento' ORDER BY data DESC, id DESC LIMIT 1").get(t.id, data);
      const f = ctx.db.prepare("SELECT volume FROM medicoes_tanque WHERE tanque_id = ? AND data = ? AND momento = 'fechamento' ORDER BY id DESC LIMIT 1").get(t.id, data);
      if (a) abertura += a.volume; else temAbertura = false;
      if (f) fechamento += f.volume; else temFechamento = false;
    }
    const ids = tanques.map((t) => t.id);
    const recebido = ctx.db.prepare(`SELECT COALESCE(SUM(volume_nf),0) AS v FROM descargas WHERE data = ? AND status = 'aprovada' AND tanque_id IN (${ids.map(() => '?').join(',')})`)
      .get(data, ...ids).v;
    const vendasEnc = ctx.db.prepare(`SELECT COALESCE(SUM(e.final - e.inicial - COALESCE(e.afericao_litros,0)),0) AS v FROM encerrantes e
      JOIN turnos tu ON tu.id = e.turno_id JOIN bicos b ON b.id = e.bico_id
      WHERE tu.data = ? AND e.final IS NOT NULL AND b.tanque_id IN (${ids.map(() => '?').join(',')})`).get(data, ...ids).v;
    const escritural = abertura + recebido - vendasEnc;
    const disponivel = abertura + recebido;
    const perdaSobra = temFechamento ? fechamento - escritural : null;
    const pct = perdaSobra != null && disponivel ? 100 * perdaSobra / disponivel : null;
    return {
      data, combustivel_id: c.id, combustivel: c.nome, unidade: c.unidade,
      estoque_abertura: round2(abertura), recebimentos: round2(recebido), vendas: round2(vendasEnc),
      estoque_escritural: round2(escritural), estoque_fechamento: temFechamento ? round2(fechamento) : null,
      perda_sobra: perdaSobra != null ? round2(perdaSobra) : null, perda_sobra_pct: pct != null ? Math.round(pct * 1000) / 1000 : null,
      tolerancia_pct: tol, fora_tolerancia: pct != null && Math.abs(pct) > tol,
      incompleto: !temAbertura || !temFechamento,
    };
  }).filter(Boolean);
}

function lmcPeriodo(ctx, de, ate, combustivelId) {
  const out = [];
  for (let d = de; d <= ate; d = addDays(d, 1)) out.push(...lmc(ctx, d, combustivelId));
  return out;
}

function lmcCsv(ctx, de, ate) {
  const rows = lmcPeriodo(ctx, de, ate);
  return toCsv([
    { label: 'Data', key: 'data' }, { label: 'Produto', key: 'combustivel' }, { label: 'Estoque de abertura', key: 'estoque_abertura' },
    { label: 'Recebimentos', key: 'recebimentos' }, { label: 'Vendas (encerrantes)', key: 'vendas' }, { label: 'Estoque escritural', key: 'estoque_escritural' },
    { label: 'Estoque de fechamento (medido)', key: 'estoque_fechamento' }, { label: 'Perdas (-) / sobras (+)', key: 'perda_sobra' }, { label: '% sobre disponível', key: 'perda_sobra_pct' },
  ], rows);
}

function fecharLmc(ctx, data = today()) {
  auth.requireModule(ctx.user, 'combustiveis');
  const linhas = lmc(ctx, data);
  const incompletos = linhas.filter((l) => l.incompleto).map((l) => l.combustivel);
  if (incompletos.length) throw new HttpError(400, `Medições faltando para: ${incompletos.join(', ')}`);
  core.concluirChave(ctx, 'lmc', data);
  crud.audit(ctx.db, ctx.user, 'fechar_lmc', 'medicoes_tanque', null, null, { data, linhas });
  return { ok: true, linhas };
}

// Estoque atual por tanque e previsão de pedido pela média de vendas
function estoqueTanques(ctx) {
  const ps = pscope(ctx, 't.');
  const alertaDias = paramNum(ctx.db, 'dias_estoque_alerta', 2);
  const tanques = ctx.db.prepare(`SELECT t.*, c.nome AS combustivel FROM tanques t JOIN combustiveis c ON c.id = t.combustivel_id WHERE 1=1 ${ps.sql} ORDER BY t.nome`).all(...ps.p);
  const hoje = today();
  return tanques.map((t) => {
    const ult = ctx.db.prepare('SELECT data, momento, volume FROM medicoes_tanque WHERE tanque_id = ? ORDER BY data DESC, CASE momento WHEN \'fechamento\' THEN 1 ELSE 0 END DESC, id DESC LIMIT 1').get(t.id);
    const media = ctx.db.prepare(`SELECT COALESCE(SUM(e.final - e.inicial - COALESCE(e.afericao_litros,0)),0) / 7.0 AS m FROM encerrantes e JOIN turnos tu ON tu.id = e.turno_id
      JOIN bicos b ON b.id = e.bico_id WHERE b.tanque_id = ? AND tu.data BETWEEN ? AND ? AND e.final IS NOT NULL`).get(t.id, addDays(hoje, -7), addDays(hoje, -1)).m;
    // vendas após a última medição (turnos ainda abertos não entram)
    const estoque = ult ? ult.volume : null;
    const util = estoque != null ? estoque - num(t.estoque_minimo) : null;
    const dias = media > 0 && util != null ? util / media : null;
    const serie = ctx.db.prepare(`SELECT data, volume FROM medicoes_tanque WHERE tanque_id = ? AND momento = 'fechamento' AND data >= ? ORDER BY data`).all(t.id, addDays(hoje, -30));
    return {
      id: t.id, nome: t.nome, combustivel: t.combustivel, combustivel_id: t.combustivel_id, capacidade: t.capacidade, estoque_minimo: t.estoque_minimo,
      estoque: estoque != null ? round2(estoque) : null, medido_em: ult ? `${ult.data} (${ult.momento})` : null,
      ocupacao_pct: estoque != null && t.capacidade ? round2(100 * estoque / t.capacidade) : null,
      media_diaria: round2(media), dias_estoque: dias != null ? round2(dias) : null,
      pedir_ate: dias != null ? addDays(hoje, Math.max(0, Math.floor(dias) - 1)) : null,
      sugestao_pedido: estoque != null && t.capacidade ? Math.max(0, Math.floor((t.capacidade * 0.95 - estoque) / 1000) * 1000) : null,
      alerta: dias != null && dias < alertaDias,
      serie,
    };
  });
}

function gnv(ctx, de, ate) {
  const ps = pscope(ctx, 'v.');
  const c = ctx.db.prepare("SELECT * FROM combustiveis WHERE tipo_teste = 'gnv' OR unidade = 'm³' LIMIT 1").get();
  if (!c) return { disponivel: false };
  const v = ctx.db.prepare(`SELECT SUM(quantidade) AS m3, SUM(valor) AS valor, SUM(custo) AS custo, COUNT(*) AS n FROM vendas v WHERE combustivel_id = ? AND data BETWEEN ? AND ? ${ps.sql}`)
    .get(c.id, de, ate, ...ps.p);
  const manut = ctx.db.prepare(`SELECT * FROM equipamentos WHERE tipo IN ('Manutenção compressor GNV','Inspeção vaso de pressão (NR-13)','Manutenção dispenser GNV') ${pscope(ctx).sql} ORDER BY data DESC LIMIT 20`)
    .all(...pscope(ctx).p);
  const operadores = ctx.db.prepare(`SELECT id, nome FROM funcionarios WHERE gnv_habilitado = 1 AND ativo = 1 ${pscope(ctx).sql}`).all(...pscope(ctx).p);
  const escalaHoje = ctx.db.prepare(`SELECT f.nome, e.turno FROM escalas e JOIN funcionarios f ON f.id = e.funcionario_id WHERE e.gnv = 1 AND e.data = ? ${pscope(ctx, 'e.').sql}`)
    .all(today(), ...pscope(ctx, 'e.').p);
  const valor = num(v.valor), custo = num(v.custo);
  return {
    disponivel: true, combustivel: c.nome, preco: c.preco_bomba, custo: c.custo_medio,
    m3: round2(v.m3), valor: round2(valor), margem: round2(valor - custo), margem_pct: valor ? round2(100 * (valor - custo) / valor) : 0,
    ticket: v.n ? round2(valor / v.n) : 0, abastecimentos: v.n || 0, manutencoes: manut, operadores, escala_hoje: escalaHoje,
  };
}

module.exports = { avaliarQualidade, lmc, lmcPeriodo, lmcCsv, fecharLmc, estoqueTanques, gnv };
