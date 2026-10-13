// Autoatendimento do funcionário (celular): ponto, escala, banco de horas, comissão e assinaturas.
import { html, mount, $, $$, get, post, toast, handleErr, fmt, badge, card, table, kpi, progress, weekdays, modal, today } from '../lib.js';
import { setTitle, reload } from '../app.js';

const TURNO = { manha: 'Manhã', tarde: 'Tarde', noite: 'Noite', folga: 'Folga' };

export async function meu(view) {
  setTitle('Minha área');
  const d = await get('/api/meu');
  const p = d.ponto_hoje;
  const prox = !p ? 'entrada' : !p.saida_intervalo ? 'saída para intervalo' : !p.retorno_intervalo ? 'retorno do intervalo' : !p.saida ? 'saída' : null;
  const pend = d.epi_pendentes.length + d.advertencias_pendentes.length + d.comunicados.length + d.caixas_pendentes.length;
  const com = d.comissao;
  mount(view, html`
    <div class="page-head"><div><h1>Olá, ${d.funcionario.nome.split(' ')[0]}</h1><div class="sub">${d.funcionario.funcao}</div></div></div>
    ${prox ? html`<button class="big-action mb" id="bater">Registrar ${prox}<small>${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} · com localização</small></button>` : html`<div class="card mb">✔ Todas as marcações de hoje foram feitas.</div>`}
    <div class="kpis">
      ${kpi('Banco de horas', fmt.hm(d.banco_horas_min), 'saldo acumulado', { tone: d.banco_horas_min < 0 ? 'red' : 'green' })}
      ${kpi('Horas extras no mês', fmt.hm(d.mes.extra50 + d.mes.extra100), `${d.mes.faltas} falta(s) · ${d.mes.atrasos} atraso(s)`)}
      ${kpi('Comissão do grid', fmt.brl(com.comissao), com.meta ? html`${fmt.brl(com.vendas)} de ${fmt.brl(com.meta)}` : `vendas ${fmt.brl(com.vendas)}`)}
      ${kpi('Pendências para assinar', pend, pend ? 'veja abaixo' : 'nada pendente', { tone: pend ? 'yellow' : 'green' })}
    </div>
    ${com.meta ? html`<div class="card mb"><small class="muted">Meta do grid no mês</small>${progress(100 * com.vendas / com.meta, com.vendas >= com.meta ? 'green' : '')}</div>` : ''}
    <div class="grid g2">
      ${card('Pendências de assinatura', html`
        ${d.comunicados.map((c) => html`<div class="alert-item amarelo mb"><div style="flex:1"><div class="t">📢 ${c.titulo}</div><div class="d">${c.texto}</div></div><button class="btn btn-sm btn-primary" data-sign="comunicado" data-id="${c.id}">Li e concordo</button></div>`)}
        ${d.epi_pendentes.map((e) => html`<div class="alert-item amarelo mb"><div style="flex:1"><div class="t">🦺 Recebi ${e.quantidade}× ${e.item}</div><div class="d">Entregue em ${fmt.date(e.data)}${e.ca ? ' · CA ' + e.ca : ''}</div></div><button class="btn btn-sm btn-primary" data-sign="epi" data-id="${e.id}">Assinar</button></div>`)}
        ${d.advertencias_pendentes.map((a) => html`<div class="alert-item vermelho mb"><div style="flex:1"><div class="t">Advertência (${a.tipo}) — ${fmt.date(a.data)}</div><div class="d">${a.motivo}</div></div><button class="btn btn-sm" data-sign="advertencia" data-id="${a.id}">Dar ciência</button></div>`)}
        ${d.caixas_pendentes.map((c) => html`<div class="alert-item ${c.diferenca < 0 ? 'vermelho' : 'amarelo'} mb"><div style="flex:1"><div class="t">Fechamento de caixa ${fmt.date(c.data)} (${TURNO[c.periodo]})</div><div class="d">Diferença: ${fmt.brl(c.diferenca)}</div></div><button class="btn btn-sm" data-sign="caixa" data-id="${c.id}">Assinar</button></div>`)}
        ${pend ? '' : html`<div class="empty">Nada pendente ✔</div>`}`)}
      ${card('Minha escala — próximos 14 dias', table([
        { label: 'Dia', get: (e) => `${weekdays[new Date(e.data + 'T12:00').getDay()]} ${fmt.date(e.data)}` },
        { label: 'Turno', get: (e) => (e.turno === 'folga' ? badge('Folga', 'green') : html`${TURNO[e.turno]}${e.gnv ? ' · GNV' : ''}`) },
      ], d.escala), html`<button class="btn btn-sm" id="troca">Pedir troca de folga</button>`)}
      ${card('Comissão do mês por produto', table([
        { label: 'Produto', get: (i) => i.produto }, { label: 'Qtd', num: true, get: (i) => fmt.num(i.qtd) },
        { label: 'Vendas', num: true, get: (i) => fmt.brl(i.valor) }, { label: 'Comissão', num: true, get: (i) => fmt.brl(i.comissao) },
      ], com.itens || [], { empty: 'Sem vendas do grid neste mês' }))}
      ${card('Faltas de caixa (90 dias)', table([
        { label: 'Data', get: (f) => fmt.date(f.data) }, { label: 'Valor', num: true, get: (f) => fmt.brl(f.valor) },
        { label: 'Situação', get: (f) => ({ pendente: 'Em análise', desconto: 'Desconto em folha', abonado: 'Abonada', abono_solicitado: 'Abono solicitado', investigacao: 'Em investigação' }[f.tratamento] || f.tratamento) },
      ], d.faltas_caixa, { empty: 'Nenhuma falta de caixa 👏' }))}
      ${card('Férias', table([
        { label: 'Período aquisitivo', get: (f) => `${fmt.date(f.aquisitivo_inicio)} a ${fmt.date(f.aquisitivo_fim)}` },
        { label: 'Situação', get: (f) => (f.programada_inicio ? `Programada para ${fmt.date(f.programada_inicio)}` : f.situacao === 'em_aquisicao' ? 'Em aquisição' : `Tirar até ${fmt.date(f.limite_concessivo)}`) },
      ], d.ferias, { empty: 'Sem períodos pendentes' }))}
      ${card('Ponto de hoje', p ? html`<p>Entrada <b>${p.entrada || '—'}</b> · Intervalo <b>${p.saida_intervalo || '—'}</b>–<b>${p.retorno_intervalo || '—'}</b> · Saída <b>${p.saida || '—'}</b></p>` : html`<p class="muted">Sem marcações hoje.</p>`)}
    </div>`);

  $('#bater', view)?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    const pos = await new Promise((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition((x) => resolve(x.coords), () => resolve(null), { timeout: 8000 });
    });
    try {
      const r = await post('/api/rh/ponto/bater', { lat: pos?.latitude ?? null, lng: pos?.longitude ?? null }, { offline: true, label: 'Ponto' });
      if (!r.queued) toast(`Marcação registrada: ${r.hora}`, 'ok');
      reload();
    } catch (err) { handleErr(err); reload(); }
  });
  $$('[data-sign]', view).forEach((b) => b.addEventListener('click', async () => {
    try { await post(`/api/meu/assinar/${b.dataset.sign}/${b.dataset.id}`); toast('Assinado digitalmente', 'ok'); reload(); } catch (err) { handleErr(err); }
  }));
  $('#troca', view)?.addEventListener('click', () => {
    const folgas = d.escala.filter((e) => e.turno === 'folga');
    const m = modal({
      title: 'Pedir troca de folga', size: 'sm',
      body: html`<form id="tf" class="form-grid" style="grid-template-columns:1fr">
        <label>Folga atual<select name="data_folga" required>${folgas.map((f) => html`<option value="${f.data}">${weekdays[new Date(f.data + 'T12:00').getDay()]} ${fmt.date(f.data)}</option>`)}</select></label>
        <label>Nova data da folga<input type="date" name="data_nova" min="${today()}" required></label>
        <label>Motivo<input name="motivo"></label></form>`,
      foot: html`<button class="btn" data-close>Cancelar</button><button class="btn btn-primary" id="env">Enviar ao gerente</button>`,
    });
    $('#env', m.el).addEventListener('click', async () => {
      const f = $('#tf', m.el);
      if (!f.reportValidity()) return;
      try {
        await post('/api/r/trocas_folga', { funcionario_id: 0, data_folga: f.data_folga.value, data_nova: f.data_nova.value, motivo: f.motivo.value });
        toast('Pedido enviado para aprovação', 'ok'); m.close();
      } catch (err) { handleErr(err); }
    });
  });
}
