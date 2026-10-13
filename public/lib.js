// Biblioteca de interface: API (com fila offline), HTML seguro, formatação,
// formulários e tabelas genéricos, modais e gráficos em SVG.

export const state = {
  token: safeGet('token'),
  posto: safeGet('posto') || 'all',
  meta: null,
  optionsCache: new Map(),
};

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sem storage */ } }
export { safeGet, safeSet };

// ------------------------------------------------------------------ HTML seguro
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s ?? ''));
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function piece(v) {
  if (v instanceof Safe) return v.s;
  if (Array.isArray(v)) return v.map(piece).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s + (i < vals.length ? piece(vals[i]) : ''); });
  return new Safe(out);
}
export function mount(el, view) { el.innerHTML = piece(view); return el; }
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ------------------------------------------------------------------ Formatação
const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf3 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const nf0 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
export const fmt = {
  brl: (n) => (n == null || n === '' ? '—' : 'R$ ' + nf2.format(Number(n))),
  brl3: (n) => (n == null || n === '' ? '—' : 'R$ ' + nf3.format(Number(n))),
  num: (n, d = 0) => (n == null || n === '' ? '—' : (d === 0 ? nf0 : d === 1 ? nf1 : d === 3 ? nf3 : nf2).format(Number(n))),
  pct: (n, d = 1) => (n == null ? '—' : `${(d === 2 ? nf2 : nf1).format(Number(n))}%`),
  date: (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—'),
  dt: (s) => { if (!s) return '—'; const d = new Date(s); return Number.isNaN(+d) ? s : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); },
  hm: (m) => { if (m == null) return '—'; const s = m < 0 ? '-' : ''; m = Math.abs(Math.round(m)); return `${s}${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; },
  short: (s) => (s ? String(s).slice(8, 10) + '/' + String(s).slice(5, 7) : ''),
};
export const fmtSigned = (n, f = fmt.brl) => (n > 0 ? '+' : '') + f(n);
export const weekdays = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function addDays(s, n) { const [y, m, d] = s.split('-').map(Number); const x = new Date(y, m - 1, d + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; }
export const competencia = (s = today()) => s.slice(0, 7);
export function prevComp(c, n = 1) { const [y, m] = c.split('-').map(Number); const d = new Date(y, m - 1 - n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
export const compLabel = (c) => { const [y, m] = c.split('-'); return `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][Number(m) - 1]}/${y}`; };

// ------------------------------------------------------------------ API + fila offline
const OUTBOX = 'outbox';
export function outbox() { try { return JSON.parse(safeGet(OUTBOX) || '[]'); } catch { return []; } }
function saveOutbox(list) { safeSet(OUTBOX, JSON.stringify(list)); window.dispatchEvent(new Event('outbox')); }

export async function api(method, url, body, opts = {}) {
  const headers = { 'content-type': 'application/json' };
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  if (state.posto && state.posto !== 'all') headers['x-posto'] = state.posto;
  let res;
  try {
    res = await fetch(url, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (e) {
    if (opts.offline && method !== 'GET') {
      saveOutbox([...outbox(), { method, url, body, posto: state.posto, at: new Date().toISOString(), label: opts.label || url }]);
      toast('Sem internet: registro guardado e será enviado quando a conexão voltar.', 'ok');
      return { queued: true };
    }
    throw new Error('Sem conexão com o servidor');
  }
  if (res.status === 401 && !url.endsWith('/login')) {
    state.token = null;
    safeSet('token', null);
    location.hash = '#/login';
    throw new Error('Sessão expirada');
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || `Erro ${res.status}`);
  return data;
}
export const get = (url) => api('GET', url);
export const post = (url, body, opts) => api('POST', url, body ?? {}, opts);
export const put = (url, body, opts) => api('PUT', url, body ?? {}, opts);
export const del = (url) => api('DELETE', url);

export async function syncOutbox() {
  const list = outbox();
  if (!list.length) return 0;
  const rest = [];
  let ok = 0;
  for (const item of list) {
    try {
      const headers = { 'content-type': 'application/json', authorization: `Bearer ${state.token}` };
      if (item.posto && item.posto !== 'all') headers['x-posto'] = item.posto;
      const r = await fetch(item.url, { method: item.method, headers, body: JSON.stringify(item.body) });
      if (r.ok) ok++;
      else if (r.status >= 500) rest.push(item);
      else { const d = await r.json().catch(() => ({})); toast(`Não sincronizado (${item.label}): ${d.error || r.status}`, 'err'); }
    } catch { rest.push(item); }
  }
  saveOutbox(rest);
  if (ok) toast(`${ok} registro(s) feitos sem internet foram sincronizados.`, 'ok');
  return ok;
}

export function fileUrl(id) { return `/api/files/${encodeURIComponent(id)}?token=${encodeURIComponent(state.token || '')}`; }
export function downloadUrl(url) {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(state.token || '')}${state.posto && state.posto !== 'all' ? `&posto=${state.posto}` : ''}`;
}

// ------------------------------------------------------------------ Toast e modal
export function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'err' ? 6000 : 3500);
}
export function handleErr(e) { toast(e.message || String(e), 'err'); }

export function modal({ title, body, foot = '', size = '' }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = piece(html`<div class="modal ${size}" role="dialog" aria-modal="true">
    <div class="modal-head"><h2 style="margin:0">${title}</h2><button class="icon-btn" data-close aria-label="Fechar">✕</button></div>
    <div class="modal-body">${body}</div>${foot ? html`<div class="modal-foot">${foot}</div>` : ''}</div>`);
  document.body.appendChild(bg);
  const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  bg.addEventListener('mousedown', (e) => { if (e.target === bg) close(); });
  $$('[data-close]', bg).forEach((b) => b.addEventListener('click', close));
  return { el: bg, close };
}

export function confirmDialog(msg, { ok = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = modal({ title: 'Confirmação', size: 'sm', body: html`<p>${msg}</p>`, foot: html`<button class="btn" data-close>Cancelar</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${ok}</button>` });
    $('[data-ok]', m.el).addEventListener('click', () => { m.close(); resolve(true); });
    $$('[data-close]', m.el).forEach((b) => b.addEventListener('click', () => resolve(false)));
  });
}

// ------------------------------------------------------------------ Componentes
export const badge = (text, tone = '') => html`<span class="badge ${tone ? 'b-' + tone : ''}">${text}</span>`;
export function kpi(label, value, sub = '', { tone = '', href = '' } = {}) {
  const inner = html`<div class="label">${label}</div><div class="value">${value}</div>${sub ? html`<div class="sub">${sub}</div>` : ''}`;
  return href ? html`<a class="kpi ${tone}" href="${href}">${inner}</a>` : html`<div class="kpi ${tone}">${inner}</div>`;
}
export function card(title, body, actions = '') {
  return html`<section class="card">${title ? html`<div class="card-head"><h3>${title}</h3><div class="row">${actions}</div></div>` : ''}${body}</section>`;
}
export function variation(pct) {
  if (pct == null) return '';
  return html`<span class="${pct >= 0 ? 'up' : 'down'}">${pct >= 0 ? '▲' : '▼'} ${fmt.pct(Math.abs(pct))}</span>`;
}
export function progress(pct, tone = '') {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return html`<div class="bar ${tone}"><span style="width:${p}%"></span></div>`;
}

// Tabela: columns = [{ label, get(row) -> valor/html, num: bool, cls }]
export function table(columns, rows, { rowAttrs, empty = 'Nenhum registro', foot } = {}) {
  if (!rows.length) return html`<div class="empty">${empty}</div>`;
  return html`<div class="scroll"><table class="tbl"><thead><tr>${columns.map((c) => html`<th class="${c.num ? 'num' : ''}">${c.label}</th>`)}</tr></thead>
    <tbody>${rows.map((r, i) => html`<tr ${raw(rowAttrs ? rowAttrs(r, i) : '')}>${columns.map((c) => html`<td class="${c.num ? 'num' : ''} ${c.cls || ''}">${c.get ? c.get(r, i) : r[c.key]}</td>`)}</tr>`)}</tbody>
    ${foot ? html`<tfoot><tr>${foot.map((f, i) => html`<td class="${columns[i]?.num ? 'num' : ''}">${f}</td>`)}</tr></tfoot>` : ''}</table></div>`;
}

export function alertList(list, { max = 50 } = {}) {
  if (!list.length) return html`<div class="empty">Nenhum alerta. Tudo em dia ✔</div>`;
  return html`<div class="alert-list">${list.slice(0, max).map((a) => html`<a class="alert-item ${a.nivel}" href="${a.link || '#'}">
    <div><div class="t">${a.titulo}</div><div class="d">${a.detalhe || ''}</div></div></a>`)}</div>`;
}

// ------------------------------------------------------------------ Gráficos (SVG)
export function lineChart(series, { height = 220, yFormat = (v) => fmt.num(v), xFormat = fmt.short, width = 640 } = {}) {
  const all = series.flatMap((s) => s.points.filter((p) => p.y != null));
  if (!all.length) return html`<div class="empty">Sem dados</div>`;
  const xs = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort();
  let min = Math.min(...all.map((p) => p.y)), max = Math.max(...all.map((p) => p.y));
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * 0.08;
  min -= pad; max += pad;
  if (series.every((s) => s.zero) && min + pad >= 0) min = 0;
  const L = 58, R = 10, T = 10, B = 26, W = width - L - R, H = height - T - B;
  const xi = new Map(xs.map((x, i) => [x, i]));
  const X = (x) => L + (xs.length > 1 ? (xi.get(x) / (xs.length - 1)) * W : W / 2);
  const Y = (y) => T + H - ((y - min) / (max - min)) * H;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => min + t * (max - min));
  const step = Math.max(1, Math.ceil(xs.length / 8));
  return html`<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">
    ${ticks.map((t) => html`<line class="grid-line" x1="${L}" x2="${L + W}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${L - 6}" y="${Y(t) + 4}" text-anchor="end">${yFormat(t)}</text>`)}
    ${xs.map((x, i) => ((i % step === 0 && (xs.length - 1 - i >= step / 2 || i === xs.length - 1)) || i === xs.length - 1 ? html`<text x="${X(x)}" y="${height - 8}" text-anchor="middle">${xFormat(x)}</text>` : ''))}
    ${series.map((s) => {
      const pts = s.points.filter((p) => p.y != null);
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
      return html`<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2" ${raw(s.dash ? 'stroke-dasharray="5 4"' : '')}/>
        ${pts.length < 40 ? pts.map((p) => html`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="2.5" fill="${s.color}"><title>${xFormat(p.x)}: ${yFormat(p.y)}</title></circle>`) : ''}`;
    })}
  </svg><div class="legend">${series.map((s) => html`<span><i style="background:${s.color}"></i>${s.name}</span>`)}</div>`;
}

export function barChart(items, { height = 200, yFormat = (v) => fmt.num(v), width = 640, color = 'var(--c1)' } = {}) {
  if (!items.length) return html`<div class="empty">Sem dados</div>`;
  const max = Math.max(...items.map((i) => i.value), 0) || 1;
  const L = 50, B = 24, T = 8, W = width - L - 8, H = height - B - T;
  const bw = W / items.length;
  return html`<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">
    ${[0, 0.5, 1].map((t) => html`<line class="grid-line" x1="${L}" x2="${L + W}" y1="${T + H - t * H}" y2="${T + H - t * H}"/><text x="${L - 6}" y="${T + H - t * H + 4}" text-anchor="end">${yFormat(max * t)}</text>`)}
    ${items.map((it, i) => {
      const h = (it.value / max) * H;
      return html`<rect x="${L + i * bw + bw * 0.15}" y="${T + H - h}" width="${bw * 0.7}" height="${Math.max(0, h)}" rx="3" fill="${it.color || color}"><title>${it.label}: ${yFormat(it.value)}</title></rect>
        <text x="${L + i * bw + bw / 2}" y="${height - 7}" text-anchor="middle">${it.label}</text>`;
    })}
  </svg>`;
}

export function hbars(items, { format = (v) => fmt.num(v), max } = {}) {
  const m = (max ?? Math.max(...items.map((i) => i.value), 0)) || 1;
  return html`<div class="hbars">${items.map((i) => html`<div class="hbar"><span>${i.label}</span><div class="bar ${i.tone || ''}"><span style="width:${Math.max(0, (i.value / m) * 100)}%"></span></div><b class="nowrap">${format(i.value)}</b></div>`)}</div>`;
}

// ------------------------------------------------------------------ Formulários genéricos
export async function refOptions(res) {
  if (state.optionsCache.has(res)) return state.optionsCache.get(res);
  const p = get(`/api/options/${res}`).catch(() => []);
  state.optionsCache.set(res, p);
  return p;
}
export function clearOptions(res) { if (res) state.optionsCache.delete(res); else state.optionsCache.clear(); }

function inputFor(f, v, refs) {
  const name = f.name;
  const ro = f.readonly ? 'disabled' : '';
  const req = f.required ? 'required' : '';
  switch (f.type) {
    case 'textarea': return html`<textarea name="${name}" ${raw(ro)} ${raw(req)}>${v ?? ''}</textarea>`;
    case 'bool': return html`<input type="checkbox" name="${name}" ${raw(v ? 'checked' : '')} ${raw(ro)}>`;
    case 'select': return html`<select name="${name}" ${raw(ro)} ${raw(req)}><option value=""></option>${f.options.map((o) => html`<option value="${o.value}" ${raw(String(o.value) === String(v ?? '') ? 'selected' : '')}>${o.label}</option>`)}</select>`;
    case 'ref': return html`<select name="${name}" ${raw(ro)} ${raw(req)}><option value=""></option>${(refs[f.ref] || []).map((o) => html`<option value="${o.id}" ${raw(String(o.id) === String(v ?? '') ? 'selected' : '')}>${o.label}</option>`)}</select>`;
    case 'date': return html`<input type="date" name="${name}" value="${v ? String(v).slice(0, 10) : ''}" ${raw(ro)} ${raw(req)}>`;
    case 'datetime': return html`<input type="datetime-local" name="${name}" value="${v ? String(v).slice(0, 16) : ''}" ${raw(ro)} ${raw(req)}>`;
    case 'time': return html`<input type="time" name="${name}" value="${v ?? ''}" ${raw(ro)} ${raw(req)}>`;
    case 'number': case 'money': case 'money3': case 'int':
      return html`<input type="number" inputmode="decimal" step="${f.type === 'int' ? '1' : f.type === 'money' ? '0.01' : 'any'}" name="${name}" value="${v ?? ''}" ${raw(ro)} ${raw(req)}>`;
    case 'password': return html`<input type="password" name="${name}" autocomplete="new-password">`;
    case 'files': return html`<div class="files" data-name="${name}"><div class="chips">${(Array.isArray(v) ? v : []).map((a) => fileChip(a))}</div>
      <input type="hidden" name="${name}" value="${JSON.stringify(Array.isArray(v) ? v : [])}">
      ${f.readonly ? '' : html`<input type="file" multiple accept="image/*,application/pdf,.xml,.doc,.docx,.xls,.xlsx" capture="environment" data-upload="${name}" style="margin-top:6px">`}</div>`;
    default: return html`<input type="text" name="${name}" value="${v ?? ''}" ${raw(ro)} ${raw(req)}>`;
  }
}
const fileChip = (a) => html`<span class="chip" data-id="${a.id}"><a href="${fileUrl(a.id)}" target="_blank" rel="noopener">📎 ${a.nome}</a><button type="button" data-rm="${a.id}" title="Remover">✕</button></span>`;

export async function formFields(fields, values = {}, { only } = {}) {
  const list = fields.filter((f) => !f.hidden && f.type !== 'json' && (!only || only.includes(f.name)));
  const refs = {};
  await Promise.all([...new Set(list.filter((f) => f.type === 'ref').map((f) => f.ref))].map(async (r) => { refs[r] = await refOptions(r); }));
  return html`<div class="form-grid">${list.map((f) => {
    const wide = ['textarea', 'files'].includes(f.type);
    const v = values[f.name] ?? (values.id ? null : f.default);
    if (f.type === 'bool') return html`<label class="check ${wide ? 'wide' : ''}">${inputFor(f, v, refs)} ${f.label}</label>`;
    return html`<label class="${wide ? 'wide' : ''}"><span class="${f.required ? 'req' : ''}">${f.label}</span>${inputFor(f, v, refs)}${f.help ? html`<span class="field-help">${f.help}</span>` : ''}</label>`;
  })}</div>`;
}

// Liga uploads e remoções de anexos dentro de um formulário
export function bindFiles(root) {
  $$('[data-upload]', root).forEach((inp) => inp.addEventListener('change', async () => {
    const box = inp.closest('.files');
    const hidden = $(`input[type=hidden][name="${inp.dataset.upload}"]`, box);
    const list = JSON.parse(hidden.value || '[]');
    for (const file of inp.files) {
      if (file.size > 15 * 1024 * 1024) { toast(`${file.name}: acima de 15 MB`, 'err'); continue; }
      const dados = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
      try {
        const up = await post('/api/upload', { nome: file.name, tipo: file.type, dados });
        list.push({ id: up.id, nome: up.nome });
        $('.chips', box).insertAdjacentHTML('beforeend', piece(fileChip(up)));
      } catch (e) { handleErr(e); }
    }
    hidden.value = JSON.stringify(list);
    inp.value = '';
  }));
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (!b) return;
    const box = b.closest('.files');
    const hidden = $('input[type=hidden]', box);
    hidden.value = JSON.stringify(JSON.parse(hidden.value || '[]').filter((a) => a.id !== b.dataset.rm));
    b.closest('.chip').remove();
  });
}

export function readForm(root, fields) {
  const out = {};
  for (const f of fields) {
    if (f.hidden || f.readonly || f.type === 'json') continue;
    const el = root.querySelector(`[name="${f.name}"]`);
    if (!el) continue;
    if (f.type === 'bool') out[f.name] = el.checked ? 1 : 0;
    else if (f.type === 'files') out[f.name] = JSON.parse(el.value || '[]');
    else if (f.type === 'password') { if (el.value) out[f.name] = el.value; }
    else out[f.name] = el.value === '' ? null : el.value;
  }
  return out;
}

// Exibe valor de um campo em tabela
export function cell(f, row) {
  const v = row[f.name];
  if (v === null || v === undefined || v === '') return f.type === 'bool' ? '' : html`<span class="muted">—</span>`;
  switch (f.type) {
    case 'money': return fmt.brl(v);
    case 'money3': return fmt.brl3(v);
    case 'number': return fmt.num(v, Number.isInteger(v) ? 0 : 2);
    case 'int': return fmt.num(v);
    case 'date': return fmt.date(v);
    case 'datetime': return fmt.dt(v);
    case 'bool': return v ? '✔' : '';
    case 'select': return (f.options.find((o) => String(o.value) === String(v)) || {}).label ?? v;
    case 'ref': return row._labels?.[f.name] ?? `#${v}`;
    case 'files': return Array.isArray(v) && v.length ? `📎 ${v.length}` : '';
    case 'textarea': return String(v).length > 80 ? String(v).slice(0, 80) + '…' : v;
    default: return v;
  }
}

export function resMeta(name) { return state.meta?.resources.find((r) => r.name === name); }
export function canRead(name) { return !!resMeta(name); }
export function canWrite(name) { return !!resMeta(name)?.canWrite; }
export const isRole = (...roles) => roles.includes(state.meta?.user?.perfil);

// Seletor de competência (AAAA-MM)
export function compSelect(value, n = 12) {
  const opts = [];
  for (let i = -1; i < n; i++) opts.push(prevComp(competencia(), i));
  return html`<select data-comp>${opts.map((c) => html`<option value="${c}" ${raw(c === value ? 'selected' : '')}>${compLabel(c)}</option>`)}</select>`;
}
