'use strict';
const crypto = require('node:crypto');
const { HttpError } = require('./util');
const { BY_NAME, MODULES } = require('./resources');

const SESSION_HOURS = 12;

function hashPassword(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(senha, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, salt, hash] = stored.split('$');
  const test = crypto.scryptSync(String(senha), salt, 32);
  const ref = Buffer.from(hash, 'hex');
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

function login(db, loginName, senha) {
  const u = db.prepare('SELECT * FROM usuarios WHERE lower(login) = lower(?) AND ativo = 1').get(String(loginName || ''));
  if (!u || !verifyPassword(senha, u.senha)) throw new HttpError(401, 'Usuário ou senha inválidos');
  const token = crypto.randomBytes(24).toString('hex');
  const expira = new Date(Date.now() + SESSION_HOURS * 3600e3).toISOString();
  db.prepare('INSERT INTO sessoes (token, usuario_id, expira) VALUES (?, ?, ?)').run(token, u.id, expira);
  db.prepare('DELETE FROM sessoes WHERE expira < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO auditoria (at, usuario_id, acao, tabela, registro_id) VALUES (?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), u.id, 'login', 'usuarios', u.id);
  return { token, user: publicUser(u) };
}

function logout(db, token) {
  db.prepare('DELETE FROM sessoes WHERE token = ?').run(token);
}

function userFromToken(db, token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessoes WHERE token = ?').get(token);
  if (!s || s.expira < new Date().toISOString()) return null;
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ? AND ativo = 1').get(s.usuario_id);
  return u ? publicUser(u) : null;
}

function publicUser(u) {
  const { senha, ...rest } = u;
  return { ...rest };
}

const isAdmin = (user) => user.perfil === 'gerente';

function canRead(user, resName) {
  const r = BY_NAME[resName];
  if (!r) return false;
  return r.read.includes(user.perfil) || (r.selfRead || []).includes(user.perfil);
}

function canWrite(user, resName) {
  const r = BY_NAME[resName];
  return !!r && r.write.includes(user.perfil);
}

function selfOnly(user, resName) {
  const r = BY_NAME[resName];
  return !r.read.includes(user.perfil) && (r.selfRead || []).includes(user.perfil);
}

function requireRead(user, resName) {
  if (!canRead(user, resName)) throw new HttpError(403, 'Sem permissão para acessar este cadastro');
}

function requireWrite(user, resName) {
  if (!canWrite(user, resName)) throw new HttpError(403, 'Sem permissão para alterar este cadastro');
}

function requireRole(user, ...roles) {
  if (!roles.includes(user.perfil)) throw new HttpError(403, 'Sem permissão para esta operação');
}

function hasModule(user, mod) {
  return (MODULES[mod]?.roles || []).includes(user.perfil);
}

function requireModule(user, mod) {
  if (!hasModule(user, mod)) throw new HttpError(403, 'Sem acesso a este módulo');
}

module.exports = {
  hashPassword, verifyPassword, login, logout, userFromToken, publicUser,
  canRead, canWrite, selfOnly, requireRead, requireWrite, requireRole, hasModule, requireModule, isAdmin,
};
