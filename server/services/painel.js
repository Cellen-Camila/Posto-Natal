'use strict';
// Painel do gerente (tela inicial) e área de autoatendimento do funcionário.

const crud = require('../crud');
const auth = require('../auth');
const core = require('./core');
const fin = require('./financeiro');
const rh = require('./rh');
const alertas = require('./alertas');
const { round2, num, sum, today, addDays, monthStart, addMonths, diffDays, monthEnd, HttpError } = require('../util');

function vendasPeriodo(ctx, de, ate) {
  const ps = ctx.postoId ? { sql: 'AND v.posto_id = ?', p: [ctx.postoId] } : { sql: '', p: [] };
  const porComb = ctx.db.prepare(`SELECT c.id, c.nome, c.unidade, SUM(v.quantidade) AS qtd, SUM(v.valor) AS valor, SUM(v.custo) AS custo
    FROM vendas v JOIN combustiveis c ON c.id = v.combustivel_id WHERE v.origem = 'pista' AND v.data BETWEEN ? AND ? ${ps.sql} GROUP BY c.id ORDER BY c.id`).all(de, ate, ...ps.p);
  const tot = ctx.db.prepare(`SELECT v.origem, SUM(v.valor) AS valor, COUNT(DISTINCT COALESCE(v.cupom, v.id)) AS cupons FROM vendas v WHERE v.data BETWEEN ? AND ? ${ps.sql} GROUP BY v.origem`).all(de, ate, ...ps.p);
  const g = (o, k) => num(tot.find((t) => t.origem === o)?.[k]);
  return {
    por_combustivel: porComb.map((c) => ({ ...c, qtd: round2(c.qtd), valor: round2(c.valor) })),
    litros: round2(sum(porComb.filter((c) => c.unidade !== 'm³'), (c) => c.qtd)),
    faturamento: round2(g('pista', 'valor') + g('conveniencia', 'valor')),
    faturamento_pista: round2(g('pista', 'valor')), faturamento_conveniencia: round2(g('conveniencia', 'valor')),
    ticket_pista: g('pista', 'cupons') ? round2(g('pista', 'valor') / g('pista', 'cupons')) : 0,
    ticket_conveniencia: g('conveniencia', 'cupons') ? round2(g('conveniencia', 'valor') / g('conveniencia', 'cupons')) : 0,
  };
}

function painel(ctx) {
  auth.requireModule(ctx.user, 'painel');
  const hoje = today();
  const ini = monthStart(hoje);
  const iniAnt = addMonths(ini, -1);
  const diaMes = Number(hoje.slice(8, 10));
  const fimAntMesmoPeriodo = addDays(iniAnt, Math.min(diaMes, Number(monthEnd(iniAnt).slice(8, 10))) - 1);
  const pf = ctx.postoId ? 'AND posto_id = ?' : '';
  const pp = ctx.postoId ? [ctx.postoId] : [];

  const dia = vendasPeriodo(ctx, hoje, hoje);
  const ontem = vendasPeriodo(ctx, addDays(hoje, -1), addDays(hoje, -1));
  const mes = vendasPeriodo(ctx, ini, hoje);
  const mesAnt = vendasPeriodo(ctx, iniAnt, fimAntMesmoPeriodo);
  const varPct = (a, b) => (b ? round2(100 * (a - b) / b) : null);

  // margem bruta por combustível com custo da última compra
  const margens = ctx.db.prepare('SELECT * FROM combustiveis ORDER BY id').all().map((c) => {
    const ult = ctx.db.prepare(`SELECT custo_unitario FROM descargas WHERE combustivel_id = ? AND status = 'aprovada' ${pf} ORDER BY data DESC, id DESC LIMIT 1`).get(c.id, ...pp);
    const custo = ult?.custo_unitario ?? c.custo_medio;
    return {
      combustivel: c.nome, unidade: c.unidade, preco: c.preco_bomba, custo,
      margem_un: Math.round((c.preco_bomba - custo) * 1000) / 1000,
      margem_pct: c.preco_bomba ? round2(100 * (c.preco_bomba - custo) / c.preco_bomba) : 0,
    };
  });

  // caixa
  const saldo = fin.saldoBancario(ctx);
  const prox = fin.proximos(ctx, 7);
  const inad = fin.inadimplencia(ctx);

  // pessoas
  const escaladosDia = ctx.db.prepare(`SELECT e.funcionario_id, f.nome, e.turno FROM escalas e JOIN funcionarios f ON f.id = e.funcionario_id WHERE e.data = ? AND e.turno <> 'folga' ${ctx.postoId ? 'AND e.posto_id = ?' : ''}`).all(hoje, ...pp);
  const periodoAtual = fin.periodoDaHora(`${new Date().getHours()}:00`);
  const escalados = escaladosDia.filter((e) => e.turno === periodoAtual);
  const pontoHoje = ctx.db.prepare(`SELECT * FROM ponto WHERE data = ? ${pf}`).all(hoje, ...pp);
  const presentes = pontoHoje.filter((p) => p.entrada).map((p) => p.funcionario_id);
  const faltasHoje = pontoHoje.filter((p) => p.ocorrencia === 'falta_injustificada' || p.ocorrencia === 'falta_justificada');
  const atestadosAtivos = ctx.db.prepare(`SELECT COUNT(*) AS n FROM atestados WHERE data_inicio <= ? AND date(data_inicio, '+' || (dias - 1) || ' days') >= ? ${pf}`).get(hoje, hoje, ...pp).n;
  let heMes = 0;
  if (auth.canRead(ctx.user, 'ponto')) {
    heMes = sum(rh.resumoEquipe(ctx).linhas, (l) => l.extra50 + l.extra100);
  }
  const turnoAtual = ctx.db.prepare(`SELECT * FROM turnos WHERE status = 'aberto' ${pf} ORDER BY id DESC LIMIT 1`).get(...pp);

  // alertas
  const lista = alertas.computeAlerts(ctx);
  const contagem = { vermelho: 0, amarelo: 0, verde: 0 };
  for (const a of lista) contagem[a.nivel]++;

  // checklists do dia
  const tarefas = ctx.db.prepare(`SELECT t.*, u.nome AS responsavel FROM tarefas t LEFT JOIN usuarios u ON u.id = t.responsavel_id WHERE t.data_prevista = ? ${ctx.postoId ? 'AND (t.posto_id = ? OR t.posto_id IS NULL)' : ''} ORDER BY t.hora_limite, t.titulo`)
    .all(hoje, ...pp).map((t) => ({ id: t.id, titulo: t.titulo, perfil: t.perfil, responsavel: t.responsavel, hora_limite: t.hora_limite, status: core.statusTarefa(t), modulo: t.modulo }));

  // agenda da semana
  const ate = addDays(hoje, 7);
  const agenda = [];
  for (const d of ctx.db.prepare(`SELECT id, nome, validade FROM documentos WHERE validade BETWEEN ? AND ? ${pf}`).all(hoje, ate, ...pp)) agenda.push({ data: d.validade, tipo: 'Documento vence', texto: d.nome, link: `#/r/documentos/${d.id}` });
  for (const f of ctx.db.prepare(`SELECT fe.inicio, f.nome FROM ferias fe JOIN funcionarios f ON f.id = fe.funcionario_id WHERE fe.status = 'programada' AND fe.inicio BETWEEN ? AND ? ${ctx.postoId ? 'AND fe.posto_id = ?' : ''}`).all(hoje, ate, ...pp)) agenda.push({ data: f.inicio, tipo: 'Férias começam', texto: f.nome, link: '#/rh/ferias' });
  for (const c of ctx.db.prepare(`SELECT id, descricao, valor, vencimento FROM contas_pagar WHERE status IN ('aberta','aguardando_aprovacao') AND vencimento BETWEEN ? AND ? ${pf} ORDER BY vencimento`).all(hoje, ate, ...pp)) agenda.push({ data: c.vencimento, tipo: 'Pagamento', texto: `${c.descricao} — R$ ${c.valor.toFixed(2)}`, link: `#/r/contas_pagar/${c.id}` });
  for (const d of ctx.db.prepare(`SELECT d.amostra_descarte, d.nota, c.nome FROM descargas d JOIN combustiveis c ON c.id = d.combustivel_id WHERE d.amostra_descarte BETWEEN ? AND ? ${ctx.postoId ? 'AND d.posto_id = ?' : ''}`).all(hoje, ate, ...pp)) agenda.push({ data: d.amostra_descarte, tipo: 'Descarte de amostra', texto: `${d.nome} NF ${d.nota}`, link: '#/r/descargas' });
  for (const e of ctx.db.prepare(`SELECT DISTINCT tipo, item, proxima_data FROM equipamentos WHERE proxima_data BETWEEN ? AND ? ${pf}`).all(hoje, ate, ...pp)) agenda.push({ data: e.proxima_data, tipo: 'Equipamento', texto: `${e.tipo}${e.item ? ' — ' + e.item : ''}`, link: '#/r/equipamentos' });
  for (const t of ctx.db.prepare(`SELECT t.titulo, t.data_prevista FROM tarefas t JOIN tarefas_modelo m ON m.id = t.modelo_id WHERE m.frequencia IN ('mensal','semestral','anual') AND t.data_prevista BETWEEN ? AND ? AND t.concluida_at IS NULL ${ctx.postoId ? 'AND (t.posto_id = ? OR t.posto_id IS NULL)' : ''}`).all(hoje, ate, ...pp)) agenda.push({ data: t.data_prevista, tipo: 'Obrigação', texto: t.titulo, link: '#/agenda' });
  agenda.sort((a, b) => a.data.localeCompare(b.data));

  // série de faturamento dos últimos 30 dias
  const serie = ctx.db.prepare(`SELECT data, SUM(CASE WHEN origem='pista' THEN valor ELSE 0 END) AS pista, SUM(CASE WHEN origem='conveniencia' THEN valor ELSE 0 END) AS conveniencia
    FROM vendas WHERE data BETWEEN ? AND ? ${pf} GROUP BY data ORDER BY data`).all(addDays(hoje, -29), hoje, ...pp)
    .map((r) => ({ data: r.data, pista: round2(r.pista), conveniencia: round2(r.conveniencia) }));

  return {
    data: hoje,
    vendas: {
      dia, ontem, mes, mes_anterior_mesmo_periodo: mesAnt,
      variacao_mes_pct: varPct(mes.faturamento, mesAnt.faturamento),
      variacao_litros_pct: varPct(mes.litros, mesAnt.litros),
    },
    margens,
    caixa: { saldo_bancario: saldo.total, contas: saldo.contas, pagar_7d: prox.pagar, pagar_vencidas: prox.pagar_vencidas, receber_7d: prox.receber, inadimplencia: inad.total_vencido },
    pessoas: {
      periodo_atual: periodoAtual, escalados_dia: escaladosDia.length,
      escalados: escalados.length, presentes: escalados.filter((e) => presentes.includes(e.funcionario_id)).length,
      ausentes: escalados.filter((e) => !presentes.includes(e.funcionario_id)).map((e) => e.nome),
      faltas_hoje: faltasHoje.length, atestados_ativos: atestadosAtivos, horas_extras_mes_min: heMes,
      turno_aberto: turnoAtual ? { id: turnoAtual.id, periodo: turnoAtual.periodo, data: turnoAtual.data } : null,
    },
    alertas: { contagem, lista: lista.slice(0, 40) },
    checklists: {
      total: tarefas.length, concluidas: tarefas.filter((t) => t.status === 'concluida').length,
      atrasadas: tarefas.filter((t) => t.status === 'atrasada').length, itens: tarefas,
    },
    agenda,
    serie,
  };
}

// ------------------------------------------------------------------ Autoatendimento
function minhaArea(ctx) {
  const fid = ctx.user.funcionario_id;
  if (!fid) throw new HttpError(400, 'Seu usuário não está vinculado a um funcionário');
  const f = crud.raw(ctx.db, 'funcionarios', fid);
  const hoje = today();
  const escala = ctx.db.prepare('SELECT data, turno, gnv FROM escalas WHERE funcionario_id = ? AND data BETWEEN ? AND ? ORDER BY data').all(fid, hoje, addDays(hoje, 13));
  const banco = rh.bancoHoras(ctx, fid);
  const esp = rh.espelho(ctx, fid);
  const com = rh.comissoes({ ...ctx, user: { ...ctx.user, perfil: 'frentista' } });
  const minhaCom = com.ranking.find((r) => r.funcionario_id === fid) || { vendas: 0, comissao: 0, meta: num(f.meta_grid), itens: [] };
  const epiPend = ctx.db.prepare(`SELECT e.id, e.data, e.quantidade, i.nome AS item, e.ca FROM epi_entregas e JOIN epi_itens i ON i.id = e.item_id
    WHERE e.funcionario_id = ? AND e.assinado_at IS NULL ORDER BY e.data`).all(fid);
  const advPend = ctx.db.prepare('SELECT id, tipo, data, motivo FROM advertencias WHERE funcionario_id = ? AND assinado_at IS NULL').all(fid);
  const comunicados = ctx.db.prepare(`SELECT c.id, c.titulo, c.texto, c.data, c.exige_assinatura FROM comunicados c
    WHERE c.data >= ? AND NOT EXISTS (SELECT 1 FROM comunicados_leitura l WHERE l.comunicado_id = c.id AND l.funcionario_id = ?) ${f.posto_id ? 'AND (c.posto_id = ? OR c.posto_id IS NULL)' : ''} ORDER BY c.data DESC`)
    .all(addDays(hoje, -60), fid, ...(f.posto_id ? [f.posto_id] : []));
  const faltas = ctx.db.prepare('SELECT id, data, valor, tratamento, assinado_at FROM faltas_caixa WHERE funcionario_id = ? AND data >= ? ORDER BY data DESC').all(fid, addDays(hoje, -90));
  const caixasPend = ctx.db.prepare('SELECT c.id, t.data, t.periodo, c.diferenca FROM caixas c JOIN turnos t ON t.id = c.turno_id WHERE c.funcionario_id = ? AND c.assinado_at IS NULL ORDER BY t.data DESC LIMIT 10').all(fid);
  const pontoHoje = ctx.db.prepare('SELECT * FROM ponto WHERE funcionario_id = ? AND data = ?').get(fid, hoje);
  const ferias = rh.situacaoFerias({ ...ctx, postoId: null }).filter((x) => x.funcionario_id === fid);
  return {
    funcionario: { id: f.id, nome: f.nome, funcao: f.funcao },
    escala, banco_horas_min: banco, mes: esp.totais, ponto_hoje: pontoHoje || null,
    comissao: minhaCom, epi_pendentes: epiPend, advertencias_pendentes: advPend, comunicados, faltas_caixa: faltas,
    caixas_pendentes: caixasPend, ferias,
  };
}

function assinarProprio(ctx, tipo, id) {
  const fid = ctx.user.funcionario_id;
  if (!fid) throw new HttpError(400, 'Usuário sem funcionário vinculado');
  const at = new Date().toISOString();
  const tabela = { epi: 'epi_entregas', advertencia: 'advertencias', caixa: 'caixas', falta: 'faltas_caixa' }[tipo];
  if (tipo === 'comunicado') {
    if (!ctx.db.prepare('SELECT 1 FROM comunicados_leitura WHERE comunicado_id = ? AND funcionario_id = ?').get(id, fid)) {
      crud.create(ctx, 'comunicados_leitura', { comunicado_id: Number(id), funcionario_id: fid, lido_at: at }, { internal: true });
    }
    return { ok: true };
  }
  if (!tabela) throw new HttpError(400, 'Tipo inválido');
  const row = crud.raw(ctx.db, tabela, id);
  if (!row || row.funcionario_id !== fid) throw new HttpError(403, 'Registro não pertence a você');
  ctx.db.prepare(`UPDATE "${tabela}" SET assinado_at = ? WHERE id = ?`).run(at, id);
  if (tabela === 'caixas') ctx.db.prepare('UPDATE faltas_caixa SET assinado_at = ? WHERE caixa_id = ?').run(at, id);
  crud.audit(ctx.db, ctx.user, 'assinar', tabela, Number(id), null, { assinado_at: at });
  return { ok: true, assinado_at: at };
}

module.exports = { painel, minhaArea, assinarProprio, vendasPeriodo, diffDays };
