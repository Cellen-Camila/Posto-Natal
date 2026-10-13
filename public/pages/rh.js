// Módulo RH / DP.
import {
  html, raw, mount, $, $$, get, post, put, toast, handleErr, fmt, badge, card, table, kpi, progress, compSelect, competencia, prevComp,
  compLabel, canWrite, today, addDays, weekdays, downloadUrl, isRole, fileUrl,
} from '../lib.js';
import { setTitle, navigate, reload } from '../app.js';

const OC = { normal: '', folga: 'Folga', falta_injustificada: 'Falta', falta_justificada: 'Falta justif.', atestado: 'Atestado', ferias: 'Férias' };

export async function ponto(view, _p, query) {
  setTitle('Ponto e banco de horas');
  const comp = query.competencia || competencia();
  const d = await get(`/api/rh/equipe?competencia=${comp}`);
  const tot = (k) => d.linhas.reduce((a, l) => a + (l[k] || 0), 0);
  mount(view, html`
    <div class="page-head"><div><h1>Ponto, frequência e assiduidade</h1><div class="sub">Assiduidade da equipe: ${fmt.pct(d.assiduidade_equipe)} · limite de HE no mês ${fmt.hm(d.limite_he_mes_min)}</div></div>
      <div class="row">${compSelect(comp)}
        ${canWrite('ponto') ? html`<label class="btn">⬆ Importar AFD do relógio<input type="file" id="afd" accept=".txt,.afd" hidden></label>` : ''}
        <a class="btn" href="#/r/ponto">Marcações</a></div></div>
    <div class="kpis">
      ${kpi('Horas extras 50%', fmt.hm(tot('extra50')))}
      ${kpi('Horas extras 100%', fmt.hm(tot('extra100')))}
      ${kpi('Adicional noturno', fmt.hm(tot('noturno')))}
      ${kpi('Faltas injustificadas', tot('faltas'), `${tot('faltas_justificadas')} justificada(s) · ${tot('atestados')} dia(s) de atestado`, { tone: tot('faltas') ? 'red' : '' })}
      ${kpi('Atrasos', tot('atrasos'), `${tot('saidas_antecipadas')} saída(s) antecipada(s)`)}
    </div>
    ${card('Espelho resumido por funcionário (clique para o espelho completo)', table([
      { label: 'Funcionário', get: (l) => html`<b>${l.nome}</b><br><small class="muted">${l.funcao || ''}</small>` },
      { label: 'Trabalhado', num: true, get: (l) => fmt.hm(l.trabalhado) },
      { label: 'HE 50%', num: true, get: (l) => fmt.hm(l.extra50) },
      { label: 'HE 100%', num: true, get: (l) => fmt.hm(l.extra100) },
      { label: 'Noturno', num: true, get: (l) => fmt.hm(l.noturno) },
      { label: 'Atrasos', num: true, get: (l) => l.atrasos },
      { label: 'Faltas', num: true, get: (l) => (l.faltas ? badge(l.faltas, 'red') : 0) },
      { label: 'Faltas 12m', num: true, get: (l) => l.faltas_12m },
      { label: 'Banco de horas', num: true, get: (l) => html`<span class="${l.banco_horas < 0 ? 'down' : 'up'}">${fmt.hm(l.banco_horas)}</span>` },
      { label: 'Assiduidade', num: true, get: (l) => html`${fmt.pct(l.assiduidade)}` },
      { label: '', get: (l) => (l.excesso_he ? badge('HE acima do limite', 'yellow') : '') },
    ], [...d.linhas].sort((a, b) => a.assiduidade - b.assiduidade || b.faltas_12m - a.faltas_12m), { rowAttrs: (l) => `class="click" data-f="${l.funcionario_id}"` }))}`);
  $('[data-comp]', view).addEventListener('change', (e) => navigate(`#/rh/ponto?competencia=${e.target.value}`));
  $$('tr[data-f]', view).forEach((tr) => tr.addEventListener('click', () => navigate(`#/rh/ponto/${tr.dataset.f}?competencia=${comp}`)));
  $('#afd', view)?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const r = await post('/api/rh/afd', { texto: await file.text() });
      toast(`${r.marcacoes} marcações lidas, ${r.dias_atualizados} dia(s) atualizados${r.nao_identificados.length ? ` · ${r.nao_identificados.length} PIS/CPF sem cadastro` : ''}`, 'ok');
      reload();
    } catch (err) { handleErr(err); }
  });
}

export async function espelho(view, [fid], query) {
  const comp = query.competencia || competencia();
  const d = await get(`/api/rh/espelho/${fid}?competencia=${comp}`);
  setTitle(`Espelho de ponto — ${d.funcionario.nome}`);
  const t = d.totais;
  mount(view, html`
    <div class="page-head"><div><h1>Espelho de ponto — ${d.funcionario.nome}</h1><div class="sub">${d.funcionario.funcao} · escala ${d.funcionario.escala_tipo || '—'} · jornada ${fmt.hm(d.funcionario.jornada_min || 440)} · ${compLabel(comp)}</div></div>
      <div class="row">${compSelect(comp)}<button class="btn" onclick="window.print()">🖨 Imprimir</button><a class="btn" href="#/rh/funcionario/${fid}">Linha do tempo</a></div></div>
    ${card('', table([
      { label: 'Data', get: (p) => html`<span class="nowrap">${weekdays[new Date(p.data + 'T12:00').getDay()]} ${fmt.date(p.data)}</span>` },
      { label: 'Entrada', get: (p) => p.entrada || '' }, { label: 'Int.', get: (p) => p.saida_intervalo || '' }, { label: 'Retorno', get: (p) => p.retorno_intervalo || '' }, { label: 'Saída', get: (p) => p.saida || '' },
      { label: 'Ocorrência', get: (p) => (p.ocorrencia && p.ocorrencia !== 'normal' ? badge(OC[p.ocorrencia], p.ocorrencia === 'falta_injustificada' ? 'red' : p.ocorrencia === 'folga' ? '' : 'yellow') : p.calc.incompleto ? badge('Incompleto', 'yellow') : '') },
      { label: 'Trab.', num: true, get: (p) => (p.calc.trabalhado ? fmt.hm(p.calc.trabalhado) : '') },
      { label: 'Atraso', num: true, get: (p) => (p.calc.atraso ? fmt.hm(p.calc.atraso) : '') },
      { label: 'HE 50%', num: true, get: (p) => (p.calc.extra50 ? fmt.hm(p.calc.extra50) : '') },
      { label: 'HE 100%', num: true, get: (p) => (p.calc.extra100 ? fmt.hm(p.calc.extra100) : '') },
      { label: 'Noturno', num: true, get: (p) => (p.calc.noturno ? fmt.hm(p.calc.noturno) : '') },
      { label: 'Saldo', num: true, get: (p) => (p.calc.saldo ? html`<span class="${p.calc.saldo < 0 ? 'down' : 'up'}">${fmt.hm(p.calc.saldo)}</span>` : '') },
      { label: 'HE aprov.', get: (p) => (p.calc.extra50 || p.calc.extra100 ? (p.he_aprovada ? '✔' : html`<span class="muted">não</span>`) : '') },
    ], d.dias, {
      rowAttrs: (p) => `class="click ${p.ocorrencia === 'falta_injustificada' ? 'crit' : ''}" data-p="${p.id}"`,
      foot: ['Totais', '', '', '', '', `${t.faltas} falta(s)`, fmt.hm(t.trabalhado), fmt.hm(t.atraso), fmt.hm(t.extra50), fmt.hm(t.extra100), fmt.hm(t.noturno), fmt.hm(t.saldo), ''],
    }))}
    <p class="muted"><small>Tolerância de 10 min/dia (CLT art. 58 §1º). Hora noturna reduzida (52min30s) entre 22h e 5h. Abono de falta exige aprovação do gerente.</small></p>`);
  $('[data-comp]', view).addEventListener('change', (e) => navigate(`#/rh/ponto/${fid}?competencia=${e.target.value}`));
  $$('tr[data-p]', view).forEach((tr) => tr.addEventListener('click', async () => {
    const { openRecord } = await import('./crud.js');
    openRecord('ponto', Number(tr.dataset.p), {}, { onSaved: reload });
  }));
}

export async function escalas(view, _p, query) {
  setTitle('Escalas');
  const de = query.de || today();
  const ate = addDays(de, 13);
  const d = await get(`/api/rh/escalas?de=${de}&ate=${ate}`);
  const dias = [];
  for (let x = de; x <= ate; x = addDays(x, 1)) dias.push(x);
  const funcs = new Map();
  for (const r of d.rows) { if (!funcs.has(r.funcionario_id)) funcs.set(r.funcionario_id, { nome: r.nome, dias: {} }); funcs.get(r.funcionario_id).dias[r.data] = r; }
  const w = canWrite('escalas');
  const opts = [['', '—'], ['manha', 'M'], ['tarde', 'T'], ['noite', 'N'], ['folga', 'F']];
  const cobertura = (dia, t) => d.rows.filter((r) => r.data === dia && r.turno === t).length;
  mount(view, html`
    <div class="page-head"><div><h1>Escala de turnos e folgas</h1><div class="sub">M = manhã · T = tarde · N = noite · F = folga · ⛽ = escala do GNV</div></div>
      <div class="row"><a class="btn" href="#/rh/escalas?de=${addDays(de, -7)}">◀ Semana anterior</a><a class="btn" href="#/rh/escalas">Hoje</a><a class="btn" href="#/rh/escalas?de=${addDays(de, 7)}">Próxima ▶</a>
        <a class="btn" href="#/r/trocas_folga">Trocas de folga</a></div></div>
    ${d.conflitos.length ? card(`Avisos de conflito (${d.conflitos.length})`, html`<div class="alert-list">${d.conflitos.map((c) => html`<div class="alert-item amarelo"><div><div class="t">${c.nome} — ${fmt.date(c.data)}</div><div class="d">${c.aviso}</div></div></div>`)}</div>`) : ''}
    <div class="card mt"><div class="scroll"><table class="tbl escala-grid">
      <thead><tr><th>Funcionário</th>${dias.map((x) => html`<th class="${new Date(x + 'T12:00').getDay() === 0 ? 'esc-sun' : ''}">${weekdays[new Date(x + 'T12:00').getDay()]}<br>${fmt.short(x)}</th>`)}</tr></thead>
      <tbody>${[...funcs.entries()].map(([fid, f]) => html`<tr><td class="nowrap">${f.nome}</td>${dias.map((x) => {
        const e = f.dias[x];
        const v = e?.turno || '';
        return html`<td class="${v === 'folga' ? 'esc-folga' : ''}">${w ? html`<select data-f="${fid}" data-d="${x}">${opts.map(([k, l]) => html`<option value="${k}" ${raw(k === v ? 'selected' : '')}>${l}</option>`)}</select>` : (opts.find((o) => o[0] === v) || ['', ''])[1]}${e?.gnv ? '⛽' : ''}</td>`;
      })}</tr>`)}</tbody>
      <tfoot><tr><td>Cobertura M/T/N</td>${dias.map((x) => html`<td><small>${cobertura(x, 'manha')}/${cobertura(x, 'tarde')}/${cobertura(x, 'noite')}</small></td>`)}</tr></tfoot>
    </table></div></div>`);
  $$('select[data-f]', view).forEach((s) => s.addEventListener('change', async () => {
    try { await post('/api/rh/escalas', { funcionario_id: Number(s.dataset.f), data: s.dataset.d, turno: s.value || null }); toast('Escala atualizada', 'ok'); } catch (e) { handleErr(e); }
  }));
}

export async function ferias(view, _p, query) {
  setTitle('Férias e 13º salário');
  const ano = query.ano || today().slice(0, 4);
  const [f, dec] = await Promise.all([get(`/api/rh/ferias?ano=${ano}`), get(`/api/rh/decimo?ano=${ano}`)]);
  const SIT = { vencida_dobro: ['Vencida — pagamento em dobro', 'red'], vence_30: ['Vence em até 30 dias', 'red'], vence_60: ['Vence em até 60 dias', 'yellow'], a_programar: ['A programar', ''], programada: ['Programada', 'blue'], em_aquisicao: ['Em aquisição', ''] };
  const ord = ['vencida_dobro', 'vence_30', 'vence_60', 'a_programar', 'programada', 'em_aquisicao'];
  const colunas = [
    { label: 'Funcionário', get: (x) => html`${x.codigo ? html`<small class="muted">${x.codigo} · </small>` : ''}${x.nome}` },
    { label: 'Período aquisitivo', get: (x) => html`<span class="nowrap">${fmt.date(x.aquisitivo_inicio)} a ${fmt.date(x.aquisitivo_fim)}</span>` },
    { label: 'Dias de direito', num: true, get: (x) => (x.situacao === 'em_aquisicao' ? html`${fmt.num(x.dias_direito, 1)} <small class="muted">(${x.avos}/12)</small>` : html`${x.dias_restantes}${x.dias_usados ? html` <small class="muted">de ${x.dias_restantes + x.dias_usados}</small>` : ''}`) },
    { label: 'Começar o gozo até', get: (x) => html`<span class="nowrap">${fmt.date(x.limite_gozo)}</span>` },
    { label: 'Situação', get: (x) => html`${badge(SIT[x.situacao][0], SIT[x.situacao][1])}${x.programada_inicio ? html` <small>início ${fmt.date(x.programada_inicio)}</small>` : ''}` },
  ];
  const ordena = (arr) => [...arr].sort((a, b) => ord.indexOf(a.situacao) - ord.indexOf(b.situacao) || a.dias_para_limite - b.dias_para_limite || a.nome.localeCompare(b.nome));
  const temImport = f.situacao.some((x) => x.importado);
  const principais = temImport ? f.situacao.filter((x) => x.importado) : f.situacao;
  const novos = temImport ? f.situacao.filter((x) => !x.importado) : [];
  const dataBase = principais.find((x) => x.data_base)?.data_base;
  mount(view, html`
    <div class="page-head"><div><h1>Férias e 13º salário</h1><div class="sub">Alertas com 60 e 30 dias antes do prazo para começar o gozo (risco de pagamento em dobro)</div></div>
      <div class="row">${canWrite('funcionarios') ? html`<label class="btn">⬆ Importar programação da contabilidade (CSV)<input type="file" id="imp-ferias" accept=".csv,.txt" hidden></label>` : ''}
        <a class="btn btn-primary" href="#/r/ferias">Lançar / programar férias</a></div></div>
    <div id="imp-res"></div>
    ${card(temImport ? `Períodos em aberto — programação da contabilidade de ${fmt.date(dataBase)} (${principais.length})` : `Períodos em aberto (${principais.length})`, table(colunas, ordena(principais)))}
    ${novos.length ? html`<details class="card mt"><summary style="cursor:pointer;font-weight:600">Períodos iniciados depois de ${fmt.date(dataBase)} (${novos.length}) — ainda em aquisição, entram na próxima programação</summary><div class="mt">${table(colunas, ordena(novos))}</div></details>` : ''}
    <div class="mt">${card(`Planejamento ${ano}: conflitos (mesma função de férias ao mesmo tempo)`, f.conflitos.length ? html`<div class="alert-list">${f.conflitos.map((c) => html`<div class="alert-item amarelo"><div><div class="t">${c.funcao}: ${c.funcionarios.join(' e ')}</div><div class="d">${fmt.date(c.de)} a ${fmt.date(c.ate)} — turno pode ficar descoberto</div></div></div>`)}</div>` : html`<div class="empty">Nenhum conflito nas férias programadas ✔</div>`)}</div>
    <div class="mt">${card(`13º salário ${ano} — 1ª parcela até ${fmt.date(dec.prazo_1)} · 2ª parcela até ${fmt.date(dec.prazo_2)}`, table([
      { label: 'Funcionário', get: (l) => l.nome },
      { label: 'Remuneração (c/ periculosidade)', num: true, get: (l) => fmt.brl(l.remuneracao) },
      { label: 'Avos', num: true, get: (l) => `${l.avos}/12` },
      { label: 'Provisão mensal', num: true, get: (l) => fmt.brl(l.provisao_mensal) },
      { label: '1ª parcela', num: true, get: (l) => fmt.brl(l.parcela1) },
      { label: '2ª parcela (bruta)', num: true, get: (l) => fmt.brl(l.parcela2) },
      { label: 'Total', num: true, get: (l) => fmt.brl(l.total) },
    ], dec.linhas, { foot: ['Total', '', '', fmt.brl(dec.provisao_mensal), fmt.brl(dec.linhas.reduce((a, l) => a + l.parcela1, 0)), fmt.brl(dec.linhas.reduce((a, l) => a + l.parcela2, 0)), fmt.brl(dec.total)] }))}
    <p class="muted"><small>Valores estimados sem médias de variáveis (HE, comissões) e sem descontos de INSS/IRRF — conferir com a contabilidade.</small></p></div>`);
  bindImportFerias(view);
}

function bindImportFerias(view) {
  $('#imp-ferias', view)?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const r = await post('/api/rh/ferias/importar', { texto: await file.text() });
      toast(`Programação importada: ${r.periodos} período(s) de ${r.criados.length + r.atualizados.length} funcionário(s)`, 'ok');
      sessionStorage.setItem('imp-ferias', JSON.stringify(r));
      reload();
    } catch (err) { handleErr(err); }
  });
  let r = null;
  try { r = JSON.parse(sessionStorage.getItem('imp-ferias') || 'null'); sessionStorage.removeItem('imp-ferias'); } catch { /* sem storage */ }
  if (r) {
    mount($('#imp-res', view), card('Resultado da importação', html`<p>${r.periodos} período(s) em aberto gravados. ${r.criados.length} funcionário(s) cadastrados agora, ${r.atualizados.length} atualizados.</p>
      ${r.criados.length ? html`<p class="muted">Cadastrados agora (complete CPF, função e salário em RH → Funcionários): ${r.criados.join(', ')}</p>` : ''}
      ${r.fora_da_lista.length ? html`<p class="down">Ativos no sistema mas fora da programação (confira se foram desligados): ${r.fora_da_lista.join(', ')}</p>` : ''}`));
  }
}

export async function epi(view) {
  setTitle('Uniformes e EPI');
  const [fichas, itens] = await Promise.all([get('/api/rh/epi'), get('/api/r/epi_itens?limit=200')]);
  const emDia = fichas.filter((f) => f.em_dia).length;
  mount(view, html`
    <div class="page-head"><div><h1>Uniformes e EPI</h1><div class="sub">Fichas de entrega (NR-6) com CA válido e assinatura digital do funcionário</div></div>
      <div class="row"><a class="btn btn-primary" href="#/r/epi_entregas">Registrar entrega</a><a class="btn" href="#/r/epi_itens">Estoque de itens</a></div></div>
    <div class="kpis">
      ${kpi('Fichas em dia', `${emDia}/${fichas.length}`, 'meta: 100%', { tone: emDia === fichas.length ? 'green' : 'yellow' })}
      ${kpi('Itens abaixo do ponto de reposição', itens.rows.filter((i) => i.ponto_reposicao != null && i.estoque <= i.ponto_reposicao).length, '', { href: '#/r/epi_itens' })}
      ${kpi('CA vencido', itens.rows.filter((i) => i.tipo === 'epi' && i.ca_validade && i.ca_validade < today()).length, 'não entregar', { tone: itens.rows.some((i) => i.tipo === 'epi' && i.ca_validade && i.ca_validade < today()) ? 'red' : 'green' })}
    </div>
    <div class="grid g2">
      ${card('Fichas por funcionário', table([
        { label: 'Funcionário', get: (f) => html`<a href="#/r/epi_entregas?f_funcionario_id=${f.funcionario_id}">${f.nome}</a><br><small class="muted">${f.funcao || ''}</small>` },
        { label: 'Entregas', num: true, get: (f) => f.entregas },
        { label: 'Situação', get: (f) => (f.em_dia ? badge('Em dia', 'green') : html`${f.pendencias.map((p) => html`<div><small>• ${p}</small></div>`)}`) },
      ], fichas))}
      ${card('Estoque e reposição', table([
        { label: 'Item', get: (i) => `${i.nome}${i.tamanho ? ' ' + i.tamanho : ''}` },
        { label: 'CA', get: (i) => (i.ca ? html`${i.ca}${i.ca_validade ? html`<br><small class="${i.ca_validade < today() ? 'down' : 'muted'}">val. ${fmt.date(i.ca_validade)}</small>` : ''}` : '—') },
        { label: 'Estoque', num: true, get: (i) => (i.ponto_reposicao != null && i.estoque <= i.ponto_reposicao ? badge(i.estoque, 'red') : i.estoque) },
        { label: 'Repor em', num: true, get: (i) => i.ponto_reposicao ?? '' },
        { label: 'Troca (dias)', num: true, get: (i) => i.troca_dias ?? '' },
      ], itens.rows))}
    </div>`);
}

export async function comissoes(view, _p, query) {
  setTitle('Comissão do grid');
  const comp = query.competencia || competencia();
  const d = await get(`/api/rh/comissoes?competencia=${comp}`);
  mount(view, html`
    <div class="page-head"><div><h1>Comissão do grid</h1><div class="sub">Lubrificantes, aditivos, filtros, palhetas — apurado por frentista a partir das vendas</div></div>
      <div class="row">${compSelect(comp)}<a class="btn" href="#/r/produtos?f_local=grid">Produtos e % de comissão</a><a class="btn" href="${downloadUrl(`/api/r/vendas_grid?format=csv&from=${comp}-01&to=${comp}-31`)}">⬇ Vendas (CSV)</a></div></div>
    <div class="kpis">${kpi('Vendas do grid', fmt.brl(d.total_vendas))}${kpi('Comissões a pagar', fmt.brl(d.total_comissao), 'enviar ao DP para a folha')}</div>
    ${card('Ranking e metas', table([
      { label: '#', get: (_r, i) => i + 1 },
      { label: 'Frentista', get: (r) => r.nome },
      { label: 'Vendas', num: true, get: (r) => fmt.brl(r.vendas) },
      { label: 'Meta', num: true, get: (r) => (r.meta ? fmt.brl(r.meta) : '—') },
      { label: 'Atingimento', get: (r) => (r.atingimento != null ? html`<div style="min-width:140px">${progress(r.atingimento, r.atingimento >= 100 ? 'green' : r.atingimento >= 70 ? '' : 'yellow')}<small>${fmt.pct(r.atingimento)}</small></div>` : '') },
      { label: 'Comissão', num: true, get: (r) => html`<b>${fmt.brl(r.comissao)}</b>` },
      { label: 'Itens', get: (r) => html`<small class="muted">${r.itens.map((i) => `${i.produto} (${fmt.num(i.qtd)})`).join(', ')}</small>` },
    ], d.ranking, { empty: 'Sem vendas do grid na competência' }))}`);
  $('[data-comp]', view).addEventListener('change', (e) => navigate(`#/rh/comissoes?competencia=${e.target.value}`));
}

export async function fechamento(view, _p, query) {
  setTitle('Fechamento do DP');
  const comp = query.competencia || prevComp(competencia());
  const { fechamento: f, resumo } = await get(`/api/rh/fechamento?competencia=${comp}`);
  const itens = f.itens || [];
  const ok = itens.filter((i) => i.ok).length;
  const w = canWrite('fechamentos');
  mount(view, html`
    <div class="page-head"><div><h1>Fechamento mensal do DP — ${compLabel(comp)}</h1><div class="sub">Checklist com prazo; ao concluir, libere o pacote para a contabilidade</div></div>
      <div class="row">${compSelect(comp)}<a class="btn" href="${downloadUrl(`/api/contabil/pacote?competencia=${comp}`)}">⬇ Gerar pacote (ZIP)</a></div></div>
    <div class="grid g2">
      ${card(`Checklist — ${ok}/${itens.length}`, html`${progress(itens.length ? 100 * ok / itens.length : 0, ok === itens.length ? 'green' : '')}
        <div class="check-list mt">${itens.map((i, idx) => html`<label class="${i.ok ? 'done' : ''}"><input type="checkbox" data-i="${idx}" ${raw(i.ok ? 'checked' : '')} ${raw(w ? '' : 'disabled')}> ${i.titulo}</label>`)}</div>
        ${f.enviado_at ? html`<p class="mt">${badge('Liberado à contabilidade', 'green')} em ${fmt.dt(f.enviado_at)}</p>` : w ? html`<button class="btn btn-primary mt" id="liberar" ${raw(ok === itens.length ? '' : 'disabled')}>Concluir fechamento do DP</button>` : ''}`)}
      ${card('Pontos de atenção', html`<div class="alert-list">
        <a class="alert-item ${resumo.he_nao_aprovadas ? 'amarelo' : 'verde'}" href="#/rh/ponto?competencia=${comp}"><div><div class="t">${resumo.he_nao_aprovadas} dia(s) de ponto sem aprovação de HE</div><div class="d">Aprovar horas extras antes de enviar</div></div></a>
        <a class="alert-item ${resumo.faltas_pendentes ? 'vermelho' : 'verde'}" href="#/r/faltas_caixa?f_tratamento=pendente"><div><div class="t">${resumo.faltas_pendentes} falta(s) de caixa sem tratamento</div><div class="d">Definir desconto, abono ou investigação</div></div></a>
        <a class="alert-item ${resumo.descontos_sem_termo ? 'vermelho' : 'verde'}" href="#/r/faltas_caixa?f_tratamento=desconto"><div><div class="t">${resumo.descontos_sem_termo} desconto(s) sem termo de autorização</div><div class="d">Só entram na folha com o termo anexado</div></div></a>
        <div class="alert-item verde"><div><div class="t">Admissões: ${resumo.admissoes.map((a) => a.nome).join(', ') || 'nenhuma'}</div><div class="d">Demissões: ${resumo.demissoes.map((a) => a.nome).join(', ') || 'nenhuma'}</div></div></div>
      </div>`)}
    </div>`);
  $('[data-comp]', view).addEventListener('change', (e) => navigate(`#/rh/fechamento?competencia=${e.target.value}`));
  $$('[data-i]', view).forEach((cb) => cb.addEventListener('change', async () => {
    itens[cb.dataset.i].ok = cb.checked;
    try { await put(`/api/fechamentos/${f.id}/itens`, { itens }); reload(); } catch (e) { handleErr(e); }
  }));
  $('#liberar', view)?.addEventListener('click', async () => {
    try { await post(`/api/fechamentos/${f.id}/liberar`); toast('Fechamento do DP concluído', 'ok'); reload(); } catch (e) { handleErr(e); }
  });
}

export async function funcionario(view, [id]) {
  const [f, tl] = await Promise.all([get(`/api/r/funcionarios/${id}`), get(`/api/rh/timeline/${id}`)]);
  setTitle(f.nome);
  mount(view, html`
    <div class="page-head"><div><h1>${f.nome}</h1><div class="sub">${f.funcao} · admissão ${fmt.date(f.admissao)} · escala ${f.escala_tipo || '—'}${f.gnv_habilitado ? ' · operador GNV' : ''}</div></div>
      <div class="row"><a class="btn" href="#/r/funcionarios/${id}">Editar cadastro</a><a class="btn" href="#/rh/ponto/${id}">Espelho de ponto</a>
        <a class="btn" href="#/r/epi_entregas?f_funcionario_id=${id}">Ficha de EPI</a>${isRole('gerente', 'rh') ? html`<a class="btn" href="#/r/atestados?f_funcionario_id=${id}">Atestados</a>` : ''}</div></div>
    <div class="grid g2">
      ${card('Linha do tempo', tl.length ? html`<ul class="timeline">${tl.map((e) => html`<li><small class="muted">${fmt.date(e.data)}</small><br><b>${e.tipo}</b> ${e.texto ? html`— ${e.texto}` : ''}</li>`)}</ul>` : html`<div class="empty">Sem eventos</div>`)}
      ${card('Dados', html`<div class="form-grid" style="grid-template-columns:1fr 1fr">
        ${[['CPF', f.cpf], ['PIS', f.pis], ['Salário', fmt.brl(f.salario)], ['Periculosidade', f.periculosidade ? 'Sim (30%)' : 'Não'], ['Dependentes', f.dependentes ?? 0], ['Horário', f.horario_entrada || '—'],
          ['Telefone', f.telefone || '—'], ['Conta', f.banco_conta || '—'], ['Uniforme', f.tamanho_uniforme || '—'], ['Calçado', f.calcado || '—'], ['LGPD', f.consentimento_lgpd ? 'Consentimento assinado' : 'Pendente']]
          .map(([k, v]) => html`<div class="field"><span>${k}</span><b>${v}</b></div>`)}
      </div>${(f.docs || []).length ? html`<p class="mt">Documentos: ${f.docs.map((a) => html`<a class="chip" href="${fileUrl(a.id)}" target="_blank" rel="noopener">📎 ${a.nome}</a> `)}</p>` : ''}`)}
    </div>`);
}
