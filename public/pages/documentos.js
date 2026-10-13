// Módulo Documentos, Licenças e Alvarás.
import { html, mount, $$, get, fmt, badge, card, table, kpi, fileUrl, canWrite } from '../lib.js';
import { setTitle, reload } from '../app.js';
import { openRecord } from './crud.js';

const ST = { vencido: ['Vencido', 'red'], a_vencer: ['A vencer', 'yellow'], em_dia: ['Em dia', 'green'], em_renovacao: ['Em renovação', 'blue'], sem_validade: ['Sem validade', ''] };

export async function lista(view, _p, query) {
  setTitle('Documentos, licenças e alvarás');
  const { rows } = await get('/api/r/documentos?limit=1000');
  const filtro = query.status || '';
  const cont = (s) => rows.filter((r) => r._status === s).length;
  const prox90 = rows.filter((r) => r._dias != null && r._dias >= 0 && r._dias <= 90).length;
  const lista = rows.filter((r) => !filtro || r._status === filtro || (filtro === '90' && r._dias != null && r._dias >= 0 && r._dias <= 90));
  mount(view, html`
    <div class="page-head"><div><h1>O que vence nos próximos 90 dias?</h1><div class="sub">Avisos automáticos com 90, 60, 30, 15 e 7 dias por WhatsApp/e-mail ao responsável e ao gerente</div></div>
      <div class="row">${canWrite('documentos') ? html`<button class="btn btn-primary" id="novo">+ Novo documento</button>` : ''}<a class="btn" href="#/documentos/fiscalizacao">📁 Pasta de fiscalização</a></div></div>
    <div class="kpis">
      ${kpi('Vencidos', cont('vencido'), 'meta: zero', { tone: cont('vencido') ? 'red' : 'green', href: '#/documentos?status=vencido' })}
      ${kpi('A vencer', cont('a_vencer'), 'até 30 dias', { tone: cont('a_vencer') ? 'yellow' : '', href: '#/documentos?status=a_vencer' })}
      ${kpi('Em renovação', cont('em_renovacao'), 'com protocolo', { href: '#/documentos?status=em_renovacao' })}
      ${kpi('Próximos 90 dias', prox90, '', { href: '#/documentos?status=90' })}
      ${kpi('Em dia', cont('em_dia'), `de ${rows.length} documentos`, { tone: 'green', href: '#/documentos?status=em_dia' })}
    </div>
    ${card(filtro ? html`Filtro: ${filtro === '90' ? 'próximos 90 dias' : ST[filtro]?.[0]} · <a href="#/documentos">limpar</a>` : 'Todos os documentos', table([
      { label: 'Documento', get: (d) => html`<b>${d.nome}</b><br><small class="muted">${d.categoria || ''} · ${d.orgao || ''}</small>` },
      { label: 'Nº', get: (d) => d.numero || '' },
      { label: 'Validade', get: (d) => fmt.date(d.validade) },
      { label: 'Situação', get: (d) => html`${badge(ST[d._status][0], ST[d._status][1])}${d._dias != null ? html`<br><small class="muted">${d._dias < 0 ? `vencido há ${-d._dias} dias` : `${d._dias} dias`}</small>` : ''}${d.protocolo ? html`<br><small>protocolo ${d.protocolo}</small>` : ''}` },
      { label: 'Responsável', get: (d) => d._labels?.responsavel_id || '—' },
      { label: 'Prazo do órgão', num: true, get: (d) => (d.prazo_medio_dias ? `${d.prazo_medio_dias} d` : '') },
      { label: 'Arquivo', get: (d) => ((d.arquivo || []).length ? html`<a href="${fileUrl(d.arquivo[0].id)}" target="_blank" rel="noopener" data-stop>📎 abrir</a>` : html`<span class="muted">—</span>`) },
    ], lista, { rowAttrs: (d) => `class="click ${d._status === 'vencido' ? 'crit' : d._status === 'a_vencer' ? 'warn' : ''}" data-d="${d.id}"` }))}`);
  $$('tr[data-d]', view).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('[data-stop]')) openRecord('documentos', Number(tr.dataset.d), {}, { onSaved: reload }); }));
  view.querySelector('#novo')?.addEventListener('click', () => openRecord('documentos', null, { fiscalizacao: 1 }, { onSaved: reload }));
}

export async function fiscalizacao(view) {
  setTitle('Pasta de fiscalização');
  const docs = await get('/api/docs/fiscalizacao');
  const porCat = new Map();
  for (const d of docs) { const k = d.categoria || 'Outros'; if (!porCat.has(k)) porCat.set(k, []); porCat.get(k).push(d); }
  mount(view, html`
    <div class="page-head"><div><h1>📁 Pasta de fiscalização</h1><div class="sub">Documentos vigentes para mostrar ao fiscal no celular</div></div><button class="btn" onclick="window.print()">🖨 Imprimir lista</button></div>
    <div class="grid">${[...porCat.entries()].map(([cat, ds]) => card(cat, html`<div class="alert-list">${ds.map((d) => html`<div class="alert-item ${d.status === 'em_dia' ? 'verde' : 'amarelo'}"><div style="flex:1">
      <div class="t">${d.nome}</div><div class="d">${d.orgao || ''}${d.numero ? ' · nº ' + d.numero : ''} · válido até ${fmt.date(d.validade)}${d.status === 'em_renovacao' ? ` · em renovação (protocolo ${d.protocolo || 's/n'})` : ''}</div></div>
      ${(d.arquivo || []).map((a) => html`<a class="btn btn-sm" href="${fileUrl(a.id)}" target="_blank" rel="noopener">Abrir</a>`)}${(d.arquivo || []).length ? '' : badge('sem arquivo', 'yellow')}</div>`)}</div>`))}</div>`);
}
