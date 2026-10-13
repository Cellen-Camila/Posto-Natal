// Agenda de obrigações recorrentes, checklists do dia, alertas e aprovações.
import {
  html, raw, mount, $, $$, get, post, toast, handleErr, fmt, badge, card, alertList, today, addDays, weekdays, table, isRole, modal,
} from '../lib.js';
import { setTitle, reload } from '../app.js';

const STATUS = { concluida: ['Concluída', 'green'], atrasada: ['Atrasada', 'red'], pendente: ['Pendente', 'yellow'] };

export async function agenda(view, _p, query) {
  setTitle('Agenda e checklists');
  const periodo = query.periodo || 'hoje';
  const de = periodo === 'atrasadas' ? addDays(today(), -7) : today();
  const ate = periodo === 'semana' ? addDays(today(), 6) : periodo === 'mes' ? addDays(today(), 30) : today();
  const [tarefas, alertas] = await Promise.all([get(`/api/agenda?de=${de}&ate=${ate}`), get('/api/alertas')]);
  const lista = periodo === 'atrasadas' ? tarefas.filter((t) => t.status === 'atrasada') : tarefas;
  const porData = new Map();
  for (const t of lista) { if (!porData.has(t.data_prevista)) porData.set(t.data_prevista, []); porData.get(t.data_prevista).push(t); }
  const feitas = lista.filter((t) => t.status === 'concluida').length;

  mount(view, html`
    <div class="page-head"><div><h1>Agenda e checklists</h1><div class="sub">${feitas}/${lista.length} concluída(s) · tarefas geradas automaticamente pelas obrigações recorrentes</div></div>
      <div class="row">${isRole('gerente') ? html`<a class="btn" href="#/r/tarefas_modelo">Obrigações recorrentes</a><button class="btn btn-primary" id="nova">+ Tarefa avulsa</button>` : ''}</div></div>
    <div class="tabs">${[['hoje', 'Hoje'], ['semana', 'Próximos 7 dias'], ['mes', 'Próximos 30 dias'], ['atrasadas', 'Atrasadas']].map(([k, l]) => html`<a href="#/agenda?periodo=${k}" class="${k === periodo ? 'active' : ''}">${l}</a>`)}</div>
    <div class="grid g2">
      <div>${porData.size ? [...porData.entries()].map(([d, ts]) => html`<div class="card mb"><div class="card-head"><h3>${weekdays[new Date(d + 'T12:00').getDay()]}, ${fmt.date(d)}</h3><small class="muted">${ts.filter((t) => t.status === 'concluida').length}/${ts.length}</small></div>
          <div class="check-list">${ts.map((t) => html`<label class="${t.status === 'concluida' ? 'done' : t.status === 'atrasada' ? 'late' : ''}">
            <input type="checkbox" data-id="${t.id}" ${raw(t.concluida_at ? 'checked' : '')}>
            <span style="flex:1">${t.titulo}<br><small class="muted">${t.perfil ? t.perfil.replace('_', ' ') : ''}${t.responsavel ? ' · ' + t.responsavel : ''}${t.hora_limite ? ' · até ' + t.hora_limite : ''}${t.concluida_at ? ` · feito ${fmt.dt(t.concluida_at)}${t.concluida_por_nome ? ' por ' + t.concluida_por_nome : ''}` : ''}</small></span>
            ${badge(STATUS[t.status][0], STATUS[t.status][1])}</label>`)}</div></div>`) : html`<div class="card empty">Nenhuma tarefa neste período.</div>`}</div>
      <section class="card" style="align-self:start"><div class="card-head"><h3>Alertas (${alertas.length})</h3></div>${alertList(alertas, { max: 60 })}</section>
    </div>`);

  $$('input[data-id]', view).forEach((cb) => cb.addEventListener('change', async () => {
    try {
      await post(`/api/tarefas/${cb.dataset.id}/concluir`, { desfazer: !cb.checked });
      reload();
    } catch (e) { cb.checked = !cb.checked; handleErr(e); }
  }));
  $('#nova', view)?.addEventListener('click', async () => {
    const { openRecord } = await import('./crud.js');
    openRecord('tarefas', null, { data_prevista: today() }, { onSaved: reload });
  });
}

export async function aprovacoes(view) {
  setTitle('Aprovações');
  const { rows } = await get('/api/r/aprovacoes?limit=300');
  const pend = rows.filter((r) => r.status === 'pendente');
  const hist = rows.filter((r) => r.status !== 'pendente');
  const gerente = isRole('gerente');
  const tipoLabel = (r) => ({ abono_falta_caixa: 'Abono de falta de caixa', abono_ponto: 'Abono de falta (ponto)', ajuste_estoque: 'Ajuste de estoque', conta_pagar: 'Pagamento acima do limite', estorno: 'Estorno', troca_folga: 'Troca de folga', hora_extra: 'Hora extra' }[r.tipo] || r.tipo);
  mount(view, html`<div id="ap">
    <div class="page-head"><div><h1>Aprovações</h1><div class="sub">Estornos, ajustes de estoque e abonos só valem com aprovação do gerente</div></div></div>
    ${card(`Pendentes (${pend.length})`, table([
      { label: 'Tipo', get: tipoLabel },
      { label: 'Descrição', get: (r) => r.descricao },
      { label: 'Valor', num: true, get: (r) => (r.valor != null ? fmt.brl(r.valor) : '') },
      { label: 'Solicitado por', get: (r) => r._labels?.solicitado_por || '—' },
      { label: 'Em', get: (r) => fmt.dt(r.created_at) },
      { label: '', get: (r) => (gerente ? html`<div class="row"><button class="btn btn-sm btn-primary" data-ap="${r.id}" data-ok="1">Aprovar</button><button class="btn btn-sm btn-danger" data-ap="${r.id}" data-ok="0">Recusar</button></div>` : badge('Aguardando gerente', 'yellow')) },
    ], pend, { empty: 'Nada aguardando aprovação' }))}
    <div class="mt">${card('Histórico', table([
      { label: 'Tipo', get: tipoLabel },
      { label: 'Descrição', get: (r) => r.descricao },
      { label: 'Valor', num: true, get: (r) => (r.valor != null ? fmt.brl(r.valor) : '') },
      { label: 'Decisão', get: (r) => badge(r.status === 'aprovado' ? 'Aprovado' : 'Recusado', r.status === 'aprovado' ? 'green' : 'red') },
      { label: 'Por', get: (r) => r._labels?.decidido_por || '' },
      { label: 'Em', get: (r) => fmt.dt(r.decidido_at) },
      { label: 'Motivo', get: (r) => r.motivo || '' },
    ], hist))}</div></div>`);
  $('#ap', view).addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ap]');
    if (!b) return;
    const ok = b.dataset.ok === '1';
    let motivo = null;
    if (!ok) {
      motivo = await new Promise((resolve) => {
        const m = modal({ title: 'Motivo da recusa', size: 'sm', body: html`<textarea id="mot"></textarea>`, foot: html`<button class="btn" data-close>Cancelar</button><button class="btn btn-danger" id="r">Recusar</button>` });
        $('#r', m.el).addEventListener('click', () => { const v = $('#mot', m.el).value; m.close(); resolve(v || 'Recusado'); });
        $$('[data-close]', m.el).forEach((x) => x.addEventListener('click', () => resolve(null)));
      });
      if (motivo === null) return;
    }
    try { await post(`/api/aprovacoes/${b.dataset.ap}`, { aprovado: ok, motivo }); toast(ok ? 'Aprovado' : 'Recusado', 'ok'); reload(); } catch (err) { handleErr(err); }
  });
}
