'use strict';
// Central de alertas: varre todos os módulos e devolve o que precisa de atenção,
// com cor (vermelho = vencido/crítico, amarelo = até 15 dias, verde = em dia/informativo).

const auth = require('../auth');
const { paramNum } = require('../db');
const { today, addDays, diffDays, monthStart, round2 } = require('../util');
const docs = require('./documentos');
const rh = require('./rh');
const comb = require('./combustiveis');
const conv = require('./conveniencia');
const core = require('./core');

const NIVEL = { vermelho: 0, amarelo: 1, verde: 2 };

function porDias(dias) {
  return dias < 0 || dias <= 7 ? 'vermelho' : dias <= 15 ? 'amarelo' : 'verde';
}

function quando(dias) {
  if (dias < 0) return `vencido há ${-dias} dia(s)`;
  if (dias === 0) return 'vence hoje';
  return `vence em ${dias} dia(s)`;
}

function computeAlerts(ctx) {
  const db = ctx.db;
  const u = ctx.user;
  const hoje = today();
  const pf = (alias = '') => (ctx.postoId ? `AND ${alias}posto_id = ${Number(ctx.postoId)}` : '');
  const out = [];
  const add = (modulo, nivel, titulo, detalhe, link, data) => out.push({ modulo, nivel, titulo, detalhe, link, data });
  const can = (mod) => auth.hasModule(u, mod);
  const sensivel = ['gerente', 'rh'].includes(u.perfil);

  // ---------------- Documentos e licenças (90/60/30/15/7 dias)
  if (can('documentos')) {
    const rows = db.prepare(`SELECT * FROM documentos WHERE validade IS NOT NULL ${pf()}`).all();
    for (const d of rows) {
      const s = docs.statusDocumento(db, d);
      if (s.dias > 90) continue;
      const nivel = d.em_renovacao ? 'amarelo' : porDias(s.dias);
      add('documentos', nivel, `${d.nome}`, `${quando(s.dias)}${d.em_renovacao ? ` — em renovação (protocolo ${d.protocolo || 's/n'})` : ''}`, `#/r/documentos/${d.id}`, d.validade);
    }
  }

  // ---------------- RH / SST
  if (can('rh')) {
    if (sensivel) {
      for (const a of db.prepare(`SELECT a.*, f.nome FROM asos a JOIN funcionarios f ON f.id = a.funcionario_id WHERE f.ativo = 1 AND a.validade IS NOT NULL ${pf('a.')}
        AND a.id = (SELECT id FROM asos x WHERE x.funcionario_id = a.funcionario_id ORDER BY x.validade DESC LIMIT 1)`).all()) {
        const dias = diffDays(hoje, a.validade);
        if (dias <= 30) add('rh', porDias(dias), `ASO de ${a.nome}`, quando(dias), '#/r/asos', a.validade);
      }
      for (const a of rh.atestadosInss(ctx)) add('rh', 'vermelho', `Atestados de ${a.nome} somam ${a.dias} dias em 60 dias`, 'Encaminhar ao INSS (afastamento acima de 15 dias)', '#/r/atestados', hoje);
    }
    for (const t of db.prepare(`SELECT t.*, f.nome FROM treinamentos t JOIN funcionarios f ON f.id = t.funcionario_id WHERE f.ativo = 1 AND t.validade IS NOT NULL ${pf('t.')}
      AND t.id = (SELECT id FROM treinamentos x WHERE x.funcionario_id = t.funcionario_id AND x.tipo = t.tipo ORDER BY x.validade DESC LIMIT 1)`).all()) {
      const dias = diffDays(hoje, t.validade);
      if (dias <= 30) add('rh', porDias(dias), `${t.tipo} — ${t.nome}`, quando(dias), '#/r/treinamentos', t.validade);
    }
    for (const f of rh.situacaoFerias(ctx)) {
      if (f.situacao === 'vencida_dobro') add('rh', 'vermelho', `Férias vencidas de ${f.nome}`, `Período ${f.aquisitivo_inicio}: pagamento em dobro`, '#/rh/ferias', f.limite_concessivo);
      else if (f.situacao === 'vence_30') add('rh', 'vermelho', `Férias de ${f.nome} vencem em ${f.dias_para_limite} dias`, 'Programe já para evitar pagamento em dobro', '#/rh/ferias', f.limite_concessivo);
      else if (f.situacao === 'vence_60') add('rh', 'amarelo', `Férias de ${f.nome} vencem em ${f.dias_para_limite} dias`, 'Programe as férias', '#/rh/ferias', f.limite_concessivo);
    }
    for (const i of db.prepare(`SELECT * FROM epi_itens WHERE 1=1 ${pf()}`).all()) {
      if (i.tipo === 'epi' && i.ca_validade && i.ca_validade < hoje) add('rh', 'vermelho', `CA vencido: ${i.nome} (CA ${i.ca})`, 'Não entregar; substituir por EPI com CA válido', '#/r/epi_itens', i.ca_validade);
      if (i.ponto_reposicao != null && i.estoque <= i.ponto_reposicao) add('rh', 'amarelo', `Repor ${i.nome}${i.tamanho ? ' ' + i.tamanho : ''}`, `Estoque ${i.estoque} (reposição em ${i.ponto_reposicao})`, '#/r/epi_itens', hoje);
    }
    const fichas = rh.fichasEpi(ctx).filter((f) => !f.em_dia);
    if (fichas.length) add('rh', 'amarelo', `${fichas.length} funcionário(s) com pendência na ficha de EPI`, fichas.slice(0, 3).map((f) => `${f.nome}: ${f.pendencias[0]}`).join('; '), '#/rh/epi', hoje);
    const eq = rh.resumoEquipe(ctx);
    for (const l of eq.linhas.filter((x) => x.excesso_he)) add('rh', 'amarelo', `Horas extras acima do limite: ${l.nome}`, `${rh.minToHm(l.extra50 + l.extra100)} no mês`, '#/rh/ponto', hoje);
    const prevMes = monthStart(addDays(monthStart(hoje), -1)).slice(0, 7);
    const naoEnviados = db.prepare(`SELECT COUNT(*) AS n FROM esocial_sst WHERE competencia = ? AND COALESCE(enviado,0) = 0 ${pf()}`).get(prevMes).n;
    if (naoEnviados) add('rh', 'amarelo', `${naoEnviados} evento(s) de SST do eSocial não enviados (${prevMes})`, 'S-2210 / S-2220 / S-2240', '#/r/esocial_sst', hoje);
  }

  // ---------------- Pista: faltas de caixa
  if (can('pista') || can('rh')) {
    const lim = paramNum(db, 'falta_caixa_limite_valor', 50);
    const limQ = paramNum(db, 'falta_caixa_limite_qtd', 3);
    const ini = monthStart(hoje);
    for (const r of db.prepare(`SELECT fc.funcionario_id, f.nome, COUNT(*) AS n, SUM(fc.valor) AS total, MAX(fc.valor) AS maior FROM faltas_caixa fc
      JOIN funcionarios f ON f.id = fc.funcionario_id WHERE fc.data >= ? ${pf('fc.')} GROUP BY fc.funcionario_id`).all(ini)) {
      if (r.n >= limQ) add('pista', 'vermelho', `${r.nome}: ${r.n} faltas de caixa no mês`, `Total R$ ${round2(r.total).toFixed(2)}`, '#/pista/faltas', hoje);
      else if (r.maior > lim) add('pista', 'amarelo', `${r.nome}: falta de caixa de R$ ${round2(r.maior).toFixed(2)}`, `Acima do limite de R$ ${lim.toFixed(2)}`, '#/pista/faltas', hoje);
    }
    const pend = db.prepare(`SELECT COUNT(*) AS n FROM faltas_caixa WHERE tratamento = 'pendente' ${pf()}`).get().n;
    if (pend) add('pista', 'amarelo', `${pend} falta(s) de caixa sem tratamento`, 'Definir desconto (com termo), abono ou investigação', '#/r/faltas_caixa', hoje);
    const turnoVelho = db.prepare(`SELECT * FROM turnos WHERE status = 'aberto' AND data < ? ${pf()}`).get(hoje);
    if (turnoVelho) add('pista', 'vermelho', 'Turno de dia anterior ainda aberto', `${turnoVelho.data} ${turnoVelho.periodo}`, `#/pista/turno/${turnoVelho.id}`, turnoVelho.data);
  }

  // ---------------- Financeiro
  if (can('financeiro')) {
    for (const c of db.prepare(`SELECT * FROM contas_pagar WHERE status IN ('aberta','aguardando_aprovacao') AND vencimento <= ? ${pf()} ORDER BY vencimento`).all(addDays(hoje, 3))) {
      const dias = diffDays(hoje, c.vencimento);
      add('financeiro', dias <= 0 ? 'vermelho' : 'amarelo', `Pagar: ${c.descricao}`, `R$ ${c.valor.toFixed(2)} — ${quando(dias)}`, `#/r/contas_pagar/${c.id}`, c.vencimento);
    }
    const venc = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(valor),0) AS v FROM contas_receber WHERE status = 'aberta' AND vencimento < ? ${pf()}`).get(hoje);
    if (venc.n) add('financeiro', 'amarelo', `Inadimplência: ${venc.n} título(s) vencido(s)`, `R$ ${round2(venc.v).toFixed(2)}`, '#/financeiro/inadimplencia', hoje);
    const atrasoCartao = db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(valor_esperado),0) AS v FROM recebiveis_cartao WHERE data_recebida IS NULL AND data_prevista < ? ${pf()}`).get(hoje);
    if (atrasoCartao.n) add('financeiro', 'vermelho', `${atrasoCartao.n} recebível(is) de cartão não creditado(s)`, `R$ ${round2(atrasoCartao.v).toFixed(2)} esperados`, '#/financeiro/cartoes', hoje);
    const naoConc = db.prepare(`SELECT COUNT(*) AS n FROM extrato WHERE conciliado_tipo IS NULL AND data < ? ${pf()}`).get(addDays(hoje, -2)).n;
    if (naoConc) add('financeiro', 'amarelo', `${naoConc} lançamento(s) do extrato sem conciliação`, 'Conciliação bancária pendente', '#/financeiro/conciliacao', hoje);
  }

  // ---------------- Combustíveis
  if (can('combustiveis')) {
    for (let d = addDays(hoje, -3); d < hoje; d = addDays(d, 1)) {
      for (const l of comb.lmc(ctx, d)) {
        if (l.fora_tolerancia) add('combustiveis', 'vermelho', `LMC ${l.combustivel} ${d}: ${l.perda_sobra > 0 ? 'sobra' : 'perda'} de ${Math.abs(l.perda_sobra)} L`, `${l.perda_sobra_pct}% (tolerância ${l.tolerancia_pct}%)`, '#/combustiveis/lmc', d);
      }
    }
    for (const t of comb.estoqueTanques(ctx).filter((x) => x.alerta)) add('combustiveis', 'vermelho', `Estoque baixo: ${t.nome} (${t.combustivel})`, `${t.dias_estoque} dia(s) de venda — pedir até ${t.pedir_ate}`, '#/combustiveis/tanques', hoje);
    for (const d of db.prepare(`SELECT d.*, c.nome FROM descargas d JOIN combustiveis c ON c.id = d.combustivel_id WHERE d.status = 'recusada' AND d.data >= ? ${pf('d.')}`).all(addDays(hoje, -7))) {
      add('combustiveis', 'vermelho', `Descarga recusada: ${d.nome} NF ${d.nota}`, d.reprovacoes, `#/r/descargas/${d.id}`, d.data);
    }
    for (const e of db.prepare(`SELECT * FROM equipamentos e WHERE proxima_data IS NOT NULL AND proxima_data <= ? ${pf()}
      AND id = (SELECT id FROM equipamentos x WHERE x.tipo = e.tipo AND COALESCE(x.item,'') = COALESCE(e.item,'') ORDER BY x.data DESC, x.id DESC LIMIT 1)`).all(addDays(hoje, 30))) {
      const dias = diffDays(hoje, e.proxima_data);
      // a janela de aviso acompanha a periodicidade (rotina semanal só alerta na véspera)
      const janela = Math.min(30, Math.max(1, Math.floor(diffDays(e.data, e.proxima_data) / 4)));
      if (dias > janela) continue;
      add('combustiveis', dias < 0 ? 'vermelho' : porDias(dias), `${e.tipo}${e.item ? ' — ' + e.item : ''}`, quando(dias), '#/r/equipamentos', e.proxima_data);
    }
  }

  // ---------------- Conveniência
  if (can('conveniencia')) {
    for (const l of conv.validade(ctx)) add('conveniencia', porDias(l.dias), `Validade: ${l.produto}`, `${quando(l.dias)} — ${l.quantidade} un.`, '#/r/lotes_validade', l.validade);
    const baixo = db.prepare(`SELECT COUNT(*) AS n FROM produtos WHERE local = 'conveniencia' AND COALESCE(ativo,1) = 1 AND estoque_minimo IS NOT NULL AND estoque <= estoque_minimo ${pf()}`).get().n;
    if (baixo) add('conveniencia', 'amarelo', `${baixo} produto(s) abaixo do estoque mínimo`, 'Gerar pedido de compra', '#/r/produtos', hoje);
    const margem = conv.precificacao(ctx).filter((p) => p.abaixo_alvo);
    if (margem.length) add('conveniencia', 'amarelo', `${margem.length} produto(s) com margem abaixo do alvo`, margem.slice(0, 3).map((p) => p.nome).join(', '), '#/conveniencia/precos', hoje);
    const gMax = paramNum(db, 'temp_geladeira_max', 7), fMax = paramNum(db, 'temp_freezer_max', -15);
    for (const t of db.prepare(`SELECT * FROM temperaturas WHERE data >= ? ${pf()}`).all(addDays(hoje, -1))) {
      const max = /freezer/i.test(t.equipamento) ? fMax : gMax;
      if (t.temperatura > max) add('conveniencia', 'vermelho', `${t.equipamento} a ${t.temperatura} °C`, `Máximo ${max} °C (${t.data} ${t.hora || ''})`, '#/r/temperaturas', t.data);
    }
    const pend = db.prepare(`SELECT COUNT(*) AS n FROM notas_entrada WHERE status = 'pendente' ${pf()}`).get().n;
    if (pend) add('conveniencia', 'amarelo', `${pend} nota(s) de entrada aguardando conferência`, '', '#/conveniencia/notas', hoje);
  }

  // ---------------- Preços
  if (can('precos')) {
    const dias = paramNum(db, 'pesquisa_dias', 2);
    const ult = db.prepare(`SELECT MAX(data) AS d FROM pesquisas_preco WHERE 1=1 ${pf()}`).get().d;
    if (!ult || diffDays(ult, hoje) > dias) add('precos', 'amarelo', 'Pesquisa de preços desatualizada', ult ? `Última em ${ult}` : 'Nenhuma pesquisa registrada', '#/precos', hoje);
    const pend = db.prepare('SELECT COUNT(*) AS n FROM historico_precos WHERE COALESCE(painel_atualizado,0) = 0').get().n;
    if (pend) add('precos', 'amarelo', 'Painel de preços da pista não confirmado', `${pend} alteração(ões) de preço sem confirmação`, '#/agenda', hoje);
  }

  // ---------------- Tarefas atrasadas e aprovações
  const tarefas = db.prepare(`SELECT * FROM tarefas WHERE concluida_at IS NULL AND data_prevista <= ? AND data_prevista >= ? ${pf()}`).all(hoje, addDays(hoje, -7));
  const minhas = tarefas.filter((t) => ['gerente', 'proprietario'].includes(u.perfil) || t.perfil === u.perfil || t.responsavel_id === u.id);
  const atrasadas = minhas.filter((t) => core.statusTarefa(t) === 'atrasada');
  if (atrasadas.length) add('agenda', 'vermelho', `${atrasadas.length} tarefa(s)/checklist(s) atrasado(s)`, [...new Set(atrasadas.map((t) => t.titulo))].slice(0, 4).join('; '), '#/agenda', hoje);
  if (u.perfil === 'gerente') {
    const ap = db.prepare("SELECT COUNT(*) AS n FROM aprovacoes WHERE status = 'pendente'").get().n;
    if (ap) add('admin', 'amarelo', `${ap} aprovação(ões) aguardando você`, 'Estornos, ajustes de estoque, abonos', '#/aprovacoes', hoje);
  }

  return out.sort((a, b) => NIVEL[a.nivel] - NIVEL[b.nivel] || String(a.data).localeCompare(String(b.data)));
}

// Envio diário dos avisos de vencimento (90/60/30/15/7 dias) e alertas críticos
async function enviarAvisosDiarios(db) {
  const hoje = today();
  const marcos = docs.avisosDias(db);
  const gerentes = db.prepare("SELECT * FROM usuarios WHERE perfil IN ('gerente','proprietario') AND ativo = 1").all();
  let n = 0;
  for (const d of db.prepare('SELECT * FROM documentos WHERE validade IS NOT NULL AND COALESCE(em_renovacao,0) = 0').all()) {
    const dias = diffDays(hoje, d.validade);
    const marco = dias < 0 ? 0 : marcos.find((m) => dias === m);
    if (marco === undefined) continue;
    const resp = d.responsavel_id ? db.prepare('SELECT * FROM usuarios WHERE id = ?').get(d.responsavel_id) : null;
    const msg = dias < 0
      ? `⚠️ VENCIDO: ${d.nome} venceu em ${d.validade}. Providencie a renovação imediatamente.`
      : `📅 ${d.nome} vence em ${dias} dias (${d.validade}). ${d.prazo_medio_dias ? `Prazo médio do órgão: ${d.prazo_medio_dias} dias.` : ''}`;
    for (const u of [resp, ...gerentes].filter(Boolean)) {
      for (const [canal, destino] of [['whatsapp', u.telefone], ['email', u.email]]) {
        if (!destino) continue;
        const chave = `doc:${d.id}:${d.validade}:${dias < 0 ? 'vencido:' + hoje.slice(0, 7) : marco}:${canal}:${u.id}`;
        if (await core.enviarNotificacao(db, { canal, destino, mensagem: msg, chave })) n++;
      }
    }
  }
  return n;
}

module.exports = { computeAlerts, enviarAvisosDiarios, porDias };
