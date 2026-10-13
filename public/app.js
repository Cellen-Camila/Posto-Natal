// Shell da aplicação: login, menu por perfil, seletor de posto, roteamento e modo offline.
import {
  state, html, raw, mount, $, $$, api, get, post, toast, handleErr, modal, safeSet, outbox, syncOutbox, canRead, isRole, esc,
} from './lib.js';

// Menu: cada item aparece se o usuário puder ler o recurso (res) ou tiver o módulo (mod)
const NAV = [
  { label: 'Painel do gerente', href: '#/painel', mod: 'painel', single: true },
  { label: 'Minha área', href: '#/meu', mod: 'meu', single: true },
  { label: 'Agenda e checklists', href: '#/agenda', mod: 'agenda', single: true },
  { label: 'Pista', items: [
    { label: 'Turno atual', href: '#/pista', res: 'turnos' },
    { label: 'Turnos', href: '#/r/turnos', res: 'turnos' },
    { label: 'Faltas de caixa', href: '#/pista/faltas', res: 'faltas_caixa' },
    { label: 'Fechamentos de caixa', href: '#/r/caixas', res: 'caixas' },
    { label: 'Ocorrências', href: '#/r/ocorrencias', res: 'ocorrencias' },
    { label: 'Sangrias e trocos', href: '#/r/sangrias', res: 'sangrias' },
  ] },
  { label: 'RH / DP', items: [
    { label: 'Funcionários', href: '#/r/funcionarios', res: 'funcionarios', mod: 'rh' },
    { label: 'Ponto e banco de horas', href: '#/rh/ponto', res: 'ponto', mod: 'rh' },
    { label: 'Escalas', href: '#/rh/escalas', res: 'escalas', mod: 'rh' },
    { label: 'Férias e 13º', href: '#/rh/ferias', mod: 'rh' },
    { label: 'Atestados', href: '#/r/atestados', res: 'atestados' },
    { label: 'ASOs (PCMSO)', href: '#/r/asos', res: 'asos' },
    { label: 'Treinamentos (NR-20…)', href: '#/r/treinamentos', res: 'treinamentos', mod: 'rh' },
    { label: 'Uniformes e EPI', href: '#/rh/epi', mod: 'rh' },
    { label: 'Comissão do grid', href: '#/rh/comissoes', res: 'vendas_grid', mod: 'rh' },
    { label: 'Advertências', href: '#/r/advertencias', res: 'advertencias', mod: 'rh' },
    { label: 'Comunicados', href: '#/r/comunicados', res: 'comunicados', mod: 'rh' },
    { label: 'Trocas de folga', href: '#/r/trocas_folga', res: 'trocas_folga', mod: 'rh' },
    { label: 'eSocial — SST', href: '#/r/esocial_sst', res: 'esocial_sst', mod: 'rh' },
    { label: 'Fechamento do DP', href: '#/rh/fechamento', mod: 'rh' },
  ] },
  { label: 'Financeiro', items: [
    { label: 'Vendas e indicadores', href: '#/financeiro', mod: 'financeiro' },
    { label: 'Contas a pagar', href: '#/r/contas_pagar', res: 'contas_pagar' },
    { label: 'Contas a receber', href: '#/r/contas_receber', res: 'contas_receber' },
    { label: 'Inadimplência', href: '#/financeiro/inadimplencia', mod: 'financeiro' },
    { label: 'Conciliação bancária', href: '#/financeiro/conciliacao', mod: 'financeiro' },
    { label: 'Conciliação de cartões', href: '#/financeiro/cartoes', mod: 'financeiro' },
    { label: 'Fluxo de caixa', href: '#/financeiro/fluxo', mod: 'financeiro' },
    { label: 'DRE gerencial', href: '#/financeiro/dre', mod: 'financeiro' },
    { label: 'Clientes a prazo/frota', href: '#/r/clientes', res: 'clientes', mod: 'financeiro' },
    { label: 'Importar vendas (Linx)', href: '#/financeiro/importar', mod: 'financeiro' },
    { label: 'Taxas de cartão', href: '#/r/taxas_cartao', res: 'taxas_cartao' },
    { label: 'Plano de contas', href: '#/r/plano_contas', res: 'plano_contas', mod: 'financeiro' },
  ] },
  { label: 'Conveniência', items: [
    { label: 'Vendas e margem', href: '#/conveniencia', mod: 'conveniencia' },
    { label: 'Curva ABC e parados', href: '#/conveniencia/abc', mod: 'conveniencia' },
    { label: 'Entrada de notas', href: '#/conveniencia/notas', res: 'notas_entrada', mod: 'conveniencia' },
    { label: 'Contagem de estoque', href: '#/conveniencia/contagem', res: 'contagens', mod: 'conveniencia' },
    { label: 'Precificação', href: '#/conveniencia/precos', mod: 'conveniencia' },
    { label: 'Avarias e perdas', href: '#/r/perdas', res: 'perdas' },
    { label: 'Validade', href: '#/r/lotes_validade', res: 'lotes_validade' },
    { label: 'Temperaturas', href: '#/r/temperaturas', res: 'temperaturas' },
    { label: 'Produtos', href: '#/r/produtos', res: 'produtos', mod: 'conveniencia' },
    { label: 'Categorias', href: '#/r/categorias_conv', res: 'categorias_conv' },
  ] },
  { label: 'Combustíveis', items: [
    { label: 'LMC', href: '#/combustiveis/lmc', mod: 'combustiveis' },
    { label: 'Tanques e pedidos', href: '#/combustiveis/tanques', mod: 'combustiveis' },
    { label: 'Descargas e qualidade', href: '#/r/descargas', res: 'descargas' },
    { label: 'Medições de tanque', href: '#/r/medicoes_tanque', res: 'medicoes_tanque' },
    { label: 'Equipamentos e meio ambiente', href: '#/r/equipamentos', res: 'equipamentos' },
    { label: 'GNV', href: '#/combustiveis/gnv', mod: 'combustiveis' },
    { label: 'Combustíveis', href: '#/r/combustiveis', res: 'combustiveis', mod: 'combustiveis' },
    { label: 'Tanques (cadastro)', href: '#/r/tanques', res: 'tanques' },
    { label: 'Bicos e bombas', href: '#/r/bicos', res: 'bicos' },
  ] },
  { label: 'Preços e margem', items: [
    { label: 'Painel e simulador', href: '#/precos', mod: 'precos' },
    { label: 'Pesquisas de preço', href: '#/r/pesquisas_preco', res: 'pesquisas_preco' },
    { label: 'Concorrentes', href: '#/r/concorrentes', res: 'concorrentes' },
    { label: 'Preço médio ANP', href: '#/r/precos_anp', res: 'precos_anp' },
    { label: 'Histórico de alterações', href: '#/r/historico_precos', res: 'historico_precos' },
  ] },
  { label: 'Documentos e licenças', items: [
    { label: 'Documentos e alvarás', href: '#/documentos', res: 'documentos' },
    { label: 'Pasta de fiscalização', href: '#/documentos/fiscalizacao', res: 'documentos' },
  ] },
  { label: 'Contabilidade', items: [
    { label: 'Pacote mensal', href: '#/contabil', mod: 'contabil' },
  ] },
  { label: 'Administração', items: [
    { label: 'Aprovações', href: '#/aprovacoes', res: 'aprovacoes' },
    { label: 'Obrigações recorrentes', href: '#/r/tarefas_modelo', res: 'tarefas_modelo', mod: 'admin' },
    { label: 'Usuários', href: '#/r/usuarios', res: 'usuarios', mod: 'admin' },
    { label: 'Parâmetros', href: '#/r/parametros', res: 'parametros' },
    { label: 'Fornecedores', href: '#/r/fornecedores', res: 'fornecedores' },
    { label: 'Postos', href: '#/r/postos', res: 'postos', mod: 'admin' },
    { label: 'Trilha de auditoria', href: '#/r/auditoria', res: 'auditoria' },
    { label: 'Envios de alertas', href: '#/r/notificacoes', res: 'notificacoes' },
  ] },
];

function visible(item) {
  const mods = state.meta.modules;
  if (item.res && item.mod) return canRead(item.res) && !!mods[item.mod];
  if (item.res) return canRead(item.res);
  if (item.mod) return !!mods[item.mod];
  return true;
}

// Rotas: [regex, módulo, função]
const ROUTES = [
  [/^\/painel$/, 'painel', 'painel'],
  [/^\/meu$/, 'meu', 'meu'],
  [/^\/agenda$/, 'agenda', 'agenda'],
  [/^\/aprovacoes$/, 'agenda', 'aprovacoes'],
  [/^\/r\/(\w+)$/, 'crud', 'listPage'],
  [/^\/r\/(\w+)\/(\d+)$/, 'crud', 'listPage'],
  [/^\/pista$/, 'pista', 'turnoAtual'],
  [/^\/pista\/turno\/(\d+)$/, 'pista', 'turno'],
  [/^\/pista\/faltas$/, 'pista', 'faltas'],
  [/^\/rh\/ponto$/, 'rh', 'ponto'],
  [/^\/rh\/ponto\/(\d+)$/, 'rh', 'espelho'],
  [/^\/rh\/escalas$/, 'rh', 'escalas'],
  [/^\/rh\/ferias$/, 'rh', 'ferias'],
  [/^\/rh\/epi$/, 'rh', 'epi'],
  [/^\/rh\/comissoes$/, 'rh', 'comissoes'],
  [/^\/rh\/fechamento$/, 'rh', 'fechamento'],
  [/^\/rh\/funcionario\/(\d+)$/, 'rh', 'funcionario'],
  [/^\/financeiro$/, 'financeiro', 'indicadores'],
  [/^\/financeiro\/inadimplencia$/, 'financeiro', 'inadimplencia'],
  [/^\/financeiro\/conciliacao$/, 'financeiro', 'conciliacao'],
  [/^\/financeiro\/cartoes$/, 'financeiro', 'cartoes'],
  [/^\/financeiro\/fluxo$/, 'financeiro', 'fluxo'],
  [/^\/financeiro\/dre$/, 'financeiro', 'dre'],
  [/^\/financeiro\/importar$/, 'financeiro', 'importar'],
  [/^\/conveniencia$/, 'conveniencia', 'visao'],
  [/^\/conveniencia\/abc$/, 'conveniencia', 'abc'],
  [/^\/conveniencia\/notas$/, 'conveniencia', 'notas'],
  [/^\/conveniencia\/notas\/(\d+)$/, 'conveniencia', 'conferencia'],
  [/^\/conveniencia\/contagem$/, 'conveniencia', 'contagem'],
  [/^\/conveniencia\/precos$/, 'conveniencia', 'precos'],
  [/^\/combustiveis\/lmc$/, 'combustiveis', 'lmc'],
  [/^\/combustiveis\/tanques$/, 'combustiveis', 'tanques'],
  [/^\/combustiveis\/gnv$/, 'combustiveis', 'gnv'],
  [/^\/precos$/, 'precos', 'painel'],
  [/^\/documentos$/, 'documentos', 'lista'],
  [/^\/documentos\/fiscalizacao$/, 'documentos', 'fiscalizacao'],
  [/^\/contabil$/, 'contabil', 'pacote'],
];

export function setTitle(t) {
  const el = $('#page-title');
  if (el) el.textContent = t;
  document.title = `${t} · Gestão do Posto`;
}

async function loadMeta() {
  state.meta = await get('/api/meta');
  const postos = state.meta.postos;
  if (state.meta.user.posto_id) state.posto = String(state.meta.user.posto_id);
  else if (postos.length === 1) state.posto = String(postos[0].id);
  else if (state.posto !== 'all' && !postos.some((p) => String(p.id) === state.posto)) state.posto = 'all';
}

function homeFor() {
  const m = state.meta.modules;
  if (m.painel) return '#/painel';
  if (m.meu && isRole('frentista')) return '#/meu';
  if (isRole('chefe_pista')) return '#/pista';
  if (isRole('contabilidade')) return '#/contabil';
  return '#/agenda';
}

async function renderLogin() {
  let info = { demo: false, posto: '' };
  try { info = await get('/api/info'); } catch { /* sem conexão */ }
  mount($('#root'), html`<div class="login"><div class="card">
    <div class="row"><img src="/icon.svg" width="40" height="40" alt=""><div><h1>Gestão do Posto</h1><small>${info.posto || 'Pista, RH, financeiro, conveniência, combustíveis e documentos'}</small></div></div>
    <form id="login-form">
      <label class="field">Usuário<input name="login" autocomplete="username" required autofocus></label>
      <label class="field">Senha<input name="senha" type="password" autocomplete="current-password" required></label>
      <button class="btn btn-primary btn-lg" type="submit">Entrar</button>
    </form>
    ${info.demo ? html`<div class="demo-users">Demonstração (senha <code>posto123</code>): <code>gerente</code>, <code>dono</code>, <code>chefe</code>, <code>joao</code> (frentista),
      <code>financeiro</code>, <code>rh</code>, <code>conveniencia</code>, <code>contador</code>.</div>` : html`<div class="demo-users">Esqueceu a senha? Peça ao gerente para definir uma nova em Administração → Usuários.</div>`}
  </div></div>`);
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const r = await post('/api/login', { login: fd.get('login'), senha: fd.get('senha') });
      state.token = r.token;
      safeSet('token', r.token);
      await boot(true);
    } catch (err) { handleErr(err); }
  });
}

function renderShell() {
  const u = state.meta.user;
  const roleLabel = state.meta.roles[u.perfil];
  const postos = state.meta.postos;
  const groups = NAV.map((g) => (g.single ? (visible(g) ? g : null) : { ...g, items: g.items.filter(visible) })).filter((g) => g && (g.single || g.items.length));
  mount($('#root'), html`<div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><img src="/icon.svg" alt=""><div>Gestão do Posto<small>${postos.find((p) => String(p.id) === state.posto)?.nome || (postos.length > 1 ? 'Rede — visão consolidada' : postos[0]?.nome || '')}</small></div></div>
      <nav>${groups.map((g) => (g.single
        ? html`<a class="nav-single" href="${g.href}">${g.label}</a>`
        : html`<div class="nav-group" data-group="${g.label}"><button type="button">${g.label}<span class="chev">›</span></button>
          <div class="nav-links">${g.items.map((i) => html`<a href="${i.href}">${i.label}</a>`)}</div></div>`))}</nav>
    </aside>
    <div class="main">
      <header class="topbar">
        <button class="icon-btn menu-btn" id="menu-btn" aria-label="Menu">☰</button>
        <div class="title" id="page-title"></div>
        ${postos.length > 1 && !u.posto_id ? html`<select id="posto-sel" title="Posto"><option value="all">Todos os postos</option>${postos.map((p) => html`<option value="${p.id}" ${raw(String(p.id) === state.posto ? 'selected' : '')}>${p.nome}</option>`)}</select>` : ''}
        ${isRole('contabilidade', 'frentista') ? '' : html`<a class="icon-btn" href="#/agenda" title="Alertas e tarefas" id="bell">🔔<span class="dot hide" id="bell-dot"></span></a>`}
        <button class="btn btn-ghost btn-sm" id="user-btn" title="${roleLabel}">${u.nome.split(' ')[0]} · <span class="hide-sm">${roleLabel}</span> ▾</button>
      </header>
      <div class="offline-bar hide" id="offline-bar"></div>
      <main class="content" id="view"></main>
    </div>
  </div>`);
  $$('.nav-group > button').forEach((b) => b.addEventListener('click', () => b.parentElement.classList.toggle('open')));
  $('#menu-btn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#posto-sel')?.addEventListener('change', (e) => { state.posto = e.target.value; safeSet('posto', state.posto); boot(); });
  $('#user-btn').addEventListener('click', userMenu);
  updateOffline();
  refreshBell();
}

// Primeiro acesso (ou senha definida pelo gerente): a pessoa cria a própria senha antes de usar
function trocaObrigatoria() {
  const m = modal({
    title: 'Crie a sua senha', size: 'sm',
    body: html`<p>Por segurança, troque a senha provisória antes de começar. Use pelo menos 8 caracteres e não compartilhe com ninguém.</p>
      <form id="pwd1" class="form-grid" style="grid-template-columns:1fr">
        <label>Senha provisória<input type="password" name="atual" required autocomplete="current-password"></label>
        <label>Nova senha<input type="password" name="nova" minlength="8" required autocomplete="new-password"></label>
        <label>Repita a nova senha<input type="password" name="nova2" minlength="8" required autocomplete="new-password"></label>
        <button class="btn btn-primary" type="submit">Salvar e continuar</button>
      </form>`,
  });
  m.el.classList.add('obrigatorio');
  $$('[data-close]', m.el).forEach((b) => b.remove());
  m.el.addEventListener('mousedown', (e) => e.stopPropagation(), true);
  $('#pwd1', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get('nova') !== fd.get('nova2')) { toast('As duas senhas novas não são iguais', 'err'); return; }
    try {
      await post('/api/me/senha', { atual: fd.get('atual'), nova: fd.get('nova') });
      state.meta.user.trocar_senha = 0;
      m.el.remove();
      toast('Senha criada. Bem-vindo!', 'ok');
      route();
      refreshBell();
    } catch (err) { handleErr(err); }
  });
}

function userMenu() {
  const m = modal({
    title: state.meta.user.nome, size: 'sm',
    body: html`<p class="muted">${state.meta.roles[state.meta.user.perfil]}</p>
      <form id="pwd" class="form-grid" style="grid-template-columns:1fr">
        <label>Senha atual<input type="password" name="atual" required></label>
        <label>Nova senha (mín. 8)<input type="password" name="nova" minlength="8" required></label>
        <button class="btn" type="submit">Trocar senha</button>
      </form>
      <div class="row mt"><span class="muted">Tema:</span>
        <button class="btn btn-sm" data-theme-set="">Automático</button><button class="btn btn-sm" data-theme-set="light">Claro</button><button class="btn btn-sm" data-theme-set="dark">Escuro</button></div>`,
    foot: html`<button class="btn btn-danger" id="logout">Sair</button>`,
  });
  $('#pwd', m.el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try { await post('/api/me/senha', { atual: fd.get('atual'), nova: fd.get('nova') }); toast('Senha alterada', 'ok'); m.close(); } catch (err) { handleErr(err); }
  });
  $$('[data-theme-set]', m.el).forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.themeSet;
    if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
    safeSet('theme', t || null);
  }));
  $('#logout', m.el).addEventListener('click', async () => {
    try { await post('/api/logout'); } catch { /* ignora */ }
    state.token = null; safeSet('token', null); m.close(); location.hash = '#/login'; renderLogin();
  });
}

async function refreshBell() {
  const dot = $('#bell-dot');
  if (!dot) return;
  try {
    const al = await get('/api/alertas');
    const n = al.filter((a) => a.nivel === 'vermelho').length;
    dot.textContent = n;
    dot.classList.toggle('hide', !n);
  } catch { /* offline */ }
}

function updateOffline() {
  const bar = $('#offline-bar');
  if (!bar) return;
  const n = outbox().length;
  const msgs = [];
  if (!navigator.onLine) msgs.push('Você está sem internet. Os registros da pista ficam guardados no aparelho.');
  if (n) msgs.push(`${n} registro(s) aguardando sincronização.`);
  bar.textContent = msgs.join(' ');
  bar.classList.toggle('hide', !msgs.length);
}

function highlightNav(hash) {
  $$('.nav-links a, .nav-single').forEach((a) => {
    const active = hash === a.getAttribute('href') || (hash.startsWith(a.getAttribute('href') + '/') && a.getAttribute('href') !== '#/r');
    a.classList.toggle('active', active);
    if (active) a.closest('.nav-group')?.classList.add('open');
  });
}

let routeSeq = 0;
async function route() {
  if (!state.meta) return;
  let hash = location.hash || homeFor();
  if (hash === '#/login' || hash === '#/' || hash === '#') hash = homeFor();
  const [path, qs] = hash.slice(1).split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const view = $('#view');
  if (!view) return;
  $('#sidebar')?.classList.remove('open');
  document.querySelectorAll('.modal-bg:not(.obrigatorio)').forEach((m) => m.remove());
  highlightNav('#' + path);
  const r = ROUTES.find(([re]) => re.test(path));
  if (!r) { mount(view, html`<div class="empty">Página não encontrada.</div>`); return; }
  const params = path.match(r[0]).slice(1);
  const seq = ++routeSeq;
  mount(view, html`<div class="empty">Carregando…</div>`);
  try {
    const mod = await import(`./pages/${r[1]}.js`);
    if (seq !== routeSeq) return;
    await mod[r[2]](view, params, query);
  } catch (e) {
    if (seq !== routeSeq) return;
    mount(view, html`<div class="card"><h2>Não foi possível abrir esta tela</h2><p class="muted">${e.message}</p></div>`);
  }
}

export function navigate(hash) {
  if (location.hash === hash) route(); else location.hash = hash;
}
export const reload = () => route();

async function boot(fromLogin = false) {
  const t = safeGetTheme();
  if (t) document.documentElement.dataset.theme = t;
  if (!state.token) { renderLogin(); return; }
  try {
    await loadMeta();
  } catch (e) {
    if (!state.token) { renderLogin(); return; }
    mount($('#root'), html`<div class="login"><div class="card"><h2>Sem conexão</h2><p class="muted">${e.message}</p><button class="btn" onclick="location.reload()">Tentar novamente</button></div></div>`);
    return;
  }
  renderShell();
  if (fromLogin || !location.hash || location.hash === '#/login') location.hash = homeFor();
  await route();
  if (state.meta.user.trocar_senha) trocaObrigatoria();
  syncOutbox().then(updateOffline);
}
function safeGetTheme() { try { return localStorage.getItem('theme'); } catch { return null; } }

window.addEventListener('hashchange', route);
window.addEventListener('online', () => { updateOffline(); syncOutbox().then(updateOffline); });
window.addEventListener('offline', updateOffline);
window.addEventListener('outbox', updateOffline);
setInterval(refreshBell, 5 * 60 * 1000);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot();

export { esc, api };
