// Módulo Pesquisa de Preços e Margem.
import { html, raw, mount, $, $$, get, post, toast, handleErr, fmt, badge, card, table, lineChart, isRole, canWrite, modal } from '../lib.js';
import { setTitle, reload } from '../app.js';

export async function painel(view, _p, query) {
  setTitle('Preços e margem');
  const [p, custos] = await Promise.all([get('/api/precos/painel'), get('/api/precos/custos')]);
  const sel = Number(query.c) || p[0]?.combustivel_id;
  const evo = await get(`/api/precos/evolucao/${sel}?dias=60`);
  const POS = { abaixo: ['Abaixo da média', 'green'], acima: ['Acima da média', 'yellow'], 'na média': ['Na média', 'blue'] };
  const gerente = isRole('gerente');
  mount(view, html`
    <div class="page-head"><div><h1>Meu preço está competitivo e com margem?</h1><div class="sub">Pesquisa dos concorrentes (últimos 7 dias), média ANP do município e custo da última compra</div></div>
      <div class="row">${canWrite('pesquisas_preco') ? html`<button class="btn btn-primary" id="pesq">+ Registrar pesquisa (com foto)</button>` : ''}<a class="btn" href="#/r/historico_precos">Histórico de alterações</a></div></div>
    <div class="grid">${p.map((c) => card(c.combustivel, html`
      <div class="row between"><div><div class="muted">Preço da bomba</div><div style="font-size:24px;font-weight:700">${fmt.brl3(c.preco)}</div></div>
        <div class="right"><div class="muted">Margem</div><div style="font-size:18px;font-weight:700">${fmt.brl3(c.margem_un)} <small>(${fmt.pct(c.margem_pct)})</small></div></div></div>
      <div class="mt" style="display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;font-size:13px">
        <span class="muted">Custo última compra</span><b class="right">${fmt.brl3(c.custo)}</b>
        <span class="muted">Média concorrentes</span><b class="right">${fmt.brl3(c.media_concorrentes)}</b>
        <span class="muted">Faixa concorrentes</span><b class="right">${c.min_concorrentes != null ? `${fmt.brl3(c.min_concorrentes)} – ${fmt.brl3(c.max_concorrentes)}` : '—'}</b>
        <span class="muted">Média ANP</span><b class="right">${c.anp ? fmt.brl3(c.anp.medio) : '—'}</b>
        <span class="muted">Volume 30 dias</span><b class="right">${fmt.num(c.volume_30d)} ${c.unidade}</b>
      </div>
      <div class="row mt"><input type="number" step="0.01" placeholder="Simular novo preço" data-sim="${c.combustivel_id}" style="flex:1"><button class="btn btn-sm" data-simb="${c.combustivel_id}">Simular</button>
        ${gerente ? html`<button class="btn btn-sm btn-primary" data-alt="${c.combustivel_id}" data-nome="${c.combustivel}" data-preco="${c.preco}">Alterar preço</button>` : ''}</div>
      <div data-res="${c.combustivel_id}"></div>`, c.posicao ? badge(POS[c.posicao][0], POS[c.posicao][1]) : ''))}</div>

    <div class="grid g2 mt">
      ${card(html`Evolução: preço × concorrentes × custo <select id="evo-sel" style="margin-left:8px">${p.map((c) => html`<option value="${c.combustivel_id}" ${raw(c.combustivel_id === sel ? 'selected' : '')}>${c.combustivel}</option>`)}</select>`, lineChart([
        { name: 'Preço do posto', color: 'var(--c1)', points: evo.serie.map((s) => ({ x: s.data, y: s.posto })) },
        { name: 'Média concorrentes', color: 'var(--c2)', points: evo.serie.map((s) => ({ x: s.data, y: s.concorrentes })) },
        { name: 'Custo de compra', color: 'var(--c5)', points: evo.serie.map((s) => ({ x: s.data, y: s.custo })) },
        { name: 'Média ANP', color: 'var(--c3)', dash: true, points: evo.serie.map((s) => ({ x: s.data, y: s.anp })) },
      ], { yFormat: (n) => fmt.num(n, 2) }))}
      ${card('Últimos preços dos concorrentes', table([
        { label: 'Concorrente', get: (r) => r.nome },
        ...p.slice(0, 4).map((c) => ({ label: c.combustivel.replace('Gasolina', 'Gas.'), num: true, get: (r) => { const x = c.concorrentes.find((k) => k.nome === r.nome); return x ? html`${fmt.brl3(x.preco)}<br><small class="muted">${fmt.short(x.data)}</small>` : '—'; } })),
      ], [...new Set(p.flatMap((c) => c.concorrentes.map((k) => k.nome)))].map((nome) => ({ nome }))))}
      ${card('Histórico de custo de compra por distribuidora e carga', table([
        { label: 'Data', get: (r) => fmt.date(r.data) }, { label: 'Produto', get: (r) => r.combustivel }, { label: 'Distribuidora', get: (r) => r.distribuidora || '—' },
        { label: 'NF', get: (r) => r.nota }, { label: 'Volume', num: true, get: (r) => fmt.num(r.volume_nf) }, { label: 'Custo/L', num: true, get: (r) => fmt.brl3(r.custo_unitario) },
      ], custos.slice(0, 15)), html`<a href="#/r/descargas">todas as cargas</a>`)}
    </div>`);

  $('#evo-sel', view).addEventListener('change', (e) => { location.hash = `#/precos?c=${e.target.value}`; });
  const simular = async (id) => {
    const v = $(`[data-sim="${id}"]`, view).value;
    if (!v) return;
    try {
      const s = await get(`/api/precos/simular?combustivel_id=${id}&preco=${v}`);
      mount($(`[data-res="${id}"]`, view), html`<div class="alert-item ${s.nova_margem_un < 0 ? 'vermelho' : 'verde'} mt" style="display:block">
        <div>Margem: <b>${fmt.brl3(s.nova_margem_un)}</b> (${fmt.pct(s.nova_margem_pct)}) · ${s.dif_media_nova != null ? html`${s.dif_media_nova > 0 ? 'acima' : 'abaixo'} da média em ${fmt.brl3(Math.abs(s.dif_media_nova))}` : ''}</div>
        <small>Volume estimado/mês: ${fmt.num(s.volume_mes_estimado)} (atual ${fmt.num(s.volume_mes_atual)}) · Faturamento ${fmt.brl(s.faturamento_estimado)} · Lucro bruto ${fmt.brl(s.lucro_bruto_estimado)} (atual ${fmt.brl(s.lucro_bruto_atual)})</small>
        <div class="muted"><small>Elasticidade estimada ${s.elasticidade} (ajustável em Parâmetros)</small></div></div>`);
    } catch (e) { handleErr(e); }
  };
  $$('[data-simb]', view).forEach((b) => b.addEventListener('click', () => simular(b.dataset.simb)));
  $$('[data-sim]', view).forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') simular(i.dataset.sim); }));
  $$('[data-alt]', view).forEach((b) => b.addEventListener('click', () => {
    const m = modal({
      title: `Alterar preço — ${b.dataset.nome}`, size: 'sm',
      body: html`<form id="alt" class="form-grid" style="grid-template-columns:1fr"><label>Preço atual<input disabled value="${fmt.brl3(b.dataset.preco)}"></label>
        <label>Novo preço (R$)<input type="number" step="0.001" name="preco" value="${$(`[data-sim="${b.dataset.alt}"]`, view).value}" required></label>
        <label>Motivo<input name="motivo" required placeholder="Ex.: reajuste da distribuidora"></label></form>
        <p class="muted"><small>A alteração fica no histórico e gera tarefa para o chefe de pista atualizar o painel de preços.</small></p>`,
      foot: html`<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" id="ok">Confirmar</button>`,
    });
    $('#ok', m.el).addEventListener('click', async () => {
      const f = $('#alt', m.el);
      if (!f.reportValidity()) return;
      try { await post('/api/precos/alterar', { combustivel_id: Number(b.dataset.alt), preco: f.preco.value, motivo: f.motivo.value }); toast('Preço alterado', 'ok'); m.close(); reload(); } catch (e) { handleErr(e); }
    });
  }));
  $('#pesq', view)?.addEventListener('click', async () => {
    const { openRecord } = await import('./crud.js');
    openRecord('pesquisas_preco', null, { data: new Date().toISOString().slice(0, 10), hora: new Date().toTimeString().slice(0, 5) }, { onSaved: reload });
  });
}
