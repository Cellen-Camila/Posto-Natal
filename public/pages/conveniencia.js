// Módulo Conveniência.
import {
  html, raw, mount, $, $$, get, post, toast, handleErr, fmt, badge, card, table, kpi, barChart, lineChart, hbars, today, addDays,
  canWrite, refOptions,
} from '../lib.js';
import { setTitle, navigate, reload } from '../app.js';

export async function visao(view, _p, query) {
  setTitle('Conveniência');
  const de = query.de || today().slice(0, 8) + '01';
  const ate = query.ate || today();
  const [v, parados, perdas] = await Promise.all([get(`/api/conv/vendas?de=${de}&ate=${ate}`), get('/api/conv/parados'), get('/api/conv/perdas')]);
  mount(view, html`
    <div class="page-head"><div><h1>Conveniência</h1><div class="sub">Tratada como negócio próprio: vendas, margem, estoque e exigências sanitárias</div></div>
      <form class="row" id="per"><input type="date" name="de" value="${de}"><input type="date" name="ate" value="${ate}"><button class="btn">Aplicar</button></form></div>
    <div class="kpis">
      ${kpi('Faturamento', fmt.brl(v.faturamento), `${fmt.num(v.cupons)} cupons`)}
      ${kpi('Lucro bruto', fmt.brl(v.lucro), `Margem ${fmt.pct(v.margem_pct)}`)}
      ${kpi('Ticket médio', fmt.brl(v.ticket_medio))}
      ${kpi('Perdas e avarias', fmt.brl(v.perdas), `${fmt.pct(v.indice_perdas_pct, 2)} do faturamento`, { href: '#/r/perdas', tone: v.indice_perdas_pct > 1 ? 'yellow' : '' })}
      ${kpi('Produtos parados', parados.length, `${fmt.brl(parados.reduce((a, p) => a + p.valor_parado, 0))} em estoque`, { href: '#/conveniencia/abc' })}
    </div>
    <div class="grid g2">
      ${card('Por categoria', table([
        { label: 'Categoria', get: (c) => c.categoria },
        { label: 'Faturamento', num: true, get: (c) => fmt.brl(c.valor) },
        { label: 'Margem', num: true, get: (c) => html`${fmt.pct(c.margem_pct)}${c.margem_alvo && c.margem_pct < c.margem_alvo - 3 ? html` ${badge(`alvo ${c.margem_alvo}%`, 'yellow')}` : ''}` },
      ], v.por_categoria))}
      ${card('Vendas por hora do dia', barChart(v.por_hora.map((h) => ({ label: h.hora, value: h.valor })), { yFormat: (n) => fmt.num(n / 1000, 1) + 'k' }))}
      ${card('Faturamento e ticket por dia', lineChart([
        { name: 'Faturamento', color: 'var(--c2)', points: v.por_dia.map((d) => ({ x: d.data, y: d.valor })) },
      ], { yFormat: (n) => fmt.brl(n) }))}
      ${card('Índice de perdas (meta: reduzir divergência em 30%)', table([
        { label: 'Mês', get: (p) => p.competencia },
        { label: 'Faturamento', num: true, get: (p) => fmt.brl(p.faturamento) },
        { label: 'Perdas', num: true, get: (p) => fmt.brl(p.perdas) },
        { label: 'Divergência de contagem', num: true, get: (p) => fmt.brl(p.divergencia_contagem) },
        { label: 'Índice', num: true, get: (p) => fmt.pct(p.indice_pct, 2) },
      ], perdas))}
    </div>`);
  $('#per', view).addEventListener('submit', (e) => { e.preventDefault(); navigate(`#/conveniencia?de=${e.target.de.value}&ate=${e.target.ate.value}`); });
}

export async function abc(view) {
  setTitle('Curva ABC e produtos parados');
  const [a, parados] = await Promise.all([get('/api/conv/abc'), get('/api/conv/parados')]);
  const tone = { A: 'green', B: 'blue', C: '' };
  mount(view, html`
    <div class="page-head"><div><h1>Curva ABC (últimos 90 dias)</h1><div class="sub">Classe A: produtos que somam 80% do faturamento</div></div></div>
    <div class="kpis">${a.resumo.map((r) => kpi(`Classe ${r.classe}`, `${r.produtos} produtos`, `${fmt.pct(r.pct_produtos)} dos itens · ${fmt.pct(r.pct_faturamento)} do faturamento`))}</div>
    <div class="grid g2">
      ${card('Itens', table([
        { label: 'Classe', get: (i) => badge(i.classe, tone[i.classe]) },
        { label: 'Produto', get: (i) => i.nome },
        { label: 'Qtd.', num: true, get: (i) => fmt.num(i.qtd) },
        { label: 'Faturamento', num: true, get: (i) => fmt.brl(i.valor) },
        { label: 'Lucro', num: true, get: (i) => fmt.brl(i.lucro) },
        { label: '% acum.', num: true, get: (i) => fmt.pct(i.acumulado) },
        { label: 'Estoque', num: true, get: (i) => fmt.num(i.estoque) },
      ], a.itens))}
      ${card('Produtos parados (sem venda há 30, 60, 90 dias)', table([
        { label: 'Produto', get: (p) => p.nome },
        { label: 'Última venda', get: (p) => (p.ultima_venda ? fmt.date(p.ultima_venda) : 'nunca') },
        { label: 'Faixa', get: (p) => badge(p.faixa === 'nunca' ? 'sem venda' : `${p.faixa} dias`, p.faixa === '30+' ? 'yellow' : 'red') },
        { label: 'Estoque', num: true, get: (p) => fmt.num(p.estoque) },
        { label: 'Valor parado', num: true, get: (p) => fmt.brl(p.valor_parado) },
      ], parados, { empty: 'Nenhum produto parado ✔' }))}
    </div>`);
}

export async function notas(view) {
  setTitle('Entrada de notas');
  const { rows } = await get('/api/r/notas_entrada?limit=100');
  const ST = { pendente: ['Pendente', 'yellow'], conferida: ['Conferida', 'green'], divergente: ['Com divergência', 'red'] };
  mount(view, html`
    <div class="page-head"><div><h1>Entrada de notas</h1><div class="sub">Conferência do XML da NF-e contra o pedido e o recebido: quantidade, preço e validade</div></div>
      <div class="row">${canWrite('notas_entrada') ? html`<label class="btn btn-primary">⬆ Importar XML da NF-e<input type="file" id="xml" accept=".xml" multiple hidden></label>` : ''}</div></div>
    ${card('Notas', table([
      { label: 'Emissão', get: (n) => fmt.date(n.data) }, { label: 'Número', get: (n) => n.numero }, { label: 'Fornecedor', get: (n) => n._labels?.fornecedor_id || '' },
      { label: 'Itens', num: true, get: (n) => (n.itens || []).length }, { label: 'Valor', num: true, get: (n) => fmt.brl(n.valor) },
      { label: 'Situação', get: (n) => badge(ST[n.status][0], ST[n.status][1]) },
    ], rows, { rowAttrs: (n) => `class="click" data-n="${n.id}"` }))}`);
  $$('tr[data-n]', view).forEach((tr) => tr.addEventListener('click', () => navigate(`#/conveniencia/notas/${tr.dataset.n}`)));
  $('#xml', view)?.addEventListener('change', async (e) => {
    let last = null;
    for (const f of e.target.files) {
      try { last = await post('/api/conv/nfe', { xml: await f.text() }); toast(`NF ${last.numero} importada`, 'ok'); } catch (err) { handleErr(err); }
    }
    if (last && e.target.files.length === 1) navigate(`#/conveniencia/notas/${last.id}`); else reload();
  });
}

export async function conferencia(view, [id]) {
  const n = await get(`/api/r/notas_entrada/${id}`);
  setTitle(`Conferência NF ${n.numero}`);
  const pend = n.status === 'pendente' && canWrite('notas_entrada');
  const prods = await refOptions('produtos');
  mount(view, html`
    <div class="page-head"><div><h1>NF ${n.numero} — ${n._labels?.fornecedor_id || ''}</h1><div class="sub">Emissão ${fmt.date(n.data)} · ${fmt.brl(n.valor)}${n.pedido_ref ? ` · pedido ${n.pedido_ref}` : ''}</div></div>
      <a class="btn" href="#/conveniencia/notas">Voltar</a></div>
    <form id="conf">${card('Itens', table([
      { label: 'Item da nota', get: (i) => html`<b>${i.descricao}</b><br><small class="muted">cód. ${i.codigo}</small>` },
      { label: 'Produto no cadastro', get: (i, idx) => (pend ? html`<select data-prod="${idx}"><option value="">— não vinculado —</option>${prods.map((p) => html`<option value="${p.id}" ${raw(p.id === i.produto_id ? 'selected' : '')}>${p.label}</option>`)}</select>` : i.produto || '—') },
      { label: 'Qtd. NF', num: true, get: (i) => fmt.num(i.qtd_nf, 2) },
      { label: 'Qtd. recebida', num: true, get: (i, idx) => (pend ? html`<input type="number" step="0.01" data-qtd="${idx}" value="${i.qtd_nf}" style="width:90px">` : html`${fmt.num(i.qtd_recebida, 2)} ${i.divergencia ? badge(i.divergencia > 0 ? '+' + i.divergencia : i.divergencia, 'red') : ''}`) },
      { label: 'Custo NF', num: true, get: (i) => fmt.brl(i.custo_nf) },
      { label: 'Custo anterior', num: true, get: (i) => (i.custo_anterior != null ? html`${fmt.brl(i.custo_anterior)} ${i.custo_nf > i.custo_anterior * 1.001 ? badge(`+${fmt.pct(100 * (i.custo_nf / i.custo_anterior - 1))}`, 'red') : ''}` : '—') },
      { label: 'Validade', get: (i, idx) => (pend ? html`<input type="date" data-val="${idx}">` : i.validade ? fmt.date(i.validade) : '') },
    ], n.itens || []))}
    ${pend ? html`<div class="row mt"><label class="field">Pedido de compra<input name="pedido_ref" value="${n.pedido_ref || ''}"></label><button class="btn btn-primary btn-lg" type="submit">Confirmar recebimento</button></div>` : ''}</form>
    <div id="alertas" class="mt"></div>`);
  $('#conf', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    const itens = (n.itens || []).map((_i, idx) => ({ idx, qtd_recebida: $(`[data-qtd="${idx}"]`, view).value, validade: $(`[data-val="${idx}"]`, view).value || null, produto_id: $(`[data-prod="${idx}"]`, view).value || null }));
    try {
      const r = await post(`/api/conv/notas/${id}/conferir`, { itens, pedido_ref: e.target.pedido_ref.value });
      toast(r.divergente ? 'Conferida com divergência registrada' : 'Nota conferida e estoque atualizado', r.divergente ? 'err' : 'ok');
      if (r.alertas_preco.length) {
        mount($('#alertas', view), card('⚠ Custo subiu — revise o preço de venda', table([
          { label: 'Produto', get: (a) => a.produto }, { label: 'Custo anterior', num: true, get: (a) => fmt.brl(a.custo_anterior) }, { label: 'Novo custo', num: true, get: (a) => fmt.brl(a.custo_novo) },
          { label: 'Aumento', num: true, get: (a) => fmt.pct(a.aumento_pct) }, { label: 'Margem com preço atual', num: true, get: (a) => fmt.pct(a.margem_nova) },
        ], r.alertas_preco), html`<a class="btn btn-sm" href="#/conveniencia/precos">Precificação</a>`));
      } else reload();
    } catch (err) { handleErr(err); }
  });
}

export async function contagem(view, _p, query) {
  setTitle('Contagem de estoque');
  const cats = await refOptions('categorias_conv');
  const cat = query.categoria || '';
  const { rows } = await get(`/api/r/produtos?f_local=conveniencia&limit=1000${cat ? `&f_categoria_id=${cat}` : ''}`);
  const w = canWrite('contagens');
  mount(view, html`
    <div class="page-head"><div><h1>Contagem de estoque</h1><div class="sub">Contagem cíclica por categoria ou inventário geral — ajustes com divergência vão para aprovação do gerente</div></div>
      <div class="row"><select id="cat"><option value="">Todas as categorias (inventário geral)</option>${cats.map((c) => html`<option value="${c.id}" ${raw(String(c.id) === cat ? 'selected' : '')}>${c.label}</option>`)}</select>
        <a class="btn" href="#/r/contagens">Histórico</a></div></div>
    <form id="cont">${card(`${rows.length} produto(s)`, table([
      { label: 'Produto', get: (p) => html`${p.nome}<br><small class="muted">${p.codigo || ''}</small>` },
      { label: 'Sistema', num: true, get: (p) => fmt.num(p.estoque, 2) },
      { label: 'Contado', num: true, get: (p) => (w ? html`<input type="number" step="0.01" inputmode="decimal" data-p="${p.id}" data-s="${p.estoque}" data-c="${p.custo}" style="width:90px">` : '') },
      { label: 'Diferença', num: true, get: (p) => html`<span data-d="${p.id}"></span>` },
    ], rows))}
    ${w ? html`<div class="row mt"><b id="tot"></b><span class="spacer"></span><button class="btn btn-primary btn-lg" type="submit">Registrar contagem</button></div>` : ''}</form>`);
  $('#cat', view).addEventListener('change', (e) => navigate(`#/conveniencia/contagem?categoria=${e.target.value}`));
  const recalc = () => {
    let q = 0, v = 0;
    $$('[data-p]', view).forEach((i) => {
      const el = $(`[data-d="${i.dataset.p}"]`, view);
      if (i.value === '') { el.textContent = ''; return; }
      const d = Number(i.value) - Number(i.dataset.s);
      q += Math.abs(d); v += d * Number(i.dataset.c || 0);
      el.innerHTML = d ? `<span class="${d < 0 ? 'down' : 'up'}">${d > 0 ? '+' : ''}${fmt.num(d, 2)}</span>` : '✔';
    });
    const tot = $('#tot', view);
    if (tot) tot.textContent = `Divergência: ${fmt.num(q, 2)} un. · ${fmt.brl(v)}`;
  };
  $$('[data-p]', view).forEach((i) => i.addEventListener('input', recalc));
  $('#cont', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    const itens = $$('[data-p]', view).filter((i) => i.value !== '').map((i) => ({ produto_id: Number(i.dataset.p), contado: Number(i.value) }));
    if (!itens.length) { toast('Informe ao menos uma quantidade contada', 'err'); return; }
    try {
      const r = await post('/api/conv/contagem', { tipo: cat ? 'ciclica' : 'geral', itens });
      toast(`${r.contados} contado(s), ${r.divergentes} com divergência (${fmt.brl(r.divergencia_valor)})${r.divergentes ? ' — enviado para aprovação' : ''}`, 'ok');
      navigate('#/r/contagens');
    } catch (err) { handleErr(err); }
  });
}

export async function precos(view) {
  setTitle('Precificação');
  const rows = await get('/api/conv/precos');
  const w = canWrite('produtos');
  mount(view, html`
    <div class="page-head"><div><h1>Precificação pela margem-alvo</h1><div class="sub">Preço sugerido = custo ÷ (1 − margem-alvo da categoria). Alerta quando o custo sobe e a margem cai.</div></div>
      <a class="btn" href="#/r/categorias_conv">Margens-alvo por categoria</a></div>
    ${card(`${rows.filter((r) => r.abaixo_alvo).length} produto(s) abaixo da margem-alvo`, table([
      { label: 'Produto', get: (p) => html`${p.nome}<br><small class="muted">${p.categoria || ''}</small>` },
      { label: 'Custo', num: true, get: (p) => fmt.brl(p.custo) },
      { label: 'Preço atual', num: true, get: (p) => fmt.brl(p.preco) },
      { label: 'Margem atual', num: true, get: (p) => (p.abaixo_alvo ? badge(fmt.pct(p.margem_atual), 'red') : fmt.pct(p.margem_atual)) },
      { label: 'Margem-alvo', num: true, get: (p) => (p.margem_alvo ? fmt.pct(p.margem_alvo) : '—') },
      { label: 'Preço sugerido', num: true, get: (p) => html`<b>${fmt.brl(p.preco_sugerido)}</b>` },
      { label: '', get: (p) => (w && p.preco_sugerido && Math.abs(p.preco_sugerido - p.preco) > 0.009 ? html`<button class="btn btn-sm" data-ap="${p.id}" data-v="${(Math.ceil(p.preco_sugerido * 10) / 10 - 0.01).toFixed(2)}">Aplicar R$ ${(Math.ceil(p.preco_sugerido * 10) / 10 - 0.01).toFixed(2).replace('.', ',')}</button>` : '') },
    ], [...rows].sort((a, b) => Number(b.abaixo_alvo) - Number(a.abaixo_alvo)), { rowAttrs: (p) => (p.abaixo_alvo ? 'class="warn"' : '') }))}`);
  $$('[data-ap]', view).forEach((b) => b.addEventListener('click', async () => {
    try { await post(`/api/conv/precos/${b.dataset.ap}`, { preco: Number(b.dataset.v) }); toast('Preço atualizado — lembre de atualizar a etiqueta/PDV', 'ok'); reload(); } catch (e) { handleErr(e); }
  }));
}

export { hbars, addDays };
