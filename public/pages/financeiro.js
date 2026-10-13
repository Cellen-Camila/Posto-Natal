// Módulo Financeiro.
import {
  html, mount, $, $$, get, post, toast, handleErr, fmt, badge, card, table, kpi, lineChart, barChart, hbars, compSelect, competencia,
  compLabel, prevComp, today, addDays, canWrite, downloadUrl,
} from '../lib.js';
import { setTitle, navigate, reload } from '../app.js';

const PAG = { dinheiro: 'Dinheiro', debito: 'Débito', credito: 'Crédito', pix: 'PIX', prazo: 'A prazo', frota: 'Frota' };
const PER = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' };

export async function indicadores(view, _p, query) {
  setTitle('Vendas e indicadores');
  const de = query.de || today().slice(0, 8) + '01';
  const ate = query.ate || today();
  const d = await get(`/api/fin/indicadores?de=${de}&ate=${ate}`);
  const pista = d.totais.find((t) => t.origem === 'pista') || {};
  const conv = d.totais.find((t) => t.origem === 'conveniencia') || {};
  const mix = {};
  for (const m of d.mix) mix[m.forma_pagamento] = (mix[m.forma_pagamento] || 0) + m.valor;
  const totalMix = Object.values(mix).reduce((a, b) => a + b, 0) || 1;
  const dias = [...new Set(d.por_dia.map((x) => x.data))];
  mount(view, html`
    <div class="page-head"><div><h1>Vendas e indicadores</h1><div class="sub">Dados importados do Linx/Webposto</div></div>
      <form class="row" id="per"><input type="date" name="de" value="${de}"><input type="date" name="ate" value="${ate}"><button class="btn">Aplicar</button>
        <a class="btn" href="#/financeiro/importar">Importar vendas</a></form></div>
    <div class="kpis">
      ${kpi('Faturamento pista', fmt.brl(pista.valor), `Margem ${fmt.pct(pista.margem_pct)}`)}
      ${kpi('Faturamento conveniência', fmt.brl(conv.valor), `Margem ${fmt.pct(conv.margem_pct)}`, { href: '#/conveniencia' })}
      ${kpi('Ticket médio pista', fmt.brl(pista.ticket), `${fmt.num(pista.cupons)} abastecimentos`)}
      ${kpi('Ticket médio conveniência', fmt.brl(conv.ticket), `${fmt.num(conv.cupons)} cupons`)}
      ${kpi('Faltas de caixa', fmt.brl(d.faltas_caixa), 'no período', { href: '#/pista/faltas', tone: d.faltas_caixa ? 'yellow' : '' })}
    </div>
    <div class="grid g2">
      ${card('Por produto — litros, preço médio e margem bruta', table([
        { label: 'Produto', get: (r) => r.produto },
        { label: 'Quantidade', num: true, get: (r) => `${fmt.num(r.qtd)} ${r.unidade}` },
        { label: 'Faturamento', num: true, get: (r) => fmt.brl(r.valor) },
        { label: 'Preço médio', num: true, get: (r) => fmt.brl3(r.preco_medio) },
        { label: 'Margem R$/un.', num: true, get: (r) => fmt.brl3(r.margem_un) },
        { label: 'Margem %', num: true, get: (r) => fmt.pct(r.margem_pct) },
      ], d.por_produto))}
      ${card('Mix de pagamento', hbars(Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: PAG[k] || k, value: v })), { format: (v) => `${fmt.brl(v)} (${fmt.pct(100 * v / totalMix)})` }))}
      ${card('Por turno', table([
        { label: 'Turno', get: (r) => PER[r.periodo] || r.periodo },
        { label: 'Litros', num: true, get: (r) => fmt.num(r.litros) },
        { label: 'Faturamento', num: true, get: (r) => fmt.brl(r.valor) },
        { label: 'Abastecimentos', num: true, get: (r) => fmt.num(r.n) },
        { label: 'Ticket médio', num: true, get: (r) => fmt.brl(r.ticket) },
      ], d.por_turno))}
      ${card('Por frentista', table([
        { label: 'Frentista', get: (r) => r.nome },
        { label: 'Litros', num: true, get: (r) => fmt.num(r.litros) },
        { label: 'Faturamento', num: true, get: (r) => fmt.brl(r.valor) },
        { label: 'Ticket médio', num: true, get: (r) => fmt.brl(r.ticket) },
      ], d.por_frentista))}
      ${card('Por bico', table([
        { label: 'Bico', get: (r) => r.bico }, { label: 'Litros', num: true, get: (r) => fmt.num(r.litros) }, { label: 'Faturamento', num: true, get: (r) => fmt.brl(r.valor) },
      ], d.por_bico))}
      ${card('Faturamento diário', lineChart([
        { name: 'Pista', color: 'var(--c1)', points: dias.map((x) => ({ x, y: d.por_dia.find((r) => r.data === x && r.origem === 'pista')?.valor ?? 0 })) },
        { name: 'Conveniência', color: 'var(--c2)', points: dias.map((x) => ({ x, y: d.por_dia.find((r) => r.data === x && r.origem === 'conveniencia')?.valor ?? 0 })) },
      ], { yFormat: (n) => fmt.num(n / 1000, 0) + 'k' }))}
    </div>`);
  $('#per', view).addEventListener('submit', (e) => { e.preventDefault(); navigate(`#/financeiro?de=${e.target.de.value}&ate=${e.target.ate.value}`); });
}

export async function inadimplencia(view) {
  setTitle('Inadimplência');
  const d = await get('/api/fin/inadimplencia');
  mount(view, html`
    <div class="page-head"><div><h1>Contas a receber e inadimplência</h1><div class="sub">Bloqueio automático acima do limite de crédito ou com título vencido além do prazo configurado</div></div>
      <div class="row"><a class="btn" href="#/r/contas_receber?f_status=aberta">Títulos em aberto</a><a class="btn" href="#/r/cobrancas">Histórico de cobrança</a></div></div>
    <div class="kpis">
      ${kpi('Total em aberto', fmt.brl(d.total_aberto))}
      ${kpi('Total vencido', fmt.brl(d.total_vencido), '', { tone: d.total_vencido ? 'red' : 'green' })}
      ${Object.entries(d.faixas).map(([k, v]) => kpi(`Vencido ${k} dias`, fmt.brl(v), '', { tone: v ? (k === '1-15' ? 'yellow' : 'red') : '' }))}
    </div>
    ${card('Por cliente', table([
      { label: 'Cliente', get: (c) => html`<a href="#/r/contas_receber?f_cliente_id=${c.cliente_id}">${c.nome}</a> ${c.bloqueado ? badge('Bloqueado', 'red') : ''}` },
      { label: 'Limite', num: true, get: (c) => fmt.brl(c.limite) },
      { label: 'Em aberto', num: true, get: (c) => fmt.brl(c.aberto) },
      { label: 'Uso do limite', num: true, get: (c) => (c.uso_limite != null ? html`<span class="${c.uso_limite > 100 ? 'down' : ''}">${fmt.pct(c.uso_limite)}</span>` : '—') },
      { label: '1–15', num: true, get: (c) => fmt.brl(c['1-15']) },
      { label: '16–30', num: true, get: (c) => fmt.brl(c['16-30']) },
      { label: '31–60', num: true, get: (c) => fmt.brl(c['31-60']) },
      { label: '+60', num: true, get: (c) => fmt.brl(c['+60']) },
      { label: 'Maior atraso', num: true, get: (c) => (c.maior_atraso ? `${c.maior_atraso} d` : '') },
      { label: '', get: (c) => html`<a class="btn btn-sm" href="#/r/cobrancas?f_cliente_id=${c.cliente_id}">Cobranças</a>` },
    ], d.clientes, { rowAttrs: (c) => (c.vencido ? 'class="warn"' : '') }))}`);
}

export async function conciliacao(view) {
  setTitle('Conciliação bancária');
  const [saldo, pend, cb, contas] = await Promise.all([
    get('/api/fin/saldo'), get('/api/r/extrato?f_conciliado_tipo=null&limit=300'), get('/api/fin/caixa-banco'), get('/api/r/contas_bancarias'),
  ]);
  const w = canWrite('extrato');
  mount(view, html`
    <div class="page-head"><div><h1>Conciliações</h1><div class="sub">Extrato (OFX) × pagamentos, recebimentos, cartões e depósitos dos caixas</div></div>
      <div class="row">${w ? html`<select id="conta">${contas.rows.map((c) => html`<option value="${c.id}">${c.nome}</option>`)}</select>
        <label class="btn btn-primary">⬆ Importar extrato OFX<input type="file" id="ofx" accept=".ofx,.txt" hidden></label>
        <button class="btn" id="auto">Conciliar automaticamente</button>` : ''}<a class="btn" href="#/r/extrato">Extrato completo</a></div></div>
    <div class="kpis">${saldo.contas.map((c) => kpi(c.nome, fmt.brl(c.saldo), c.banco))}${kpi('Saldo consolidado', fmt.brl(saldo.total))}${kpi('Lançamentos pendentes', pend.total, 'sem conciliação', { tone: pend.total ? 'yellow' : 'green' })}</div>
    <div class="grid g2">
      ${card('Lançamentos do extrato sem conciliação', table([
        { label: 'Data', get: (e) => fmt.date(e.data) },
        { label: 'Histórico', get: (e) => e.descricao },
        { label: 'Valor', num: true, get: (e) => html`<span class="${e.valor < 0 ? 'down' : 'up'}">${fmt.brl(e.valor)}</span>` },
        { label: '', get: (e) => (w ? html`<select data-conc="${e.id}"><option value="">conciliar como…</option><option value="tarifa">Tarifa bancária</option><option value="deposito_caixa">Depósito de caixa</option><option value="transferencia">Transferência entre contas</option><option value="outros">Outros (justificado)</option></select>` : '') },
      ], pend.rows, { empty: 'Tudo conciliado ✔' }))}
      ${card('Dinheiro e PIX: caixas × banco', table([
        { label: 'Data', get: (r) => fmt.date(r.data) },
        { label: 'Dinheiro caixas', num: true, get: (r) => fmt.brl(r.dinheiro_caixa) },
        { label: 'Depositado', num: true, get: (r) => fmt.brl(r.deposito_banco) },
        { label: 'Dif.', num: true, get: (r) => (Math.abs(r.dif_dinheiro) > 1 ? badge(fmt.brl(r.dif_dinheiro), 'red') : '✔') },
        { label: 'PIX caixas', num: true, get: (r) => fmt.brl(r.pix_caixa) },
        { label: 'PIX banco', num: true, get: (r) => fmt.brl(r.pix_banco) },
        { label: 'Dif.', num: true, get: (r) => (Math.abs(r.dif_pix) > 1 ? badge(fmt.brl(r.dif_pix), 'red') : '✔') },
      ], [...cb].reverse()))}
    </div>`);
  $('#ofx', view)?.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const r = await post('/api/fin/ofx', { conta_bancaria_id: Number($('#conta', view).value), texto: await f.text() });
      toast(`${r.lidos} lançamentos lidos, ${r.novos} novos, ${r.conciliados} conciliados automaticamente`, 'ok');
      reload();
    } catch (err) { handleErr(err); }
  });
  $('#auto', view)?.addEventListener('click', async () => {
    try { const r = await post('/api/fin/conciliar'); toast(`${r.conciliados} conciliado(s), ${r.pendentes} pendente(s)`, 'ok'); reload(); } catch (err) { handleErr(err); }
  });
  $$('[data-conc]', view).forEach((s) => s.addEventListener('change', async () => {
    if (!s.value) return;
    try { await post(`/api/fin/conciliar/${s.dataset.conc}`, { tipo: s.value }); toast('Conciliado', 'ok'); reload(); } catch (err) { handleErr(err); }
  }));
}

export async function cartoes(view, _p, query) {
  setTitle('Conciliação de cartões');
  const de = query.de || addDays(today(), -30);
  const ate = query.ate || today();
  const d = await get(`/api/fin/cartoes?de=${de}&ate=${ate}`);
  const SIT = { atrasado: ['Não creditado', 'red'], divergente: ['Valor divergente', 'yellow'], a_receber: ['A receber', ''] };
  mount(view, html`
    <div class="page-head"><div><h1>Cartões: venda × crédito esperado × crédito recebido</h1><div class="sub">Divergência de taxa e antecipações por bandeira e adquirente</div></div>
      <form class="row" id="per"><input type="date" name="de" value="${de}"><input type="date" name="ate" value="${ate}"><button class="btn">Aplicar</button><a class="btn" href="#/r/taxas_cartao">Taxas contratadas</a></form></div>
    ${card('Resumo por adquirente / bandeira', table([
      { label: 'Adquirente', get: (r) => r.adquirente }, { label: 'Bandeira', get: (r) => r.bandeira }, { label: 'Modalidade', get: (r) => r.modalidade },
      { label: 'Vendas', num: true, get: (r) => fmt.brl(r.vendas) }, { label: 'Esperado', num: true, get: (r) => fmt.brl(r.esperado) }, { label: 'Recebido', num: true, get: (r) => fmt.brl(r.recebido) },
      { label: 'Divergência', num: true, get: (r) => (Math.abs(r.divergencia) > 0.05 ? badge(fmt.brl(r.divergencia), 'red') : '✔') },
      { label: 'Não creditados', num: true, get: (r) => (r.atrasados ? badge(r.atrasados, 'red') : 0) },
      { label: 'Antecipados', num: true, get: (r) => r.antecipados },
    ], d.resumo))}
    <div class="mt">${card('Pendências e divergências', table([
      { label: 'Venda', get: (r) => fmt.date(r.data_venda) }, { label: 'Adquirente', get: (r) => `${r.adquirente} ${r.bandeira} ${r.modalidade}` },
      { label: 'Bruto', num: true, get: (r) => fmt.brl(r.valor_bruto) }, { label: 'Esperado', num: true, get: (r) => fmt.brl(r.valor_esperado) },
      { label: 'Previsto para', get: (r) => fmt.date(r.data_prevista) }, { label: 'Recebido', num: true, get: (r) => fmt.brl(r.valor_recebido) },
      { label: 'Taxa efetiva', num: true, get: (r) => (r.taxa_efetiva != null ? fmt.pct(r.taxa_efetiva, 2) : '') },
      { label: 'Situação', get: (r) => badge(SIT[r.situacao][0], SIT[r.situacao][1]) },
    ], d.detalhes.filter((x) => x.situacao !== 'a_receber'), { rowAttrs: (r) => `class="click" data-r="${r.id}"`, empty: 'Sem divergências ✔' }))}</div>`);
  $('#per', view).addEventListener('submit', (e) => { e.preventDefault(); navigate(`#/financeiro/cartoes?de=${e.target.de.value}&ate=${e.target.ate.value}`); });
  $$('tr[data-r]', view).forEach((tr) => tr.addEventListener('click', () => navigate(`#/r/recebiveis_cartao/${tr.dataset.r}`)));
}

export async function fluxo(view) {
  setTitle('Fluxo de caixa');
  const d = await get('/api/fin/fluxo?dias=30');
  const juros = await get('/api/fin/juros');
  mount(view, html`
    <div class="page-head"><div><h1>Fluxo de caixa</h1><div class="sub">Realizado (extrato) × previsto (contas a pagar, a receber e recebíveis de cartão) — projeção de 30 dias</div></div></div>
    <div class="kpis">${kpi('Saldo atual', fmt.brl(d.saldo_atual))}${kpi('Menor saldo projetado', fmt.brl(d.menor_saldo), '', { tone: d.menor_saldo < 0 ? 'red' : 'green' })}
      ${kpi('Saldo em 30 dias', fmt.brl(d.previsto.at(-1)?.saldo))}${kpi('Juros e multas pagos no mês', fmt.brl(juros.reduce((a, j) => a + j.juros_multa, 0)), `${juros.length} pagamento(s) em atraso`, { tone: juros.length ? 'yellow' : '' })}</div>
    ${card('Saldo projetado', lineChart([{ name: 'Saldo previsto', color: 'var(--c1)', points: d.previsto.map((p) => ({ x: p.data, y: p.saldo })) }], { yFormat: (n) => fmt.num(n / 1000, 0) + 'k' }))}
    <div class="grid g2 mt">
      ${card('Previsto (próximos 30 dias)', table([
        { label: 'Data', get: (p) => fmt.date(p.data) }, { label: 'Entradas', num: true, get: (p) => fmt.brl(p.entradas) },
        { label: 'Saídas', num: true, get: (p) => fmt.brl(p.saidas) }, { label: 'Saldo', num: true, get: (p) => html`<b class="${p.saldo < 0 ? 'down' : ''}">${fmt.brl(p.saldo)}</b>` },
      ], d.previsto.filter((p) => p.entradas || p.saidas)))}
      ${card('Realizado (últimos 30 dias)', barChart(d.realizado.map((r) => ({ label: r.data.slice(8), value: r.entradas - r.saidas, color: r.entradas - r.saidas < 0 ? 'var(--c5)' : 'var(--c3)' })).map((x) => ({ ...x, value: Math.abs(x.value) })), { yFormat: (n) => fmt.num(n / 1000, 0) + 'k' }))}
    </div>`);
}

export async function dre(view, _p, query) {
  setTitle('DRE gerencial');
  const comp = query.competencia || competencia();
  const d = await get(`/api/fin/dre?competencia=${comp}`);
  const cols = [d.atual, d.mes_anterior, d.ano_anterior];
  const nomes = [...new Set(cols.flatMap((c) => c.despesas.map((x) => x.nome)))];
  const desp = (c, n) => c.despesas.find((x) => x.nome === n)?.valor || 0;
  const linha = (label, f, strong = false) => ({ label, vals: cols.map(f), strong });
  const linhas = [
    linha('Receita bruta — pista', (c) => c.receita_pista), linha('Receita bruta — conveniência', (c) => c.receita_conveniencia),
    linha('Receita bruta total', (c) => c.receita, true),
    linha('(−) CMV combustíveis', (c) => -c.cmv_pista), linha('(−) CMV conveniência', (c) => -c.cmv_conveniencia),
    linha('Lucro bruto', (c) => c.lucro_bruto, true), linha('Margem bruta %', (c) => c.margem_bruta_pct),
    ...nomes.map((n) => linha(`(−) ${n}`, (c) => -desp(c, n))),
    linha('Total de despesas', (c) => -c.total_despesas, true),
    linha('Resultado gerencial', (c) => c.resultado, true), linha('Margem líquida %', (c) => c.margem_liquida_pct),
  ];
  mount(view, html`
    <div class="page-head"><div><h1>DRE gerencial — ${compLabel(comp)}</h1><div class="sub">Comparativo com o mês anterior e o mesmo mês do ano anterior (despesas pelo regime de caixa)</div></div>
      <div class="row">${compSelect(comp)}<button class="btn" onclick="window.print()">🖨 Imprimir</button></div></div>
    ${card('', html`<div class="scroll"><table class="tbl"><thead><tr><th></th><th class="num">${compLabel(comp)}</th><th class="num">${compLabel(prevComp(comp))}</th><th class="num">Var.</th><th class="num">${compLabel(prevComp(comp, 12))}</th></tr></thead>
      <tbody>${linhas.map((l) => {
        const pct = l.label.includes('%');
        const f = (v) => (pct ? fmt.pct(v) : fmt.brl(v));
        const varp = !pct && l.vals[1] ? (100 * (l.vals[0] - l.vals[1])) / Math.abs(l.vals[1]) : null;
        return html`<tr style="${l.strong ? 'font-weight:700' : ''}"><td>${l.label}</td><td class="num">${f(l.vals[0])}</td><td class="num">${f(l.vals[1])}</td><td class="num">${varp != null ? html`<small class="${varp >= 0 ? 'up' : 'down'}">${fmt.pct(varp)}</small>` : ''}</td><td class="num">${l.vals[2] ? f(l.vals[2]) : '—'}</td></tr>`;
      })}</tbody></table></div>`)}
    <p class="muted"><small>Mês corrente parcial até hoje. CMV pelo custo da última compra; taxas de cartão pelo contratado.</small></p>`);
  $('[data-comp]', view).addEventListener('change', (e) => navigate(`#/financeiro/dre?competencia=${e.target.value}`));
}

export async function importar(view) {
  setTitle('Importar vendas do Linx/Webposto');
  mount(view, html`
    <div class="page-head"><div><h1>Importar vendas (Linx / Webposto)</h1><div class="sub">Enquanto a integração direta não é liberada pela Linx, importe a exportação de vendas em CSV</div></div></div>
    <div class="grid g2">
      ${card('Arquivo CSV', html`<p>Colunas aceitas (cabeçalho na 1ª linha, separador ; ou ,):</p>
        <pre style="white-space:pre-wrap;background:var(--surface-2);padding:10px;border-radius:8px">data;hora;origem;cupom;bico;combustivel;produto_codigo;frentista_cpf;quantidade;valor;custo;forma_pagamento</pre>
        <ul class="muted"><li><b>origem</b>: pista ou conveniencia</li><li><b>bico</b> e <b>combustivel</b> pelo nome cadastrado (ex.: B01, Gasolina comum)</li><li><b>forma_pagamento</b>: dinheiro, debito, credito, pix, prazo, frota</li><li>Vendas são vinculadas ao turno pelo horário</li></ul>
        ${canWrite('vendas') ? html`<label class="btn btn-primary">⬆ Selecionar arquivo<input type="file" id="csv" accept=".csv,.txt" hidden></label>` : html`<p class="muted">Sem permissão para importar.</p>`}
        <div id="res" class="mt"></div>`)}
      ${card('Outras integrações', html`<ul>
        <li><b>Extrato bancário (OFX)</b>: <a href="#/financeiro/conciliacao">Conciliação bancária</a></li>
        <li><b>Relógio de ponto (AFD)</b>: <a href="#/rh/ponto">Ponto e banco de horas</a></li>
        <li><b>NF-e de entrada (XML)</b>: <a href="#/conveniencia/notas">Entrada de notas</a></li>
        <li><b>Recebíveis de cartão</b>: cadastro em <a href="#/r/recebiveis_cartao">Recebíveis</a> com taxa contratada calculada automaticamente</li>
        <li><b>Contabilidade</b>: <a href="#/contabil">Pacote mensal</a> (planilhas, LMC e anexos em ZIP)</li></ul>`)}
    </div>`);
  $('#csv', view)?.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const r = await post('/api/fin/vendas/import', { texto: await f.text() });
      mount($('#res', view), html`${badge(`${r.importadas} venda(s) importada(s)`, 'green')} ${r.erros.length ? html`<ul class="down">${r.erros.slice(0, 20).map((x) => html`<li>${x}</li>`)}</ul>` : ''}`);
    } catch (err) { handleErr(err); }
  });
}

export { downloadUrl };
