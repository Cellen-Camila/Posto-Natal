'use strict';
// Servidor HTTP (sem dependências): API REST + arquivos estáticos da SPA.

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const { ROLES, MODULES, RESOURCES } = require('./resources');
const auth = require('./auth');
const crud = require('./crud');
const core = require('./services/core');
const pista = require('./services/pista');
const rh = require('./services/rh');
const fin = require('./services/financeiro');
const conv = require('./services/conveniencia');
const comb = require('./services/combustiveis');
const precos = require('./services/precos');
const docs = require('./services/documentos');
const alertas = require('./services/alertas');
const painel = require('./services/painel');
const contabil = require('./services/contabil');
const { HttpError, today, addDays, competencia, monthStart } = require('./util');

const PUBLIC = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
};

function createApp({ db, dataDir, demo = false }) {
  const uploadsDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, ...opts });
  };

  const defaultPostoId = () => db.prepare('SELECT id FROM postos ORDER BY id LIMIT 1').get()?.id || null;

  // ---------------------------------------------------------------- Autenticação
  route('POST', '/api/login', ({ body }) => auth.login(db, body.login, body.senha), { public: true });
  route('GET', '/api/info', () => ({ demo: !!demo, posto: db.prepare('SELECT nome FROM postos ORDER BY id LIMIT 1').get()?.nome || '' }), { public: true });
  route('POST', '/api/logout', ({ token }) => { auth.logout(db, token); return { ok: true }; });
  route('GET', '/api/me', ({ ctx }) => ctx.user);
  route('POST', '/api/me/senha', ({ ctx, body }) => {
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(ctx.user.id);
    if (!auth.verifyPassword(body.atual, u.senha)) throw new HttpError(400, 'Senha atual incorreta');
    if (String(body.nova || '').length < 8) throw new HttpError(400, 'A nova senha deve ter ao menos 8 caracteres');
    if (body.nova === body.atual) throw new HttpError(400, 'A nova senha deve ser diferente da atual');
    db.prepare('UPDATE usuarios SET senha = ?, trocar_senha = 0 WHERE id = ?').run(auth.hashPassword(body.nova), u.id);
    crud.audit(db, ctx.user, 'trocar_senha', 'usuarios', u.id);
    return { ok: true };
  });

  route('GET', '/api/meta', ({ ctx }) => {
    const u = ctx.user;
    return {
      user: u,
      roles: ROLES,
      modules: Object.fromEntries(Object.entries(MODULES).filter(([, m]) => m.roles.includes(u.perfil)).map(([k, m]) => [k, m.label])),
      resources: RESOURCES.filter((r) => auth.canRead(u, r.name)).map((r) => ({
        name: r.name, label: r.label, module: r.module, display: r.display, fields: r.fields,
        canWrite: auth.canWrite(u, r.name), sensitive: !!r.sensitive,
      })),
      postos: db.prepare('SELECT id, nome FROM postos ORDER BY id').all().filter((p) => !u.posto_id || p.id === u.posto_id),
      hoje: today(),
    };
  });

  // ---------------------------------------------------------------- CRUD genérico
  route('GET', '/api/options/:res', ({ ctx, params }) => crud.options(ctx, params.res));
  route('GET', '/api/r/:res', ({ ctx, params, query, res }) => {
    if (query.format === 'csv') {
      auth.requireRead(ctx.user, params.res);
      return sendFile(res, crud.csv(ctx, params.res, query), 'text/csv; charset=utf-8', `${params.res}-${today()}.csv`);
    }
    return crud.list(ctx, params.res, query);
  });
  route('GET', '/api/r/:res/:id', ({ ctx, params }) => crud.get(ctx, params.res, params.id));
  route('POST', '/api/r/:res', ({ ctx, params, body }) => crud.create(ctx, params.res, body));
  route('PUT', '/api/r/:res/:id', ({ ctx, params, body }) => {
    if (params.res === 'usuarios') return salvarUsuario(ctx, params.id, body);
    return crud.update(ctx, params.res, params.id, body);
  });
  route('DELETE', '/api/r/:res/:id', ({ ctx, params }) => crud.remove(ctx, params.res, params.id));

  crud.registerHooks('usuarios', {
    beforeSave(ctx, data, old, body) {
      if (body.senha) {
        if (String(body.senha).length < 6) throw new HttpError(400, 'A senha deve ter ao menos 6 caracteres');
        data.senha = auth.hashPassword(body.senha);
        data.trocar_senha = 1; // senha definida pelo gerente: a pessoa cria a sua no primeiro acesso
      } else {
        delete data.senha;
        if (!old) throw new HttpError(400, 'Informe a senha inicial');
      }
      const dup = db.prepare('SELECT id FROM usuarios WHERE lower(login) = lower(?) AND id <> ?').get(data.login || old?.login, old?.id || 0);
      if (dup) throw new HttpError(409, 'Login já existe');
      return data;
    },
  });
  function salvarUsuario(ctx, id, body) {
    return crud.update(ctx, 'usuarios', id, body);
  }

  // ---------------------------------------------------------------- Arquivos
  route('POST', '/api/upload', ({ ctx, body }) => {
    const { nome, tipo, dados } = body;
    if (!nome || !dados) throw new HttpError(400, 'Arquivo inválido');
    const buf = Buffer.from(String(dados).replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (buf.length > 15 * 1024 * 1024) throw new HttpError(413, 'Arquivo acima de 15 MB');
    const ext = path.extname(nome).toLowerCase().replace(/[^.a-z0-9]/g, '');
    const id = crypto.randomUUID() + ext;
    fs.writeFileSync(path.join(uploadsDir, id), buf);
    db.prepare('INSERT INTO arquivos (id, nome, tipo, tamanho, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, nome, tipo || MIME[ext] || 'application/octet-stream', buf.length, new Date().toISOString(), ctx.user.id);
    return { id, nome, tamanho: buf.length };
  });
  route('GET', '/api/files/:id', ({ params, res }) => {
    const meta = db.prepare('SELECT * FROM arquivos WHERE id = ?').get(params.id);
    const p = path.join(uploadsDir, path.basename(params.id));
    if (!meta || !fs.existsSync(p)) throw new HttpError(404, 'Arquivo não encontrado');
    return sendFile(res, fs.readFileSync(p), meta.tipo, meta.nome, true);
  });

  // ---------------------------------------------------------------- Painel, alertas, aprovações
  route('GET', '/api/painel', ({ ctx }) => painel.painel(ctx));
  route('GET', '/api/alertas', ({ ctx }) => alertas.computeAlerts(ctx));
  route('POST', '/api/aprovacoes/:id', ({ ctx, params, body }) => core.decidir(ctx, params.id, !!body.aprovado, body.motivo));

  // ---------------------------------------------------------------- Pista
  route('GET', '/api/pista/abertura', ({ ctx, query }) => pista.preparoAbertura(ctx, query.data || today(), query.periodo));
  route('POST', '/api/pista/turnos', ({ ctx, body }) => pista.abrirTurno(ctx, body));
  route('GET', '/api/pista/turnos/:id', ({ ctx, params }) => pista.detalheTurno(ctx, params.id));
  route('POST', '/api/pista/turnos/:id/fechar', ({ ctx, params, body }) => pista.fecharTurno(ctx, params.id, body));
  route('POST', '/api/pista/assinar/:tabela/:id', ({ ctx, params, body }) => pista.assinar(ctx, params.tabela, params.id, body));
  route('GET', '/api/pista/faltas', ({ ctx, query }) => pista.relatorioFaltas(ctx, query.competencia || competencia(today())));

  // ---------------------------------------------------------------- RH
  const rhGuard = (ctx) => auth.requireModule(ctx.user, 'rh');
  route('GET', '/api/rh/espelho/:fid', ({ ctx, params, query }) => rh.espelho(ctx, params.fid, query.competencia || competencia(today())));
  route('GET', '/api/rh/equipe', ({ ctx, query }) => rh.resumoEquipe(ctx, query.competencia || competencia(today())));
  route('POST', '/api/rh/afd', ({ ctx, body }) => rh.importarAfd(ctx, body.texto));
  route('POST', '/api/rh/ponto/bater', ({ ctx, body }) => rh.baterPonto(ctx, body));
  route('GET', '/api/rh/ferias', ({ ctx, query }) => { rhGuard(ctx); return { situacao: rh.situacaoFerias(ctx), conflitos: rh.conflitosFerias(ctx, query.ano || today().slice(0, 4)) }; });
  route('GET', '/api/rh/decimo', ({ ctx, query }) => { rhGuard(ctx); return rh.decimoTerceiro(ctx, Number(query.ano) || Number(today().slice(0, 4))); });
  route('GET', '/api/rh/comissoes', ({ ctx, query }) => { auth.requireRead(ctx.user, 'vendas_grid'); return rh.comissoes(ctx, query.competencia || competencia(today())); });
  route('GET', '/api/rh/epi', ({ ctx }) => { rhGuard(ctx); return rh.fichasEpi(ctx); });
  route('GET', '/api/rh/timeline/:fid', ({ ctx, params }) => { rhGuard(ctx); return rh.linhaDoTempo(ctx, params.fid); });
  route('GET', '/api/rh/escalas', ({ ctx, query }) => {
    auth.requireRead(ctx.user, 'escalas');
    const de = query.de || today(), ate = query.ate || addDays(de, 13);
    const pf = ctx.postoId ? 'AND e.posto_id = ?' : '';
    const self = auth.selfOnly(ctx.user, 'escalas') ? `AND e.funcionario_id = ${Number(ctx.user.funcionario_id || -1)}` : '';
    const rows = db.prepare(`SELECT e.*, f.nome FROM escalas e JOIN funcionarios f ON f.id = e.funcionario_id WHERE e.data BETWEEN ? AND ? ${pf} ${self} ORDER BY f.nome, e.data`)
      .all(de, ate, ...(ctx.postoId ? [ctx.postoId] : []));
    return { de, ate, rows, conflitos: self ? [] : rh.conflitosEscala(ctx, de, ate) };
  });
  route('POST', '/api/rh/escalas', ({ ctx, body }) => {
    auth.requireWrite(ctx.user, 'escalas');
    const { funcionario_id, data, turno, gnv } = body;
    const ex = db.prepare('SELECT id FROM escalas WHERE funcionario_id = ? AND data = ?').get(funcionario_id, data);
    if (ex) return turno ? crud.update(ctx, 'escalas', ex.id, { turno, gnv: gnv ? 1 : 0 }) : crud.remove(ctx, 'escalas', ex.id);
    if (!turno) return { ok: true };
    return crud.create(ctx, 'escalas', { funcionario_id, data, turno, gnv: gnv ? 1 : 0 });
  });
  route('GET', '/api/rh/fechamento', ({ ctx, query }) => { rhGuard(ctx); return rh.fechamentoDp(ctx, query.competencia || competencia(addDays(monthStart(today()), -1))); });

  route('PUT', '/api/fechamentos/:id/itens', ({ ctx, params, body }) => {
    auth.requireWrite(ctx.user, 'fechamentos');
    return crud.update(ctx, 'fechamentos', params.id, { itens: body.itens });
  });
  route('POST', '/api/fechamentos/:id/liberar', ({ ctx, params }) => contabil.liberar(ctx, params.id));

  // ---------------------------------------------------------------- Financeiro
  const finGuard = (ctx) => auth.requireModule(ctx.user, 'financeiro');
  route('GET', '/api/fin/indicadores', ({ ctx, query }) => { finGuard(ctx); return fin.indicadores(ctx, query.de || monthStart(today()), query.ate || today()); });
  route('GET', '/api/fin/inadimplencia', ({ ctx }) => { finGuard(ctx); return fin.inadimplencia(ctx); });
  route('GET', '/api/fin/cartoes', ({ ctx, query }) => { finGuard(ctx); return fin.conciliacaoCartoes(ctx, query.de || addDays(today(), -30), query.ate || today()); });
  route('POST', '/api/fin/ofx', ({ ctx, body }) => fin.importarOfx(ctx, Number(body.conta_bancaria_id), body.texto));
  route('POST', '/api/fin/conciliar', ({ ctx }) => { auth.requireWrite(ctx.user, 'extrato'); return fin.conciliarAutomatico(ctx); });
  route('POST', '/api/fin/conciliar/:id', ({ ctx, params, body }) => fin.conciliarManual(ctx, params.id, body.tipo, body.ref_id));
  route('GET', '/api/fin/saldo', ({ ctx }) => { finGuard(ctx); return fin.saldoBancario(ctx); });
  route('GET', '/api/fin/caixa-banco', ({ ctx, query }) => { finGuard(ctx); return fin.conciliacaoCaixaBanco(ctx, query.de || addDays(today(), -14), query.ate || today()); });
  route('GET', '/api/fin/fluxo', ({ ctx, query }) => { finGuard(ctx); return fin.fluxoCaixa(ctx, Number(query.dias) || 30); });
  route('GET', '/api/fin/dre', ({ ctx, query }) => { finGuard(ctx); return fin.dre(ctx, query.competencia || competencia(today())); });
  route('GET', '/api/fin/juros', ({ ctx, query }) => { finGuard(ctx); return fin.jurosPagos(ctx, query.de || monthStart(today()), query.ate || today()); });
  route('POST', '/api/fin/vendas/import', ({ ctx, body }) => fin.importarVendasCsv(ctx, body.texto));

  // ---------------------------------------------------------------- Conveniência
  const convGuard = (ctx) => auth.requireModule(ctx.user, 'conveniencia');
  route('GET', '/api/conv/vendas', ({ ctx, query }) => { convGuard(ctx); return conv.vendas(ctx, query.de || monthStart(today()), query.ate || today()); });
  route('GET', '/api/conv/abc', ({ ctx, query }) => { convGuard(ctx); return conv.curvaAbc(ctx, query.de || addDays(today(), -90), query.ate || today()); });
  route('GET', '/api/conv/parados', ({ ctx }) => { convGuard(ctx); return conv.parados(ctx); });
  route('GET', '/api/conv/precos', ({ ctx }) => { convGuard(ctx); return conv.precificacao(ctx); });
  route('POST', '/api/conv/nfe', ({ ctx, body }) => conv.importarNfe(ctx, body.xml));
  route('POST', '/api/conv/notas/:id/conferir', ({ ctx, params, body }) => conv.conferirNota(ctx, params.id, body));
  route('POST', '/api/conv/contagem', ({ ctx, body }) => conv.registrarContagem(ctx, body));
  route('GET', '/api/conv/validade', ({ ctx }) => { convGuard(ctx); return conv.validade(ctx); });
  route('GET', '/api/conv/perdas', ({ ctx }) => { convGuard(ctx); return conv.indicePerdas(ctx); });
  route('POST', '/api/conv/precos/:id', ({ ctx, params, body }) => {
    auth.requireWrite(ctx.user, 'produtos');
    return crud.update(ctx, 'produtos', params.id, { preco: body.preco });
  });

  // ---------------------------------------------------------------- Combustíveis
  const combGuard = (ctx) => auth.requireModule(ctx.user, 'combustiveis');
  route('GET', '/api/comb/lmc', ({ ctx, query, res }) => {
    combGuard(ctx);
    if (query.format === 'csv') return sendFile(res, comb.lmcCsv(ctx, query.de || today(), query.ate || today()), 'text/csv; charset=utf-8', `LMC-${query.de}-${query.ate}.csv`);
    if (query.de) return comb.lmcPeriodo(ctx, query.de, query.ate || query.de);
    return comb.lmc(ctx, query.data || today());
  });
  route('POST', '/api/comb/lmc/fechar', ({ ctx, body }) => comb.fecharLmc(ctx, body.data || today()));
  route('GET', '/api/comb/tanques', ({ ctx }) => { combGuard(ctx); return comb.estoqueTanques(ctx); });
  route('GET', '/api/comb/gnv', ({ ctx, query }) => { combGuard(ctx); return comb.gnv(ctx, query.de || monthStart(today()), query.ate || today()); });

  // ---------------------------------------------------------------- Preços
  const precoGuard = (ctx) => auth.requireModule(ctx.user, 'precos');
  route('GET', '/api/precos/painel', ({ ctx }) => { precoGuard(ctx); return precos.painel(ctx); });
  route('GET', '/api/precos/simular', ({ ctx, query }) => { precoGuard(ctx); return precos.simular(ctx, query.combustivel_id, query.preco); });
  route('POST', '/api/precos/alterar', ({ ctx, body }) => precos.alterarPreco(ctx, body));
  route('GET', '/api/precos/evolucao/:id', ({ ctx, params, query }) => { precoGuard(ctx); return precos.evolucao(ctx, params.id, Number(query.dias) || 60); });
  route('GET', '/api/precos/custos', ({ ctx }) => { precoGuard(ctx); return precos.custosCompra(ctx); });

  // ---------------------------------------------------------------- Documentos
  route('GET', '/api/docs/fiscalizacao', ({ ctx }) => docs.pastaFiscalizacao(ctx));

  // ---------------------------------------------------------------- Agenda
  route('GET', '/api/agenda', ({ ctx, query }) => {
    auth.requireModule(ctx.user, 'agenda');
    const de = query.de || today(), ate = query.ate || de;
    core.gerarTarefas(db, de < today() ? de : today(), ate > addDays(today(), 60) ? addDays(today(), 60) : ate);
    const todos = ['gerente', 'proprietario'].includes(ctx.user.perfil) || query.todos === '1';
    const rows = db.prepare(`SELECT t.*, u.nome AS responsavel, c.nome AS concluida_por_nome FROM tarefas t LEFT JOIN usuarios u ON u.id = t.responsavel_id LEFT JOIN usuarios c ON c.id = t.concluida_por
      WHERE t.data_prevista BETWEEN ? AND ? ${ctx.postoId ? 'AND (t.posto_id = ? OR t.posto_id IS NULL)' : ''}
      ${todos ? '' : 'AND (t.perfil = ? OR t.responsavel_id = ? OR t.perfil IS NULL)'} ORDER BY t.data_prevista, t.hora_limite, t.titulo`)
      .all(de, ate, ...(ctx.postoId ? [ctx.postoId] : []), ...(todos ? [] : [ctx.user.perfil, ctx.user.id]));
    return rows.map((t) => ({ ...t, status: core.statusTarefa(t) }));
  });
  route('POST', '/api/tarefas/:id/concluir', ({ ctx, params, body }) => {
    const t = crud.raw(db, 'tarefas', params.id);
    if (!t) throw new HttpError(404, 'Tarefa não encontrada');
    const pode = ['gerente'].includes(ctx.user.perfil) || t.perfil === ctx.user.perfil || t.responsavel_id === ctx.user.id;
    if (!pode) throw new HttpError(403, 'Tarefa de outro responsável');
    return crud.update(ctx, 'tarefas', params.id, { concluida_at: body.desfazer ? null : new Date().toISOString(), obs: body.obs ?? t.obs }, { internal: true });
  });

  // ---------------------------------------------------------------- Autoatendimento
  route('GET', '/api/meu', ({ ctx }) => painel.minhaArea(ctx));
  route('POST', '/api/meu/assinar/:tipo/:id', ({ ctx, params }) => painel.assinarProprio(ctx, params.tipo, params.id));

  // ---------------------------------------------------------------- Contabilidade
  route('GET', '/api/contabil/fechamento', ({ ctx, query }) => {
    auth.requireModule(ctx.user, 'contabil');
    return contabil.fechamentoContabil(ctx, query.competencia || competencia(addDays(monthStart(today()), -1)));
  });
  route('GET', '/api/contabil/pacote', ({ ctx, query, res }) => {
    const comp = query.competencia || competencia(addDays(monthStart(today()), -1));
    const buf = contabil.pacote(ctx, comp, uploadsDir);
    return sendFile(res, buf, 'application/zip', `pacote-contabil-${comp}.zip`);
  });

  // ---------------------------------------------------------------- HTTP
  function sendFile(res, data, type, filename, inline = false) {
    res.writeHead(200, {
      'content-type': type,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'cache-control': 'no-store',
    });
    res.end(data);
    return SENT;
  }
  const SENT = Symbol('sent');

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 25 * 1024 * 1024) throw new HttpError(413, 'Requisição muito grande');
      chunks.push(c);
    }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'JSON inválido'); }
  }

  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC, rel));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('Não encontrado');
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': rel === '/sw.js' || rel === '/index.html' ? 'no-cache' : 'public, max-age=300',
    });
    fs.createReadStream(file).pipe(res);
  }

  async function handler(req, res) {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('x-frame-options', 'SAMEORIGIN');
    res.setHeader('referrer-policy', 'same-origin');
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
    try {
      const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
      if (!r) throw new HttpError(404, 'Rota não encontrada');
      const m = url.pathname.match(r.re);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const query = Object.fromEntries(url.searchParams.entries());
      const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || query.token || '';
      let ctx = null;
      if (!r.public) {
        const user = auth.userFromToken(db, token);
        if (!user) throw new HttpError(401, 'Sessão expirada — entre novamente');
        if (user.trocar_senha && !['/api/meta', '/api/me', '/api/me/senha', '/api/logout'].includes(url.pathname)) {
          throw new HttpError(403, 'Crie a sua senha pessoal antes de continuar');
        }
        let postoId = user.posto_id || null;
        const hdr = req.headers['x-posto'] || query.posto;
        if (!postoId && hdr && hdr !== 'all') postoId = Number(hdr) || null;
        ctx = { db, user, postoId, defaultPostoId: defaultPostoId() };
      }
      const out = await r.handler({ ctx, params, query, body, req, res, token });
      if (out === SENT) return;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(out ?? { ok: true }));
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: status === 500 ? `Erro interno: ${e.message}` : e.message }));
    }
  }

  return { handler, server: () => http.createServer(handler), uploadsDir };
}

// ---------------------------------------------------------------- Rotinas agendadas
async function rotinasDiarias(db, dataDir) {
  const log = [];
  log.push(`tarefas geradas: ${core.gerarTarefas(db)}`);
  const sys = { db, user: db.prepare("SELECT * FROM usuarios WHERE perfil = 'gerente' AND ativo = 1 ORDER BY id LIMIT 1").get() || null, postoId: null };
  for (const c of db.prepare('SELECT id FROM clientes').all()) fin.atualizarBloqueio(sys, c.id);
  log.push(`avisos enviados: ${await alertas.enviarAvisosDiarios(db)}`);
  // backup diário automático (mantém 30 dias)
  if (dataDir) {
    const dir = path.join(dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `posto-${today()}.db`);
    if (!fs.existsSync(file)) {
      db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
      log.push(`backup: ${file}`);
    }
    const antigos = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort().slice(0, -30);
    for (const f of antigos) fs.unlinkSync(path.join(dir, f));
  }
  return log;
}

module.exports = { createApp, rotinasDiarias };
