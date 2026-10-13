'use strict';
// Utilitários de data, número e texto usados em todo o servidor.

const pad = (n) => String(n).padStart(2, '0');

function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function today() {
  return fmtDate(new Date());
}

function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

function addMonths(s, n) {
  const d = parseDate(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return fmtDate(d);
}

function addYears(s, n) {
  return addMonths(s, n * 12);
}

function diffDays(a, b) {
  // b - a em dias
  const da = parseDate(a), db = parseDate(b);
  return Math.round((db - da) / 86400000);
}

function monthStart(s) {
  return String(s).slice(0, 7) + '-01';
}

function monthEnd(s) {
  const d = parseDate(monthStart(s));
  return fmtDate(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

function competencia(s) {
  return String(s).slice(0, 7);
}

function weekday(s) {
  return parseDate(s).getDay();
}

// "HH:MM" -> minutos
function hm(s) {
  if (!s) return null;
  const [h, m] = String(s).split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
}

function minToHm(min) {
  const sign = min < 0 ? '-' : '';
  min = Math.abs(Math.round(min));
  return `${sign}${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => Number(n) || 0;
const sum = (arr, fn = (x) => x) => arr.reduce((a, x) => a + num(fn(x)), 0);

function groupBy(arr, fn) {
  const m = new Map();
  for (const x of arr) {
    const k = fn(x);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(x);
  }
  return m;
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// CSV com ponto e vírgula (padrão do Excel em pt-BR) e BOM para acentuação.
function toCsv(columns, rows) {
  const head = columns.map((c) => csvEscape(c.label)).join(';');
  const body = rows.map((r) => columns.map((c) => {
    let v = typeof c.get === 'function' ? c.get(r) : r[c.key];
    if (typeof v === 'number') v = String(v).replace('.', ',');
    return csvEscape(v);
  }).join(';'));
  return '﻿' + [head, ...body].join('\r\n');
}

function onlyDigits(s) {
  return String(s || '').replace(/\D/g, '');
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = {
  pad, fmtDate, parseDate, today, addDays, addMonths, addYears, diffDays,
  monthStart, monthEnd, competencia, weekday, hm, minToHm, round2, num, sum,
  groupBy, toCsv, csvEscape, onlyDigits, HttpError,
};
