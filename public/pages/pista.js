// Módulo Pista: o chefe de pista conduz o turno pelo celular.
import {
  html, raw, mount, $, $$, get, post, toast, handleErr, fmt, badge, card, table, kpi, refOptions, canWrite, safeGet, safeSet,
  today, competencia, compSelect, modal, confirmDialog,
} from '../lib.js';
import { setTitle, navigate, reload } from '../app.js';
import { openRecord, assinaturaFrentista } from './crud.js';

const PER = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite' };
const nowHm = () => new Date().toTimeString().slice(0, 5);
const periodoAgora = () => { const h = new Date().getHours(); return h >= 6 && h < 14 ? 'manha' : h >= 14 && h < 22 ? 'tarde' : 'noite'; };

async function cached(key, loader) {
  try {
    const d = await loader();
    safeSet(key, JSON.stringify(d));
    return d;
  } catch (e) {
    const c = safeGet(key);
    if (c) { toast('Sem conexão: exibindo os últimos dados salvos no aparelho.'); return JSON.parse(c); }
    throw e;
  }
}

export async function turnoAtual(view, _p, query) {
  setTitle('Turno atual');
  const periodo = query.periodo || periodoAgora();
  const data = query.data || today();
  const prep = await cached('pista_preparo', () => get(`/api/pista/abertura?data=${data}&periodo=${periodo}`));
  if (prep.turno_aberto && !query.novo) { navigate(`#/pista/turno/${prep.turno_aberto}`); return; }
  const funcs = await refOptions('funcionarios');
  const writable = canWrite('turnos');
  mount(view, html`
    <div class="page-head"><div><h1>Abertura de turno</h1><div class="sub">Presença da equipe, encerrantes, medição dos tanques e checklist da pista</div></div>
      <a class="btn" href="#/r/turnos">Turnos anteriores</a></div>
    ${prep.turno_aberto ? html`<div class="card mb">⚠ Já existe um turno aberto. <a href="#/pista/turno/${prep.turno_aberto}">Ir para o turno aberto</a></div>` : ''}
    <form id="abrir">
      <div class="card mb"><div class="form-grid">
        <label>Data<input type="date" name="data" value="${data}" required></label>
        <label>Turno<select name="periodo">${Object.entries(PER).map(([k, l]) => html`<option value="${k}" ${raw(k === periodo ? 'selected' : '')}>${l}</option>`)}</select></label>
      </div></div>
      <div class="grid g2">
        ${card(`Presença da equipe escalada (${prep.escalados.length})`, prep.escalados.length ? html`<div class="check-list">${prep.escalados.map((e) => html`
          <label><input type="checkbox" name="pres" value="${e.funcionario_id}" checked><span style="flex:1">${e.nome}<br><small class="muted">${e.funcao}</small></span>
          <select data-sub="${e.funcionario_id}" title="Substituto"><option value="">substituto…</option>${funcs.map((f) => html`<option value="${f.id}">${f.label}</option>`)}</select></label>`)}</div>`
          : html`<div class="empty">Ninguém escalado para este turno. <a href="#/rh/escalas">Ver escalas</a></div>`)}
        ${card('Checklist da pista', html`<div class="check-list">${prep.checklist.map((c, i) => html`<label><input type="checkbox" name="chk" value="${i}"> ${c}</label>`)}</div>`)}
        ${card('Encerrantes iniciais', table([
          { label: 'Bico', get: (b) => html`<b>${b.nome}</b><br><small class="muted">${b.combustivel}</small>` },
          { label: 'Encerrante inicial', get: (b) => html`<input type="number" step="0.01" inputmode="decimal" name="enc_${b.id}" value="${b.encerrante_atual ?? ''}" required style="width:140px">` },
        ], prep.bicos))}
        ${card('Medição dos tanques (abertura)', table([
          { label: 'Tanque', get: (t) => html`<b>${t.nome}</b><br><small class="muted">capacidade ${fmt.num(t.capacidade)} L</small>` },
          { label: 'Régua (cm)', get: (t) => html`<input type="number" step="0.1" name="regua_${t.id}" style="width:90px">` },
          { label: 'Volume (L)', get: (t) => html`<input type="number" step="1" name="med_${t.id}" style="width:110px">` },
        ], prep.tanques))}
      </div>
      ${writable ? html`<div class="row mt"><button class="btn btn-primary btn-lg" type="submit">Abrir turno</button></div>` : ''}
    </form>`);

  const form = $('#abrir', view);
  $$('[name=data],[name=periodo]', form).forEach((el) => el.addEventListener('change', () => navigate(`#/pista?data=${form.data.value}&periodo=${form.periodo.value}&novo=1`)));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const chk = $$('[name=chk]', form);
    const faltando = chk.filter((c) => !c.checked).length;
    if (faltando && !(await confirmDialog(`${faltando} item(ns) do checklist não marcados. Abrir o turno mesmo assim? Registre uma ocorrência para cada problema.`))) return;
    const presentes = new Set($$('[name=pres]:checked', form).map((c) => Number(c.value)));
    const body = {
      data: form.data.value, periodo: form.periodo.value,
      presencas: prep.escalados.map((e) => ({ funcionario_id: e.funcionario_id, presente: presentes.has(e.funcionario_id), substituto_id: Number($(`[data-sub="${e.funcionario_id}"]`, form).value) || null })),
      checklist: { itens: Object.fromEntries(chk.map((c) => [c.value, c.checked])) },
      encerrantes: prep.bicos.map((b) => ({ bico_id: b.id, inicial: Number(form[`enc_${b.id}`].value) })),
      medicoes: prep.tanques.map((t) => ({ tanque_id: t.id, regua_cm: form[`regua_${t.id}`].value || null, volume: form[`med_${t.id}`].value })),
    };
    try {
      const r = await post('/api/pista/turnos', body, { offline: true, label: 'Abertura de turno' });
      if (r.queued) return;
      toast('Turno aberto', 'ok');
      navigate(`#/pista/turno/${r.turno.id}`);
    } catch (err) { handleErr(err); }
  });
}

export async function turno(view, [id]) {
  const d = await cached(`pista_turno_${id}`, () => get(`/api/pista/turnos/${id}`));
  const t = d.turno;
  setTitle(`Turno ${fmt.date(t.data)} — ${PER[t.periodo]}`);
  const aberto = t.status === 'aberto';
  const w = canWrite('turnos') && aberto;
  const funcs = await refOptions('funcionarios');
  const presentes = (t.presencas || []).filter((p) => p.presente).map((p) => p.substituto_id || p.funcionario_id);
  const equipe = funcs.filter((f) => presentes.includes(f.id));
  const opcoesEquipe = (equipe.length ? equipe : funcs).map((f) => html`<option value="${f.id}">${f.label}</option>`);
  const totalCaixas = d.caixas.reduce((a, c) => a + (c.diferenca || 0), 0);
  const chkFech = t.checklist_fechamento?.itens || {};

  mount(view, html`
    <div class="page-head">
      <div><h1>Turno da ${PER[t.periodo].toLowerCase()} — ${fmt.date(t.data)} ${badge(aberto ? 'Aberto' : 'Fechado', aberto ? 'yellow' : 'green')}</h1>
        <div class="sub">Chefe: ${t._labels?.chefe_id || '—'} · aberto ${fmt.dt(t.abertura_at)}${t.fechamento_at ? ' · fechado ' + fmt.dt(t.fechamento_at) : ''}</div></div>
      <div class="row">
        ${canWrite('descargas') ? html`<button class="btn" id="descarga">⛽ Recebimento de combustível</button>` : ''}
        ${canWrite('ocorrencias') ? html`<button class="btn" id="ocorr">⚠ Ocorrência</button>` : ''}
        ${!aberto ? html`<a class="btn" href="#/pista?novo=1">Abrir novo turno</a>` : ''}
      </div>
    </div>
    <div class="kpis">
      ${Object.entries(d.litros_por_combustivel).map(([k, v]) => kpi(k, `${fmt.num(v)} L`, 'pelos encerrantes'))}
      ${kpi('Caixas conferidos', `${d.caixas.length}/${presentes.length}`, html`Diferença total: <b class="${totalCaixas < 0 ? 'down' : ''}">${fmt.brl(totalCaixas)}</b>`, { tone: totalCaixas < -0.009 ? 'red' : '' })}
    </div>
    <form id="fech">
    <div class="grid g2">
      ${card('Encerrantes por bico', table([
        { label: 'Bico', get: (e) => html`<b>${e.bico}</b><br><small class="muted">${e.combustivel}</small>` },
        { label: 'Inicial', num: true, get: (e) => fmt.num(e.inicial, 2) },
        { label: 'Final', num: true, get: (e) => (w ? html`<input type="number" step="0.01" inputmode="decimal" data-enc="${e.id}" data-ini="${e.inicial}" value="${e.final ?? ''}" style="width:130px">` : fmt.num(e.final, 2)) },
        { label: 'Aferição (L)', num: true, get: (e) => (w ? html`<input type="number" step="0.01" data-afe="${e.id}" value="${e.afericao_litros || ''}" style="width:80px">` : fmt.num(e.afericao_litros || 0, 2)) },
        { label: 'Litros', num: true, get: (e) => html`<b data-lit="${e.id}">${e.litros != null ? fmt.num(e.litros, 2) : '—'}</b>` },
      ], d.encerrantes))}

      ${card('Fechamento de caixa por frentista', html`${table([
        { label: 'Frentista', get: (c) => c._labels?.funcionario_id },
        { label: 'Informado', num: true, get: (c) => fmt.brl(c.total_informado) },
        { label: 'Sistema', num: true, get: (c) => fmt.brl(c.sistema_total) },
        { label: 'Diferença', num: true, get: (c) => badge(fmt.brl(c.diferenca), c.diferenca < -0.009 ? 'red' : c.diferenca > 0.009 ? 'yellow' : 'green') },
        { label: 'Assinatura', get: (c) => (c.assinado_at ? html`✔ <small>${fmt.dt(c.assinado_at)}</small>` : canWrite('caixas') ? html`<button type="button" class="btn btn-sm" data-ass="${c.id}">✍ Assinar</button>` : badge('Pendente', 'yellow')) },
      ], d.caixas, { empty: 'Nenhum caixa conferido ainda' })}
      ${canWrite('caixas') ? html`<button type="button" class="btn btn-primary mt" id="novo-caixa">+ Conferir caixa de frentista</button>` : ''}`)}

      ${card('Sangrias e trocos', html`${table([
        { label: 'Hora', get: (s) => s.horario }, { label: 'Tipo', get: (s) => (s.tipo === 'troco' ? 'Troco' : 'Sangria') },
        { label: 'Valor', num: true, get: (s) => fmt.brl(s.valor) }, { label: 'Entregou', get: (s) => s._labels?.entregue_por || '—' }, { label: 'Recebeu', get: (s) => s._labels?.recebido_por || '—' },
      ], d.sangrias, { empty: 'Sem sangrias' })}
      ${w ? html`<div class="row mt" id="sang">
        <select name="s_tipo"><option value="sangria">Sangria</option><option value="troco">Troco</option></select>
        <input type="time" name="s_hora" value="${nowHm()}" style="width:110px">
        <input type="number" step="0.01" name="s_valor" placeholder="Valor" style="width:110px">
        <select name="s_ent"><option value="">entregou…</option>${opcoesEquipe}</select>
        <select name="s_rec"><option value="">recebeu…</option>${funcs.map((f) => html`<option value="${f.id}">${f.label}</option>`)}</select>
        <button type="button" class="btn" id="add-sang">Registrar</button></div>` : ''}`)}

      ${card('Ocorrências do turno', table([
        { label: 'Hora', get: (o) => fmt.dt(o.data) }, { label: 'Tipo', get: (o) => o.tipo }, { label: 'Descrição', get: (o) => o.descricao }, { label: 'Envolvido', get: (o) => o._labels?.funcionario_id || '' },
      ], d.ocorrencias, { empty: 'Sem ocorrências' }))}

      ${d.descargas.length ? card('Descargas neste turno', table([
        { label: 'Produto', get: (x) => x._labels?.combustivel_id }, { label: 'NF', get: (x) => x.nota }, { label: 'Volume', num: true, get: (x) => fmt.num(x.volume_nf) },
        { label: 'Qualidade', get: (x) => (x.status === 'recusada' ? html`${badge('Recusada', 'red')} <small>${x.reprovacoes}</small>` : badge('Aprovada', 'green')) },
      ], d.descargas)) : ''}

      ${card('Fechamento do turno', html`
        <div class="check-list">${d.checklist_fechamento_itens.map((c, i) => html`<label class="${chkFech[i] ? 'done' : ''}"><input type="checkbox" name="fchk" value="${i}" ${raw(chkFech[i] ? 'checked' : '')} ${raw(w ? '' : 'disabled')}> ${c}</label>`)}</div>
        ${w ? html`<h3 class="mt">Medição dos tanques (fechamento)</h3>${table([
          { label: 'Tanque', get: (tq) => tq.nome },
          { label: 'Volume (L)', get: (tq) => html`<input type="number" name="fmed_${tq.id}" style="width:120px">` },
        ], d.tanques)}
        <button class="btn btn-primary btn-lg mt" type="submit">Fechar turno</button>` : html`<p class="muted mt">Medições: ${d.medicoes.map((m) => `${m._labels?.tanque_id} ${m.momento} ${fmt.num(m.volume)} L`).join(' · ') || '—'}</p>`}`)}
    </div></form>`);

  const recalc = () => $$('[data-enc]', view).forEach((inp) => {
    const afe = Number($(`[data-afe="${inp.dataset.enc}"]`, view)?.value || 0);
    const lit = inp.value === '' ? null : Number(inp.value) - Number(inp.dataset.ini) - afe;
    const el = $(`[data-lit="${inp.dataset.enc}"]`, view);
    el.textContent = lit == null ? '—' : fmt.num(lit, 2);
    el.className = lit != null && lit < 0 ? 'down' : '';
  });
  $$('[data-enc],[data-afe]', view).forEach((i) => i.addEventListener('input', recalc));

  $('#descarga', view)?.addEventListener('click', () => openRecord('descargas', null, { turno_id: t.id, data: t.data, hora: nowHm() }, { onSaved: reload }));
  $('#ocorr', view)?.addEventListener('click', () => openRecord('ocorrencias', null, { turno_id: t.id, data: new Date().toISOString().slice(0, 16) }, { onSaved: reload }));
  $$('[data-ass]', view).forEach((b) => b.addEventListener('click', () => assinaturaFrentista('caixas', b.dataset.ass, reload)));
  $('#add-sang', view)?.addEventListener('click', async () => {
    const box = $('#sang', view);
    const g = (n) => $(`[name=${n}]`, box).value;
    if (!g('s_valor')) { toast('Informe o valor', 'err'); return; }
    try {
      await post('/api/r/sangrias', { turno_id: t.id, tipo: g('s_tipo'), horario: g('s_hora'), valor: g('s_valor'), entregue_por: g('s_ent') || null, recebido_por: g('s_rec') || null }, { offline: true, label: 'Sangria' });
      toast('Sangria registrada', 'ok'); reload();
    } catch (e) { handleErr(e); }
  });
  $('#novo-caixa', view)?.addEventListener('click', () => caixaForm(t, d, equipe.length ? equipe : funcs));

  $('#fech', view).addEventListener('submit', async (e) => {
    e.preventDefault();
    const enc = $$('[data-enc]', view).map((i) => ({ id: Number(i.dataset.enc), final: i.value === '' ? null : Number(i.value), afericao_litros: Number($(`[data-afe="${i.dataset.enc}"]`, view)?.value || 0) }));
    if (enc.some((x) => x.final == null)) { toast('Informe o encerrante final de todos os bicos', 'err'); return; }
    const semCaixa = presentes.length - d.caixas.length;
    if (semCaixa > 0 && !(await confirmDialog(`${semCaixa} frentista(s) ainda sem conferência de caixa. Fechar mesmo assim?`))) return;
    const body = {
      encerrantes: enc,
      medicoes: d.tanques.map((tq) => ({ tanque_id: tq.id, volume: $(`[name=fmed_${tq.id}]`, view).value })),
      checklist: { itens: Object.fromEntries($$('[name=fchk]', view).map((c) => [c.value, c.checked])) },
    };
    try {
      const r = await post(`/api/pista/turnos/${t.id}/fechar`, body, { offline: true, label: 'Fechamento de turno' });
      if (r.queued) return;
      toast('Turno fechado', 'ok');
      (r.avisos || []).forEach((a) => toast(a, 'err'));
      reload();
    } catch (err) { handleErr(err); }
  });
}

function caixaForm(t, d, equipe) {
  const m = modal({
    title: 'Conferência de caixa do frentista',
    body: html`<form id="cx" class="form-grid">
      <label class="wide">Frentista<select name="funcionario_id" required><option value=""></option>${equipe.map((f) => html`<option value="${f.id}">${f.label}</option>`)}</select></label>
      ${[['dinheiro', 'Dinheiro'], ['debito', 'Cartão débito'], ['credito', 'Cartão crédito'], ['pix', 'PIX'], ['a_prazo', 'Notas a prazo / frota'], ['vales', 'Vales']].map(([k, l]) => html`<label>${l}<input type="number" step="0.01" inputmode="decimal" name="${k}" value=""></label>`)}
      <label>Total no sistema (Linx)<input type="number" step="0.01" name="sistema_total" required></label>
      <div class="field wide"><span>Resultado</span><div id="res" class="kpi"></div></div>
      <label class="wide">Justificativa (obrigatória se houver diferença)<textarea name="justificativa"></textarea></label>
    </form>`,
    foot: html`<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" id="ok">Salvar e coletar assinatura</button>`,
  });
  const f = $('#cx', m.el);
  const calc = () => {
    const tot = ['dinheiro', 'debito', 'credito', 'pix', 'a_prazo', 'vales'].reduce((a, k) => a + Number(f[k].value || 0), 0);
    const dif = tot - Number(f.sistema_total.value || 0);
    $('#res', m.el).innerHTML = `<div class="label">Informado ${fmt.brl(tot)}</div><div class="value ${dif < -0.009 ? 'down' : dif > 0.009 ? 'up' : ''}">${dif < -0.009 ? 'Falta' : dif > 0.009 ? 'Sobra' : 'Caixa bateu'} ${fmt.brl(Math.abs(dif))}</div>`;
    return dif;
  };
  f.funcionario_id.addEventListener('change', () => {
    const s = d.sistema_por_frentista[f.funcionario_id.value];
    if (s != null) f.sistema_total.value = s;
    calc();
  });
  f.addEventListener('input', calc);
  calc();
  $('#ok', m.el).addEventListener('click', async () => {
    if (!f.reportValidity()) return;
    const dif = calc();
    if (Math.abs(dif) > 0.009 && !f.justificativa.value.trim()) { toast('Informe a justificativa da diferença', 'err'); return; }
    const body = { turno_id: t.id, funcionario_id: Number(f.funcionario_id.value), sistema_total: f.sistema_total.value, justificativa: f.justificativa.value || null };
    for (const k of ['dinheiro', 'debito', 'credito', 'pix', 'a_prazo', 'vales']) body[k] = f[k].value || 0;
    try {
      const r = await post('/api/r/caixas', body, { offline: true, label: 'Fechamento de caixa' });
      m.close();
      if (r.queued) return;
      toast(dif < -0.009 ? 'Caixa salvo — falta registrada para o frentista' : 'Caixa salvo', 'ok');
      assinaturaFrentista('caixas', r.id, reload);
    } catch (e) { handleErr(e); }
  });
}

export async function faltas(view, _p, query) {
  setTitle('Faltas de caixa');
  const comp = query.competencia || competencia();
  const d = await get(`/api/pista/faltas?competencia=${comp}`);
  mount(view, html`
    <div class="page-head"><div><h1>Faltas de caixa por funcionário</h1><div class="sub">Alerta com ${d.limite_qtd}+ faltas no mês ou valor acima de ${fmt.brl(d.limite_valor)} · desconto em folha só com termo assinado</div></div>
      <div class="row">${compSelect(comp)}<a class="btn" href="#/r/faltas_caixa?f_tratamento=pendente">Pendentes de tratamento</a></div></div>
    <div class="kpis">
      ${kpi('Total de faltas no mês', fmt.brl(d.total))}
      ${kpi('Descontado em folha', fmt.brl(d.total_descontado))}
      ${kpi('Com responsável identificado', d.sem_responsavel ? `${d.sem_responsavel} sem` : '100%', 'meta: 100%', { tone: d.sem_responsavel ? 'red' : 'green' })}
      ${kpi('Frentistas em alerta', d.ranking.filter((r) => r.alerta).length, '', { tone: d.ranking.some((r) => r.alerta) ? 'red' : 'green' })}
    </div>
    ${card('Ranking do mês', table([
      { label: '#', get: (_r, i) => i + 1 },
      { label: 'Frentista', get: (r) => html`<a href="#/r/faltas_caixa?f_funcionario_id=${r.funcionario_id}">${r.nome}</a> ${r.alerta ? badge('alerta', 'red') : ''}` },
      { label: 'Qtd.', num: true, get: (r) => r.qtd },
      { label: 'Total', num: true, get: (r) => fmt.brl(r.total) },
      { label: 'Maior', num: true, get: (r) => fmt.brl(r.maior) },
      { label: 'Descontado', num: true, get: (r) => fmt.brl(r.descontado) },
      { label: 'Abonado', num: true, get: (r) => fmt.brl(r.abonado) },
      { label: 'Em investigação', num: true, get: (r) => fmt.brl(r.investigacao) },
      { label: 'Pendente', num: true, get: (r) => fmt.brl(r.pendente) },
      { label: 'Reincidência (meses c/ falta em 6)', num: true, get: (r) => (r.meses_com_falta_6m >= 3 ? badge(r.meses_com_falta_6m, 'red') : r.meses_com_falta_6m) },
    ], d.ranking, { rowAttrs: (r) => (r.alerta ? 'class="crit"' : ''), empty: 'Nenhuma falta de caixa no mês 👏' }))}`);
  $('[data-comp]', view).addEventListener('change', (e) => navigate(`#/pista/faltas?competencia=${e.target.value}`));
}
