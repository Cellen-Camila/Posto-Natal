'use strict';
// CRUD genérico sobre os recursos de resources.js, com escopo por posto,
// autoatendimento (somente os próprios registros), ganchos e trilha de auditoria.

const { BY_NAME } = require('./resources');
const auth = require('./auth');
const { HttpError, toCsv } = require('./util');

const hooks = {}; // nome do recurso -> { beforeSave, afterSave, beforeDelete, decorate }

function registerHooks(name, h) {
  hooks[name] = { ...(hooks[name] || {}), ...h };
}

function resource(name) {
  const r = BY_NAME[name];
  if (!r) throw new HttpError(404, `Recurso desconhecido: ${name}`);
  return r;
}

const nowIso = () => new Date().toISOString();

function audit(db, user, acao, tabela, id, antes, depois) {
  db.prepare('INSERT INTO auditoria (at, usuario_id, acao, tabela, registro_id, antes, depois) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(nowIso(), user ? user.id : null, acao, tabela, id ?? null,
      antes ? JSON.stringify(strip(antes)) : null, depois ? JSON.stringify(strip(depois)) : null);
}

function strip(row) {
  const { senha, _labels, ...rest } = row;
  return rest;
}

function parseRow(r, row) {
  if (!row) return row;
  const out = { ...row };
  for (const f of r.fields) {
    if ((f.type === 'json' || f.type === 'files') && typeof out[f.name] === 'string') {
      try { out[f.name] = JSON.parse(out[f.name]); } catch { /* mantém texto */ }
    }
    if (f.type === 'password') delete out[f.name];
  }
  return out;
}

function normalize(r, body, { internal = false, isNew = false } = {}) {
  const data = {};
  for (const f of r.fields) {
    if (!(f.name in body)) {
      if (isNew && f.default !== undefined) data[f.name] = f.default;
      continue;
    }
    if (f.readonly && !internal) continue;
    let v = body[f.name];
    if (v === '' || v === undefined) v = null;
    switch (f.type) {
      case 'bool': v = v === null ? 0 : (v === true || v === 1 || v === '1' || v === 'true' || v === 'on') ? 1 : 0; break;
      case 'int': case 'ref': v = v === null ? null : Math.trunc(Number(String(v).replace(',', '.'))); if (Number.isNaN(v)) v = null; break;
      case 'number': case 'money': case 'money3': v = v === null ? null : Number(String(v).replace(',', '.')); if (Number.isNaN(v)) v = null; break;
      case 'json': case 'files': v = v === null ? null : (typeof v === 'string' ? v : JSON.stringify(v)); break;
      default: v = v === null ? null : String(v);
    }
    data[f.name] = v;
  }
  return data;
}

function validate(r, row) {
  for (const f of r.fields) {
    if (f.required && (row[f.name] === null || row[f.name] === undefined || row[f.name] === '')) {
      throw new HttpError(400, `Campo obrigatório: ${f.label}`);
    }
  }
}

function postoScope(ctx, r) {
  if (!r.posto) return null;
  return ctx.postoId || null;
}

function decorateLabels(db, r, rows) {
  for (const f of r.fields.filter((x) => x.type === 'ref')) {
    const ids = [...new Set(rows.map((x) => x[f.name]).filter((x) => x != null))];
    if (!ids.length) continue;
    const target = BY_NAME[f.ref];
    const disp = target.display || 'id';
    const map = new Map(db.prepare(`SELECT id, "${disp}" AS label FROM "${target.name}" WHERE id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids).map((x) => [x.id, x.label]));
    for (const row of rows) {
      if (row[f.name] != null) {
        row._labels = row._labels || {};
        row._labels[f.name] = map.get(row[f.name]) ?? `#${row[f.name]}`;
      }
    }
  }
  return rows;
}

function buildWhere(ctx, r, query = {}) {
  const where = [];
  const params = [];
  const scope = postoScope(ctx, r);
  if (scope) { where.push('posto_id = ?'); params.push(scope); }
  if (auth.selfOnly(ctx.user, r.name)) {
    where.push(`"${r.selfField}" = ?`);
    params.push(ctx.user.funcionario_id || -1);
  }
  if (query.q) {
    const textFields = r.fields.filter((f) => ['text', 'textarea', 'select'].includes(f.type));
    if (textFields.length) {
      where.push('(' + textFields.map((f) => `"${f.name}" LIKE ?`).join(' OR ') + ')');
      textFields.forEach(() => params.push(`%${query.q}%`));
    }
  }
  for (const [k, v] of Object.entries(query)) {
    if (!k.startsWith('f_') || v === '' || v === undefined) continue;
    const name = k.slice(2);
    const f = r.fields.find((x) => x.name === name);
    if (!f && name !== 'id') continue;
    if (v === 'null') where.push(`"${name}" IS NULL`);
    else { where.push(`"${name}" = ?`); params.push(v); }
  }
  const dateField = r.fields.find((f) => f.type === 'date' || f.type === 'datetime');
  if (dateField && query.from) { where.push(`substr("${dateField.name}", 1, 10) >= ?`); params.push(query.from); }
  if (dateField && query.to) { where.push(`substr("${dateField.name}", 1, 10) <= ?`); params.push(query.to); }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

function list(ctx, name, query = {}) {
  const r = resource(name);
  auth.requireRead(ctx.user, name);
  const { sql, params } = buildWhere(ctx, r, query);
  const limit = Math.min(Number(query.limit) || 500, 5000);
  const offset = Number(query.offset) || 0;
  const total = ctx.db.prepare(`SELECT COUNT(*) AS n FROM "${name}" ${sql}`).get(...params).n;
  let rows = ctx.db.prepare(`SELECT * FROM "${name}" ${sql} ORDER BY ${r.order} LIMIT ? OFFSET ?`).all(...params, limit, offset)
    .map((row) => parseRow(r, row));
  decorateLabels(ctx.db, r, rows);
  if (hooks[name]?.decorate) rows = hooks[name].decorate(ctx, rows) || rows;
  return { rows, total };
}

function get(ctx, name, id, { check = true } = {}) {
  const r = resource(name);
  if (check) auth.requireRead(ctx.user, name);
  const row = ctx.db.prepare(`SELECT * FROM "${name}" WHERE id = ?`).get(Number(id));
  if (!row) throw new HttpError(404, 'Registro não encontrado');
  if (check && auth.selfOnly(ctx.user, name) && row[r.selfField] !== ctx.user.funcionario_id) {
    throw new HttpError(403, 'Registro de outro funcionário');
  }
  let out = parseRow(r, row);
  decorateLabels(ctx.db, r, [out]);
  if (hooks[name]?.decorate) out = (hooks[name].decorate(ctx, [out]) || [out])[0];
  return out;
}

function raw(db, name, id) {
  return db.prepare(`SELECT * FROM "${name}" WHERE id = ?`).get(Number(id));
}

function create(ctx, name, body, opts = {}) {
  const r = resource(name);
  if (!opts.internal) auth.requireWrite(ctx.user, name);
  let data = normalize(r, body, { internal: !!opts.internal, isNew: true });
  if (hooks[name]?.beforeSave) data = hooks[name].beforeSave(ctx, data, null, body) || data;
  validate(r, data);
  if (r.posto) data.posto_id = body.posto_id || ctx.postoId || ctx.defaultPostoId || null;
  data.created_at = data.updated_at = nowIso();
  data.created_by = ctx.user ? ctx.user.id : null;
  const keys = Object.keys(data);
  const info = ctx.db.prepare(`INSERT INTO "${name}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map((k) => data[k]));
  const id = Number(info.lastInsertRowid);
  const row = raw(ctx.db, name, id);
  if (!opts.noAudit) audit(ctx.db, ctx.user, 'criar', name, id, null, row);
  if (hooks[name]?.afterSave) hooks[name].afterSave(ctx, row, null);
  return get(ctx, name, id, { check: false });
}

function update(ctx, name, id, body, opts = {}) {
  const r = resource(name);
  if (!opts.internal) auth.requireWrite(ctx.user, name);
  const old = raw(ctx.db, name, id);
  if (!old) throw new HttpError(404, 'Registro não encontrado');
  if (!opts.internal && r.posto && ctx.postoId && old.posto_id && old.posto_id !== ctx.postoId) {
    throw new HttpError(403, 'Registro de outro posto');
  }
  let data = normalize(r, body, { internal: !!opts.internal });
  if (hooks[name]?.beforeSave) data = hooks[name].beforeSave(ctx, data, old, body) || data;
  validate(r, { ...old, ...data });
  data.updated_at = nowIso();
  const keys = Object.keys(data);
  ctx.db.prepare(`UPDATE "${name}" SET ${keys.map((k) => `"${k}" = ?`).join(', ')} WHERE id = ?`)
    .run(...keys.map((k) => data[k]), Number(id));
  const row = raw(ctx.db, name, id);
  if (!opts.noAudit) audit(ctx.db, ctx.user, 'alterar', name, Number(id), old, row);
  if (hooks[name]?.afterSave) hooks[name].afterSave(ctx, row, old);
  return get(ctx, name, id, { check: false });
}

function remove(ctx, name, id, opts = {}) {
  resource(name);
  if (!opts.internal) auth.requireWrite(ctx.user, name);
  const old = raw(ctx.db, name, id);
  if (!old) throw new HttpError(404, 'Registro não encontrado');
  if (hooks[name]?.beforeDelete) hooks[name].beforeDelete(ctx, old);
  ctx.db.prepare(`DELETE FROM "${name}" WHERE id = ?`).run(Number(id));
  audit(ctx.db, ctx.user, 'excluir', name, Number(id), old, null);
  return { ok: true };
}

function options(ctx, name) {
  const r = resource(name);
  // Opções para campos de referência: basta acesso a algum módulo interno
  const scope = postoScope(ctx, r);
  const disp = r.display || 'id';
  const where = [];
  const params = [];
  if (scope) { where.push('posto_id = ?'); params.push(scope); }
  if (r.fields.some((f) => f.name === 'ativo')) where.push('(ativo = 1 OR ativo IS NULL)');
  const rows = ctx.db.prepare(`SELECT id, "${disp}" AS label FROM "${name}" ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY "${disp}"`)
    .all(...params);
  if (name === 'turnos') {
    const t = ctx.db.prepare(`SELECT id, data, periodo FROM turnos ${scope ? 'WHERE posto_id = ?' : ''} ORDER BY data DESC LIMIT 200`).all(...params);
    return t.map((x) => ({ id: x.id, label: `${x.data} ${x.periodo}` }));
  }
  return rows;
}

function csv(ctx, name, query) {
  const r = resource(name);
  const { rows } = list(ctx, name, { ...query, limit: 5000 });
  const cols = r.fields.filter((f) => !f.hidden && f.type !== 'password' && f.type !== 'json').map((f) => ({
    label: f.label,
    get: (row) => {
      if (f.type === 'ref') return row._labels?.[f.name] ?? '';
      if (f.type === 'bool') return row[f.name] ? 'Sim' : 'Não';
      if (f.type === 'select') return (f.options.find((o) => String(o.value) === String(row[f.name])) || {}).label ?? row[f.name];
      if (f.type === 'files') return Array.isArray(row[f.name]) ? row[f.name].map((x) => x.nome).join(', ') : '';
      return row[f.name];
    },
  }));
  return toCsv([{ label: 'ID', key: 'id' }, ...cols], rows);
}

module.exports = { registerHooks, list, get, raw, create, update, remove, options, csv, audit, parseRow, resource };
