'use strict';
// Módulo Pista: abertura/fechamento de turno, encerrantes, caixas por frentista e faltas de caixa.

const crud = require('../crud');
const auth = require('../auth');
const core = require('./core');
const { paramNum } = require('../db');
const { HttpError, round2, num, sum, today, competencia, monthStart, monthEnd, addMonths } = require('../util');

const CHECKLIST_ABERTURA = [
  'Extintores no lugar, lacrados e dentro da validade',
  'Bicos e mangueiras sem danos',
  'Sem vazamentos nas bombas e na área de descarga',
  'Pista limpa e sem óleo no piso',
  'Iluminação funcionando',
  'Calibrador funcionando',
  'Sinalização (proibido fumar, desligue o motor, celular)',
  'Kit de emergência ambiental completo',
  'Equipe com uniforme e EPI completos',
];

const CHECKLIST_FECHAMENTO = [
  'Leitura final de todos os encerrantes',
  'Medição dos tanques',
  'Caixas de todos os frentistas conferidos',
  'Sangrias depositadas no cofre',
  'Pista limpa e organizada',
  'Ocorrências do turno registradas',
];

crud.registerHooks('caixas', {
  beforeSave(ctx, data, old) {
    const m = { ...(old || {}), ...data };
    const total = round2(['dinheiro', 'debito', 'credito', 'pix', 'a_prazo', 'vales'].reduce((a, k) => a + num(m[k]), 0));
    data.total_informado = total;
    data.diferenca = round2(total - num(m.sistema_total));
    return data;
  },
  afterSave(ctx, row) {
    const falta = ctx.db.prepare('SELECT * FROM faltas_caixa WHERE caixa_id = ?').get(row.id);
    if (row.diferenca < -0.009) {
      const turno = crud.raw(ctx.db, 'turnos', row.turno_id);
      const valor = round2(-row.diferenca);
      if (falta) {
        if (falta.tratamento === 'pendente') {
          ctx.db.prepare('UPDATE faltas_caixa SET valor = ?, justificativa = ?, updated_at = ? WHERE id = ?')
            .run(valor, row.justificativa, new Date().toISOString(), falta.id);
        }
      } else {
        crud.create(ctx, 'faltas_caixa', {
          posto_id: row.posto_id, data: turno?.data || today(), turno_id: row.turno_id, caixa_id: row.id,
          funcionario_id: row.funcionario_id, valor, forma_pagamento: 'Não identificada',
          justificativa: row.justificativa, tratamento: 'pendente',
        }, { internal: true });
      }
    } else if (falta && falta.tratamento === 'pendente') {
      crud.remove(ctx, 'faltas_caixa', falta.id, { internal: true });
    }
  },
});

crud.registerHooks('faltas_caixa', {
  beforeSave(ctx, data, old) {
    const m = { ...(old || {}), ...data };
    if (data.tratamento === 'desconto') {
      let anexos = m.autorizacao;
      if (typeof anexos === 'string') { try { anexos = JSON.parse(anexos); } catch { anexos = []; } }
      if (!Array.isArray(anexos) || !anexos.length) {
        throw new HttpError(400, 'Desconto em folha exige o termo de autorização assinado anexado');
      }
    }
    if (data.tratamento === 'abonado' && ctx.user?.perfil !== 'gerente' && old?.tratamento !== 'abonado') {
      data.tratamento = 'abono_solicitado';
    }
    return data;
  },
  afterSave(ctx, row, old) {
    if (row.tratamento === 'abono_solicitado' && old?.tratamento !== 'abono_solicitado') {
      const f = crud.raw(ctx.db, 'funcionarios', row.funcionario_id);
      core.solicitarAprovacao(ctx, {
        tipo: 'abono_falta_caixa', ref_tabela: 'faltas_caixa', ref_id: row.id, valor: row.valor,
        descricao: `Abono de falta de caixa de ${f?.nome || 'frentista'} em ${row.data}`,
      });
    }
  },
});

core.onApproval('abono_falta_caixa', {
  aprovar: (ctx, ap) => crud.update(ctx, 'faltas_caixa', ap.ref_id, { tratamento: 'abonado' }, { internal: true }),
  recusar: (ctx, ap) => crud.update(ctx, 'faltas_caixa', ap.ref_id, { tratamento: 'pendente' }, { internal: true }),
});

function bicosDoPosto(ctx) {
  return ctx.db.prepare(`SELECT b.*, c.nome AS combustivel, c.preco_bomba FROM bicos b LEFT JOIN combustiveis c ON c.id = b.combustivel_id
    ${ctx.postoId ? 'WHERE b.posto_id = ?' : ''} ORDER BY b.nome`).all(...(ctx.postoId ? [ctx.postoId] : []));
}

function tanquesDoPosto(ctx) {
  return ctx.db.prepare(`SELECT t.*, c.nome AS combustivel FROM tanques t LEFT JOIN combustiveis c ON c.id = t.combustivel_id
    ${ctx.postoId ? 'WHERE t.posto_id = ?' : ''} ORDER BY t.nome`).all(...(ctx.postoId ? [ctx.postoId] : []));
}

// Dados para a tela de abertura: escalados, bicos com último encerrante, tanques e checklist
function preparoAbertura(ctx, data = today(), periodo) {
  auth.requireModule(ctx.user, 'pista');
  const escalados = ctx.db.prepare(`SELECT e.funcionario_id, f.nome, f.funcao, e.turno FROM escalas e JOIN funcionarios f ON f.id = e.funcionario_id
    WHERE e.data = ? ${periodo ? 'AND e.turno = ?' : "AND e.turno <> 'folga'"} ${ctx.postoId ? 'AND e.posto_id = ?' : ''} ORDER BY f.nome`)
    .all(data, ...(periodo ? [periodo] : []), ...(ctx.postoId ? [ctx.postoId] : []));
  const aberto = ctx.db.prepare(`SELECT id FROM turnos WHERE status = 'aberto' ${ctx.postoId ? 'AND posto_id = ?' : ''} ORDER BY id DESC LIMIT 1`)
    .get(...(ctx.postoId ? [ctx.postoId] : []));
  return {
    data, periodo, escalados, turno_aberto: aberto?.id || null,
    bicos: bicosDoPosto(ctx), tanques: tanquesDoPosto(ctx), checklist: CHECKLIST_ABERTURA,
  };
}

function abrirTurno(ctx, body) {
  auth.requireWrite(ctx.user, 'turnos');
  const { data = today(), periodo, chefe_id, presencas = [], checklist = {}, encerrantes = [], medicoes = [] } = body;
  if (!periodo) throw new HttpError(400, 'Informe o turno');
  const dup = ctx.db.prepare(`SELECT id FROM turnos WHERE data = ? AND periodo = ? ${ctx.postoId ? 'AND posto_id = ?' : ''}`)
    .get(data, periodo, ...(ctx.postoId ? [ctx.postoId] : []));
  if (dup) throw new HttpError(409, 'Este turno já foi aberto');
  const turno = crud.create(ctx, 'turnos', {
    data, periodo, chefe_id: chefe_id || ctx.user.funcionario_id, status: 'aberto', abertura_at: new Date().toISOString(),
    presencas, checklist_abertura: checklist,
  });
  for (const e of encerrantes) {
    crud.create(ctx, 'encerrantes', { turno_id: turno.id, bico_id: e.bico_id, inicial: e.inicial }, { noAudit: true });
  }
  for (const m of medicoes) {
    if (m.volume === '' || m.volume == null) continue;
    crud.create(ctx, 'medicoes_tanque', { data, turno_id: turno.id, tanque_id: m.tanque_id, momento: 'abertura', metodo: m.metodo || 'regua', regua_cm: m.regua_cm, volume: m.volume }, { noAudit: true });
  }
  core.concluirChave(ctx, 'abertura_turno', data);
  if (medicoes.length) core.concluirChave(ctx, 'medicao_tanques', data);
  return detalheTurno(ctx, turno.id);
}

// Total vendido no sistema (Linx) por frentista no turno
function totaisSistema(ctx, turnoId) {
  return ctx.db.prepare(`SELECT funcionario_id, SUM(valor) AS total FROM vendas WHERE turno_id = ? AND origem = 'pista' GROUP BY funcionario_id`)
    .all(turnoId);
}

function detalheTurno(ctx, id) {
  auth.requireRead(ctx.user, 'turnos');
  const turno = crud.get(ctx, 'turnos', id);
  const encerrantes = ctx.db.prepare(`SELECT e.*, b.nome AS bico, b.combustivel_id, c.nome AS combustivel, c.preco_bomba FROM encerrantes e
    JOIN bicos b ON b.id = e.bico_id LEFT JOIN combustiveis c ON c.id = b.combustivel_id WHERE e.turno_id = ? ORDER BY b.nome`).all(id)
    .map((e) => {
      const litros = e.final != null ? round2(e.final - e.inicial - num(e.afericao_litros)) : null;
      return { ...e, litros, valor_estimado: litros != null ? round2(litros * num(e.preco_bomba)) : null };
    });
  const porCombustivel = {};
  for (const e of encerrantes) {
    if (e.litros == null) continue;
    porCombustivel[e.combustivel] = round2((porCombustivel[e.combustivel] || 0) + e.litros);
  }
  const sistema = Object.fromEntries(totaisSistema(ctx, id).map((x) => [x.funcionario_id, round2(x.total)]));
  return {
    turno,
    encerrantes,
    litros_por_combustivel: porCombustivel,
    medicoes: crud.list(ctx, 'medicoes_tanque', { f_turno_id: id }).rows,
    sangrias: crud.list(ctx, 'sangrias', { f_turno_id: id }).rows,
    ocorrencias: crud.list(ctx, 'ocorrencias', { f_turno_id: id }).rows,
    caixas: crud.list(ctx, 'caixas', { f_turno_id: id }).rows,
    descargas: crud.list(ctx, 'descargas', { f_turno_id: id }).rows,
    sistema_por_frentista: sistema,
    checklist_abertura_itens: CHECKLIST_ABERTURA,
    checklist_fechamento_itens: CHECKLIST_FECHAMENTO,
    tanques: tanquesDoPosto(ctx),
  };
}

function fecharTurno(ctx, id, body) {
  auth.requireWrite(ctx.user, 'turnos');
  const turno = crud.raw(ctx.db, 'turnos', id);
  if (!turno) throw new HttpError(404, 'Turno não encontrado');
  if (turno.status === 'fechado') throw new HttpError(400, 'Turno já fechado');
  const { encerrantes = [], medicoes = [], checklist = {} } = body;
  for (const e of encerrantes) {
    const atual = crud.raw(ctx.db, 'encerrantes', e.id);
    if (!atual || atual.turno_id !== Number(id)) continue;
    const final = Number(e.final);
    if (!Number.isFinite(final)) throw new HttpError(400, 'Informe o encerrante final de todos os bicos');
    if (final < atual.inicial) throw new HttpError(400, `Encerrante final menor que o inicial no bico #${atual.bico_id}`);
    crud.update(ctx, 'encerrantes', e.id, { final, afericao_litros: e.afericao_litros || 0 }, { noAudit: true });
    ctx.db.prepare('UPDATE bicos SET encerrante_atual = ? WHERE id = ?').run(final, atual.bico_id);
  }
  const pend = ctx.db.prepare('SELECT COUNT(*) AS n FROM encerrantes WHERE turno_id = ? AND final IS NULL').get(id).n;
  if (pend) throw new HttpError(400, 'Há bicos sem encerrante final');
  for (const m of medicoes) {
    if (m.volume === '' || m.volume == null) continue;
    crud.create(ctx, 'medicoes_tanque', { data: turno.data, turno_id: Number(id), tanque_id: m.tanque_id, momento: 'fechamento', metodo: m.metodo || 'regua', regua_cm: m.regua_cm, volume: m.volume }, { noAudit: true });
  }
  const avisos = [];
  const caixas = ctx.db.prepare('SELECT c.*, f.nome FROM caixas c JOIN funcionarios f ON f.id = c.funcionario_id WHERE turno_id = ?').all(id);
  if (!caixas.length) avisos.push('Nenhum fechamento de caixa registrado neste turno');
  for (const c of caixas) {
    if (c.diferenca < -0.009 && !c.assinado_at) avisos.push(`Falta de caixa de ${c.nome} sem assinatura do frentista`);
  }
  crud.update(ctx, 'turnos', id, { status: 'fechado', fechamento_at: new Date().toISOString(), checklist_fechamento: checklist });
  core.concluirChave(ctx, 'fechamento_turno', turno.data);
  core.concluirChave(ctx, 'leitura_encerrantes', turno.data);
  if (caixas.length) core.concluirChave(ctx, 'fechamento_caixa', turno.data);
  return { ...detalheTurno(ctx, id), avisos };
}

// Assinatura digital do frentista: pela própria sessão ou com login/senha no celular do chefe
function assinar(ctx, tabela, id, body = {}) {
  if (!['caixas', 'faltas_caixa'].includes(tabela)) throw new HttpError(400, 'Tabela inválida');
  const row = crud.raw(ctx.db, tabela, id);
  if (!row) throw new HttpError(404, 'Registro não encontrado');
  let signer = ctx.user;
  if (row.funcionario_id !== ctx.user.funcionario_id) {
    if (!body.login || !body.senha) throw new HttpError(400, 'O frentista deve informar login e senha para assinar');
    const u = ctx.db.prepare('SELECT * FROM usuarios WHERE lower(login) = lower(?) AND ativo = 1').get(body.login);
    if (!u || !auth.verifyPassword(body.senha, u.senha) || u.funcionario_id !== row.funcionario_id) {
      throw new HttpError(401, 'Assinatura inválida: credenciais não pertencem ao frentista deste caixa');
    }
    signer = auth.publicUser(u);
  }
  const at = new Date().toISOString();
  ctx.db.prepare(`UPDATE "${tabela}" SET assinado_at = ?, updated_at = ? WHERE id = ?`).run(at, at, id);
  if (tabela === 'caixas') {
    ctx.db.prepare('UPDATE faltas_caixa SET assinado_at = ? WHERE caixa_id = ?').run(at, id);
  }
  crud.audit(ctx.db, signer, 'assinar', tabela, Number(id), null, { assinado_at: at });
  return { ok: true, assinado_at: at };
}

function relatorioFaltas(ctx, comp = competencia(today())) {
  auth.requireRead(ctx.user, 'faltas_caixa');
  const de = monthStart(comp + '-01');
  const ate = monthEnd(de);
  const limiteValor = paramNum(ctx.db, 'falta_caixa_limite_valor', 50);
  const limiteQtd = paramNum(ctx.db, 'falta_caixa_limite_qtd', 3);
  const pf = ctx.postoId ? 'AND fc.posto_id = ?' : '';
  const pp = ctx.postoId ? [ctx.postoId] : [];
  const rows = ctx.db.prepare(`SELECT fc.*, f.nome FROM faltas_caixa fc JOIN funcionarios f ON f.id = fc.funcionario_id
    WHERE fc.data BETWEEN ? AND ? ${pf}`).all(de, ate, ...pp);
  const seisMeses = addMonths(de, -5);
  const hist = ctx.db.prepare(`SELECT funcionario_id, substr(data,1,7) AS mes, COUNT(*) AS n FROM faltas_caixa fc
    WHERE data BETWEEN ? AND ? ${pf} GROUP BY funcionario_id, mes`).all(seisMeses, ate, ...pp);
  const map = new Map();
  for (const r of rows) {
    const k = r.funcionario_id;
    if (!map.has(k)) map.set(k, { funcionario_id: k, nome: r.nome, qtd: 0, total: 0, descontado: 0, abonado: 0, pendente: 0, investigacao: 0, maior: 0 });
    const a = map.get(k);
    a.qtd++;
    a.total = round2(a.total + r.valor);
    a.maior = Math.max(a.maior, r.valor);
    if (r.tratamento === 'desconto') a.descontado = round2(a.descontado + r.valor);
    else if (r.tratamento === 'abonado') a.abonado = round2(a.abonado + r.valor);
    else if (r.tratamento === 'investigacao') a.investigacao = round2(a.investigacao + r.valor);
    else a.pendente = round2(a.pendente + r.valor);
  }
  const ranking = [...map.values()].map((a) => ({
    ...a,
    meses_com_falta_6m: hist.filter((h) => h.funcionario_id === a.funcionario_id).length,
    alerta: a.qtd >= limiteQtd || a.maior > limiteValor,
  })).sort((x, y) => y.total - x.total);
  return {
    competencia: comp, limite_valor: limiteValor, limite_qtd: limiteQtd, ranking,
    total: round2(sum(rows, (r) => r.valor)),
    total_descontado: round2(sum(rows.filter((r) => r.tratamento === 'desconto'), (r) => r.valor)),
    sem_responsavel: rows.filter((r) => !r.funcionario_id).length,
  };
}

module.exports = {
  CHECKLIST_ABERTURA, CHECKLIST_FECHAMENTO, preparoAbertura, abrirTurno, detalheTurno, fecharTurno, assinar,
  relatorioFaltas, bicosDoPosto, tanquesDoPosto,
};
