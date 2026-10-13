// Módulo Combustíveis: LMC, tanques e GNV.
import { html, mount, $, get, post, toast, handleErr, fmt, badge, card, table, kpi, lineChart, today, addDays, downloadUrl, isRole } from '../lib.js';
import { setTitle, navigate, reload } from '../app.js';

export async function lmc(view, _p, query) {
  setTitle('LMC — Livro de Movimentação de Combustíveis');
  const data = query.data || addDays(today(), -1);
  const linhas = await get(`/api/comb/lmc?data=${data}`);
  const de = data.slice(0, 8) + '01';
  const periodo = await get(`/api/comb/lmc?de=${addDays(data, -13)}&ate=${data}`);
  const porProd = new Map();
  for (const l of periodo) { if (!porProd.has(l.combustivel)) porProd.set(l.combustivel, []); porProd.get(l.combustivel).push(l); }
  const cores = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)'];
  mount(view, html`
    <div class="page-head"><div><h1>LMC de ${fmt.date(data)}</h1><div class="sub">Estoque de abertura + recebimentos − vendas pelos encerrantes = escritural; comparado ao fechamento medido</div></div>
      <div class="row"><a class="btn" href="#/combustiveis/lmc?data=${addDays(data, -1)}">◀</a><input type="date" id="dia" value="${data}" max="${today()}"><a class="btn" href="#/combustiveis/lmc?data=${addDays(data, 1)}">▶</a>
        <button class="btn btn-primary" id="fechar">Conferir e fechar LMC do dia</button>
        <a class="btn" href="${downloadUrl(`/api/comb/lmc?format=csv&de=${de}&ate=${data}`)}">⬇ LMC do mês (CSV)</a>
        <button class="btn" onclick="window.print()">🖨 Imprimir para assinatura</button></div></div>
    ${card('', table([
      { label: 'Produto', get: (l) => html`<b>${l.combustivel}</b>` },
      { label: 'Estoque abertura', num: true, get: (l) => fmt.num(l.estoque_abertura, 2) },
      { label: '+ Recebimentos', num: true, get: (l) => fmt.num(l.recebimentos, 2) },
      { label: '− Vendas (encerrantes)', num: true, get: (l) => fmt.num(l.vendas, 2) },
      { label: '= Escritural', num: true, get: (l) => fmt.num(l.estoque_escritural, 2) },
      { label: 'Fechamento medido', num: true, get: (l) => (l.estoque_fechamento != null ? fmt.num(l.estoque_fechamento, 2) : badge('sem medição', 'yellow')) },
      { label: 'Perda (−) / sobra (+)', num: true, get: (l) => (l.perda_sobra != null ? html`<b class="${l.perda_sobra < 0 ? 'down' : 'up'}">${fmt.num(l.perda_sobra, 2)}</b>` : '—') },
      { label: '% disponível', num: true, get: (l) => (l.perda_sobra_pct != null ? (l.fora_tolerancia ? badge(fmt.pct(l.perda_sobra_pct, 2), 'red') : fmt.pct(l.perda_sobra_pct, 2)) : '—') },
    ], linhas, { rowAttrs: (l) => (l.fora_tolerancia ? 'class="crit"' : '') }))}
    <p class="muted"><small>Tolerância configurada: ${linhas[0]?.tolerancia_pct ?? 0.6}% do volume disponível (referência usual — confirmar regra vigente da ANP em Parâmetros). Linhas em vermelho exigem investigação (vazamento, aferição, desvio ou erro de medição).</small></p>
    <div class="mt">${card('Perdas e sobras — últimos 14 dias (%)', lineChart([...porProd.entries()].map(([nome, arr], i) => ({ name: nome, color: cores[i % 4], points: arr.map((l) => ({ x: l.data, y: l.perda_sobra_pct })) })), { yFormat: (n) => fmt.num(n, 2) + '%' }))}</div>`);
  $('#dia', view).addEventListener('change', (e) => navigate(`#/combustiveis/lmc?data=${e.target.value}`));
  $('#fechar', view).addEventListener('click', async () => {
    try { await post('/api/comb/lmc/fechar', { data }); toast('LMC conferido e registrado', 'ok'); } catch (e) { handleErr(e); }
  });
}

export async function tanques(view) {
  setTitle('Tanques e previsão de pedido');
  const ts = await get('/api/comb/tanques');
  mount(view, html`
    <div class="page-head"><div><h1>Estoque dos tanques</h1><div class="sub">Previsão de quando pedir com base na média de vendas dos últimos 7 dias</div></div>
      <div class="row"><a class="btn" href="#/r/medicoes_tanque">Medições</a><a class="btn btn-primary" href="#/r/descargas">Descargas</a></div></div>
    <div class="grid">${ts.map((t) => card(t.nome, html`<div class="tank">
      <div class="tank-gauge" title="${fmt.pct(t.ocupacao_pct)}"><span style="height:${Math.min(100, t.ocupacao_pct || 0)}%;${t.alerta ? 'background:var(--red)' : ''}"></span><i style="bottom:${t.capacidade ? (100 * t.estoque_minimo) / t.capacidade : 0}%"></i></div>
      <div style="flex:1;display:grid;gap:4px">
        <div><span class="muted">Estoque</span> <b>${fmt.num(t.estoque)} L</b> <small class="muted">(${fmt.pct(t.ocupacao_pct)} de ${fmt.num(t.capacidade)} L)</small></div>
        <div><span class="muted">Média de venda</span> <b>${fmt.num(t.media_diaria)} L/dia</b></div>
        <div><span class="muted">Dura</span> <b>${t.dias_estoque != null ? fmt.num(t.dias_estoque, 1) + ' dia(s)' : '—'}</b> ${t.alerta ? badge('pedir já', 'red') : ''}</div>
        <div><span class="muted">Pedir até</span> <b>${fmt.date(t.pedir_ate)}</b></div>
        <div><span class="muted">Sugestão de pedido</span> <b>${fmt.num(t.sugestao_pedido)} L</b></div>
        <small class="muted">Medido em ${t.medido_em || '—'}</small>
      </div></div>
      ${t.serie.length > 1 ? lineChart([{ name: 'Fechamento (L)', color: 'var(--c1)', points: t.serie.map((s) => ({ x: s.data, y: s.volume })) }], { height: 140, yFormat: (n) => fmt.num(n / 1000, 0) + 'k' }) : ''}`, badge(t.combustivel, 'blue')))}</div>`);
}

export async function gnv(view) {
  setTitle('GNV');
  const g = await get('/api/comb/gnv');
  if (!g.disponivel) { mount(view, html`<div class="card empty">GNV não cadastrado.</div>`); return; }
  mount(view, html`
    <div class="page-head"><div><h1>GNV</h1><div class="sub">Vendas em m³, margem, manutenção do compressor e operadores habilitados</div></div>
      <div class="row"><a class="btn" href="#/r/equipamentos">Registrar manutenção</a><a class="btn" href="#/rh/escalas">Escala do GNV</a></div></div>
    <div class="kpis">
      ${kpi('Vendas no mês', `${fmt.num(g.m3)} m³`, fmt.brl(g.valor))}
      ${kpi('Margem', fmt.brl(g.margem), fmt.pct(g.margem_pct))}
      ${kpi('Ticket médio', fmt.brl(g.ticket), `${g.abastecimentos} abastecimentos`)}
      ${kpi('Preço / custo', `${fmt.brl3(g.preco)}`, `custo ${fmt.brl3(g.custo)}/m³`)}
    </div>
    <div class="grid g2">
      ${card('Manutenções e inspeções', table([
        { label: 'Data', get: (m) => fmt.date(m.data) }, { label: 'Tipo', get: (m) => m.tipo }, { label: 'Horas', num: true, get: (m) => fmt.num(m.horas_operacao) },
        { label: 'Próxima', get: (m) => (m.proxima_data ? (m.proxima_data < today() ? badge(fmt.date(m.proxima_data), 'red') : fmt.date(m.proxima_data)) : '') }, { label: 'Responsável', get: (m) => m.responsavel },
      ], g.manutencoes))}
      ${card('Operadores habilitados', html`${table([{ label: 'Operador', get: (o) => o.nome }], g.operadores)}
        <h3 class="mt">Escala do GNV hoje</h3>${table([{ label: 'Operador', get: (e) => e.nome }, { label: 'Turno', get: (e) => e.turno }], g.escala_hoje, { empty: 'Ninguém escalado no GNV hoje' })}`)}
    </div>`);
}

export { reload, isRole };
