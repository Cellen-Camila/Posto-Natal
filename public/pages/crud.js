// Tela genérica de cadastro: lista com busca/filtros/exportação e formulário em modal.
import {
  state, html, raw, mount, $, $$, get, post, put, del, toast, handleErr, modal, confirmDialog, table, cell, formFields, bindFiles,
  readForm, resMeta, canWrite, downloadUrl, refOptions, clearOptions, badge, fmt, today, isRole,
} from '../lib.js';
import { setTitle, navigate } from '../app.js';

const STATUS_DOC = { vencido: ['Vencido', 'red'], a_vencer: ['A vencer', 'yellow'], em_dia: ['Em dia', 'green'], em_renovacao: ['Em renovação', 'blue'], sem_validade: ['Sem validade', ''] };

function rowTone(res, r) {
  const hoje = today();
  if (res === 'documentos') return r._status === 'vencido' ? 'crit' : r._status === 'a_vencer' ? 'warn' : '';
  if (res === 'descargas') return r.status === 'recusada' ? 'crit' : '';
  if (res === 'faltas_caixa') return r.tratamento === 'pendente' ? 'warn' : '';
  if (res === 'contas_pagar') return ['aberta', 'aguardando_aprovacao'].includes(r.status) && r.vencimento < hoje ? 'crit' : r.status === 'aguardando_aprovacao' ? 'warn' : '';
  if (res === 'contas_receber') return r.status === 'aberta' && r.vencimento < hoje ? 'crit' : '';
  if (res === 'lotes_validade') return !r.baixado && r.validade < hoje ? 'crit' : !r.baixado && r.validade <= addDaysStr(hoje, 15) ? 'warn' : '';
  if (res === 'caixas') return r.diferenca < -0.009 ? 'warn' : '';
  if (res === 'aprovacoes') return r.status === 'pendente' ? 'warn' : '';
  return '';
}
function addDaysStr(s, n) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

function extraColumns(res) {
  if (res === 'documentos') return [{ label: 'Situação', get: (r) => { const s = STATUS_DOC[r._status] || ['', '']; return html`${badge(s[0], s[1])} ${r._dias != null ? html`<small>${r._dias < 0 ? `${-r._dias}d atrás` : `${r._dias}d`}</small>` : ''}`; } }];
  if (res === 'contas_pagar' || res === 'contas_receber') return [{ label: 'Situação', get: (r) => (['aberta', 'aguardando_aprovacao'].includes(r.status) && r.vencimento < today() ? badge('Vencida', 'red') : '') }];
  return [];
}

export async function listPage(view, [res, id], query = {}) {
  const meta = resMeta(res);
  if (!meta) { mount(view, html`<div class="card">Sem permissão para acessar este cadastro.</div>`); return; }
  setTitle(meta.label);
  const writable = canWrite(res);
  const listFields = meta.fields.filter((f) => f.list && !f.hidden);
  const filterFields = meta.fields.filter((f) => f.list && f.type === 'select').slice(0, 3);
  const refFilter = meta.fields.find((f) => f.list && f.type === 'ref' && ['funcionario_id', 'combustivel_id', 'cliente_id', 'produto_id', 'fornecedor_id', 'tanque_id', 'concorrente_id'].includes(f.name));
  const dateField = meta.fields.find((f) => f.type === 'date' || f.type === 'datetime');
  const refOpts = refFilter ? await refOptions(refFilter.ref) : [];
  const filters = { q: query.q || '', from: query.from || '', to: query.to || '' };
  for (const [k, v] of Object.entries(query)) if (k.startsWith('f_')) filters[k] = v;

  mount(view, html`
    <div class="page-head">
      <div><h1>${meta.label}</h1>${meta.sensitive ? html`<div class="sub">🔒 Dados de saúde — acesso restrito ao RH e ao gerente (LGPD)</div>` : ''}</div>
      <div class="row">
        ${writable ? html`<button class="btn btn-primary" id="novo">+ Novo</button>` : ''}
        <a class="btn" id="csv" href="#">⬇ Excel (CSV)</a>
        <button class="btn" onclick="window.print()">🖨 Imprimir / PDF</button>
      </div>
    </div>
    <div class="card">
      <form class="toolbar" id="filtros">
        <input type="search" name="q" placeholder="Buscar…" value="${filters.q}" style="min-width:180px">
        ${filterFields.map((f) => html`<select name="f_${f.name}"><option value="">${f.label}: todos</option>${f.options.map((o) => html`<option value="${o.value}" ${raw(String(filters['f_' + f.name] ?? '') === String(o.value) ? 'selected' : '')}>${o.label}</option>`)}</select>`)}
        ${refFilter ? html`<select name="f_${refFilter.name}"><option value="">${refFilter.label}: todos</option>${refOpts.map((o) => html`<option value="${o.id}" ${raw(String(filters['f_' + refFilter.name] ?? '') === String(o.id) ? 'selected' : '')}>${o.label}</option>`)}</select>` : ''}
        ${dateField ? html`<label class="row"><small>De</small><input type="date" name="from" value="${filters.from}"></label><label class="row"><small>até</small><input type="date" name="to" value="${filters.to}"></label>` : ''}
        <button class="btn" type="submit">Filtrar</button>
      </form>
      <div id="lista"></div>
    </div>`);

  let rows = [];
  let total = 0;
  const qs = () => {
    const fd = new FormData($('#filtros', view));
    const p = new URLSearchParams();
    for (const [k, v] of fd.entries()) if (v) p.set(k, v);
    return p;
  };
  async function load(append = false) {
    const p = qs();
    p.set('limit', '200');
    p.set('offset', append ? String(rows.length) : '0');
    try {
      const r = await get(`/api/r/${res}?${p}`);
      rows = append ? rows.concat(r.rows) : r.rows;
      total = r.total;
      draw();
    } catch (e) { handleErr(e); }
    const c = qs(); c.set('format', 'csv');
    $('#csv', view).href = downloadUrl(`/api/r/${res}?${c}`);
  }
  function draw() {
    const cols = listFields.map((f) => ({ label: f.label, num: ['money', 'money3', 'number', 'int'].includes(f.type), get: (r) => cell(f, r) })).concat(extraColumns(res));
    mount($('#lista', view), html`${table(cols, rows, { rowAttrs: (r) => `class="click ${rowTone(res, r)}" data-id="${r.id}"` })}
      <div class="row between mt"><small class="muted">${rows.length} de ${total} registro(s)</small>${rows.length < total ? html`<button class="btn btn-sm" id="mais">Carregar mais</button>` : ''}</div>`);
    $('#mais', view)?.addEventListener('click', () => load(true));
  }
  $('#filtros', view).addEventListener('submit', (e) => { e.preventDefault(); load(); });
  $$('#filtros select', view).forEach((s) => s.addEventListener('change', () => load()));
  $('#lista', view).addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) openRecord(res, Number(tr.dataset.id), {}, { onSaved: () => load() });
  });
  $('#novo', view)?.addEventListener('click', () => openRecord(res, null, defaultsFrom(filters, meta), { onSaved: () => load() }));
  await load();
  if (id) openRecord(res, Number(id), {}, { onSaved: () => load() });
}

function defaultsFrom(filters, meta) {
  const d = {};
  for (const [k, v] of Object.entries(filters)) if (k.startsWith('f_') && v) d[k.slice(2)] = v;
  const df = meta.fields.find((f) => f.type === 'date' && f.required);
  if (df && !d[df.name]) d[df.name] = today();
  return d;
}

// Ações extras exibidas no rodapé do formulário, por recurso
function extraActions(res, row) {
  if (!row?.id) return '';
  const a = [];
  if (res === 'funcionarios') a.push(html`<a class="btn" href="#/rh/funcionario/${row.id}">Linha do tempo</a>`, html`<a class="btn" href="#/rh/ponto/${row.id}">Espelho de ponto</a>`);
  if (res === 'turnos') a.push(html`<a class="btn" href="#/pista/turno/${row.id}">Abrir conferência do turno</a>`);
  if (res === 'notas_entrada' && row.status === 'pendente') a.push(html`<a class="btn btn-primary" href="#/conveniencia/notas/${row.id}">Conferir nota</a>`);
  if ((res === 'caixas' || res === 'faltas_caixa') && !row.assinado_at && canWrite(res)) a.push(html`<button class="btn" data-assinar="${res}">✍ Assinatura do frentista</button>`);
  if (res === 'contas_pagar' && ['aberta'].includes(row.status) && canWrite(res)) a.push(html`<button class="btn" data-quick='{"status":"paga"}'>Marcar como paga</button>`);
  if (res === 'contas_receber' && row.status === 'aberta' && canWrite(res)) a.push(html`<button class="btn" data-quick='{"status":"recebida"}'>Registrar recebimento</button>`);
  if (res === 'lotes_validade' && !row.baixado && canWrite(res)) a.push(html`<button class="btn" data-quick='{"baixado":1}'>Baixar lote</button>`);
  if (res === 'documentos' && row.arquivo?.length) a.push(html`<span class="muted">${row.arquivo.length} arquivo(s)</span>`);
  return a;
}

export async function openRecord(res, id, defaults = {}, { onSaved, readonly } = {}) {
  const meta = resMeta(res);
  let row = { ...defaults };
  try { if (id) row = await get(`/api/r/${res}/${id}`); } catch (e) { handleErr(e); return; }
  const writable = canWrite(res) && !readonly;
  const fields = writable ? meta.fields : meta.fields.map((f) => ({ ...f, readonly: true }));
  const status = res === 'documentos' && row._status ? badge((STATUS_DOC[row._status] || [''])[0], (STATUS_DOC[row._status] || ['', ''])[1]) : '';
  const m = modal({
    title: html`${id ? (writable ? 'Editar' : 'Detalhes') : 'Novo'} — ${meta.label} ${status}`,
    body: html`<form id="rec">${await formFields(fields, row)}</form>
      ${row.created_at ? html`<p class="muted mt"><small>Criado em ${fmt.dt(row.created_at)}${row.updated_at && row.updated_at !== row.created_at ? ` · alterado em ${fmt.dt(row.updated_at)}` : ''} · registro #${row.id}</small></p>` : ''}`,
    foot: html`${id && writable ? html`<button class="btn btn-danger" id="excluir">Excluir</button>` : ''}<span class="spacer"></span>${extraActions(res, row)}
      <button class="btn" data-close>Fechar</button>${writable ? html`<button class="btn btn-primary" id="salvar">Salvar</button>` : ''}`,
  });
  bindFiles(m.el);
  const save = async (extra = {}) => {
    const form = $('#rec', m.el);
    if (!form.reportValidity()) return;
    const body = { ...readForm(form, meta.fields), ...extra };
    try {
      if (id) await put(`/api/r/${res}/${id}`, body);
      else await post(`/api/r/${res}`, { ...defaults, ...body });
      toast('Salvo', 'ok');
      clearOptions(res);
      m.close();
      onSaved?.();
    } catch (e) { handleErr(e); }
  };
  $('#salvar', m.el)?.addEventListener('click', () => save());
  $$('[data-quick]', m.el).forEach((b) => b.addEventListener('click', () => save(JSON.parse(b.dataset.quick))));
  $('#excluir', m.el)?.addEventListener('click', async () => {
    if (!(await confirmDialog('Excluir este registro? A exclusão fica registrada na trilha de auditoria.', { ok: 'Excluir', danger: true }))) return;
    try { await del(`/api/r/${res}/${id}`); toast('Excluído', 'ok'); m.close(); onSaved?.(); } catch (e) { handleErr(e); }
  });
  $('[data-assinar]', m.el)?.addEventListener('click', () => { m.close(); assinaturaFrentista(res, id, onSaved); });
  return m;
}

// Assinatura digital do frentista no celular do chefe (login e senha do próprio frentista)
export function assinaturaFrentista(tabela, id, onDone) {
  const m = modal({
    title: 'Assinatura do frentista', size: 'sm',
    body: html`<p class="muted">O frentista confirma o fechamento/ciência digitando o próprio usuário e senha.</p>
      <form id="ass" class="form-grid" style="grid-template-columns:1fr">
        <label>Usuário do frentista<input name="login" required autocomplete="off"></label>
        <label>Senha<input name="senha" type="password" required autocomplete="off"></label>
      </form>`,
    foot: html`<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" id="ok">Assinar</button>`,
  });
  $('#ok', m.el).addEventListener('click', async () => {
    const f = $('#ass', m.el);
    if (!f.reportValidity()) return;
    try {
      await post(`/api/pista/assinar/${tabela}/${id}`, { login: f.login.value, senha: f.senha.value });
      toast('Assinado', 'ok');
      m.close();
      onDone?.();
    } catch (e) { handleErr(e); }
  });
}

export { navigate, isRole };
