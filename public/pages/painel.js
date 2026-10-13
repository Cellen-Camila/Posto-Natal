// Painel do gerente: visão macro do posto em uma tela.
import { html, mount, get, fmt, kpi, card, table, alertList, lineChart, variation, badge, progress } from '../lib.js';
import { setTitle } from '../app.js';

export async function painel(view) {
  setTitle('Painel do gerente');
  const d = await get('/api/painel');
  const v = d.vendas;
  const p = d.pessoas;
  const c = d.caixa;
  const cont = d.alertas.contagem;
  const chk = d.checklists;
  const statusBadge = { concluida: badge('Concluída', 'green'), atrasada: badge('Atrasada', 'red'), pendente: badge('Pendente', 'yellow') };

  mount(view, html`
    <div class="page-head">
      <div><h1>Como está o posto hoje</h1><div class="sub">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}${p.turno_aberto ? ` · turno da ${p.turno_aberto.periodo === 'manha' ? 'manhã' : p.turno_aberto.periodo} aberto` : ''}</div></div>
      <div class="alert-counts">
        <a href="#painel-alertas">${badge(`${cont.vermelho} críticos`, 'red')}</a>
        ${badge(`${cont.amarelo} atenção`, 'yellow')}
        ${badge(`${cont.verde} no radar`, 'green')}
      </div>
    </div>

    ${d.implantacao ? html`<section class="card mb"><div class="card-head"><h3>Primeiros passos — ${d.implantacao.filter((x) => x.ok).length} de ${d.implantacao.length}</h3><small class="muted">Este quadro some quando tudo estiver cadastrado</small></div>
      ${progress(100 * d.implantacao.filter((x) => x.ok).length / d.implantacao.length, 'green')}
      <div class="check-list mt" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">${d.implantacao.map((x) => html`<a class="alert-item ${x.ok ? 'verde' : 'amarelo'}" href="${x.link}"><div><div class="t">${x.ok ? '✔ ' : ''}${x.titulo}</div></div></a>`)}</div></section>` : ''}

    <div class="kpis">
      ${kpi('Faturamento hoje', fmt.brl(v.dia.faturamento), html`Pista ${fmt.brl(v.dia.faturamento_pista)} · Conv. ${fmt.brl(v.dia.faturamento_conveniencia)}`, { href: '#/financeiro' })}
      ${kpi('Litros hoje', fmt.num(v.dia.litros), `Ontem: ${fmt.num(v.ontem.litros)} L`, { href: '#/financeiro' })}
      ${kpi('Faturamento no mês', fmt.brl(v.mes.faturamento), html`${variation(v.variacao_mes_pct)} vs. mesmo período do mês anterior`, { href: '#/financeiro' })}
      ${kpi('Litros no mês', fmt.num(v.mes.litros), html`${variation(v.variacao_litros_pct)} vs. mês anterior`, { href: '#/combustiveis/lmc' })}
      ${kpi('Ticket médio pista', fmt.brl(v.mes.ticket_pista), `Conveniência: ${fmt.brl(v.mes.ticket_conveniencia)}`, { href: '#/financeiro' })}
      ${kpi('Saldo bancário', fmt.brl(c.saldo_bancario), `${c.contas.length} conta(s)`, { href: '#/financeiro/conciliacao', tone: c.saldo_bancario < c.pagar_7d ? 'yellow' : '' })}
    </div>

    <div class="grid g2">
      ${card('Vendas por combustível — mês', table([
        { label: 'Produto', get: (r) => r.nome },
        { label: 'Quantidade', num: true, get: (r) => `${fmt.num(r.qtd)} ${r.unidade}` },
        { label: 'Hoje', num: true, get: (r) => { const h = v.dia.por_combustivel.find((x) => x.id === r.id); return h ? `${fmt.num(h.qtd)} ${r.unidade}` : '—'; } },
        { label: 'Faturamento', num: true, get: (r) => fmt.brl(r.valor) },
        { label: 'vs. mês ant.', num: true, get: (r) => { const a = v.mes_anterior_mesmo_periodo.por_combustivel.find((x) => x.id === r.id); return a?.qtd ? variation(100 * (r.qtd - a.qtd) / a.qtd) : '—'; } },
      ], v.mes.por_combustivel), html`<a href="#/financeiro">detalhes</a>`)}

      ${card('Margem bruta por combustível', table([
        { label: 'Produto', get: (r) => r.combustivel },
        { label: 'Preço', num: true, get: (r) => fmt.brl3(r.preco) },
        { label: 'Custo última compra', num: true, get: (r) => fmt.brl3(r.custo) },
        { label: 'R$/un.', num: true, get: (r) => fmt.brl3(r.margem_un) },
        { label: '%', num: true, get: (r) => html`<b>${fmt.pct(r.margem_pct)}</b>` },
      ], d.margens), html`<a href="#/precos">preços</a>`)}

      ${card('Caixa', html`<div class="kpis" style="margin:0">
        ${kpi('A pagar (7 dias)', fmt.brl(c.pagar_7d), c.pagar_vencidas ? html`<span class="down">${fmt.brl(c.pagar_vencidas)} vencido</span>` : 'nada vencido', { href: '#/r/contas_pagar', tone: c.pagar_vencidas ? 'red' : '' })}
        ${kpi('A receber (7 dias)', fmt.brl(c.receber_7d), 'clientes + cartões', { href: '#/financeiro/fluxo' })}
        ${kpi('Inadimplência', fmt.brl(c.inadimplencia), 'títulos vencidos', { href: '#/financeiro/inadimplencia', tone: c.inadimplencia ? 'yellow' : 'green' })}
      </div>`, html`<a href="#/financeiro/fluxo">fluxo de caixa</a>`)}

      ${card('Pessoas', html`<div class="kpis" style="margin:0">
        ${kpi(`Presentes no turno (${{ manha: 'manhã', tarde: 'tarde', noite: 'noite' }[p.periodo_atual] || ''})`, `${p.presentes}/${p.escalados}`, p.ausentes.length ? `Sem marcação: ${p.ausentes.slice(0, 3).join(', ')}${p.ausentes.length > 3 ? '…' : ''}` : 'equipe completa', { href: '#/rh/escalas', tone: p.ausentes.length ? 'yellow' : 'green' })}
        ${kpi('Faltas hoje', p.faltas_hoje, `${p.atestados_ativos} atestado(s) em curso`, { href: '#/rh/ponto', tone: p.faltas_hoje ? 'red' : '' })}
        ${kpi('Horas extras no mês', fmt.hm(p.horas_extras_mes_min), 'toda a equipe', { href: '#/rh/ponto' })}
      </div>`)}
    </div>

    <div class="grid g2 mt">
      <section class="card" id="painel-alertas"><div class="card-head"><h3>Alertas</h3><a href="#/agenda">agenda</a></div>${alertList(d.alertas.lista, { max: 18 })}</section>
      <div style="display:grid;gap:14px;align-content:start">
        ${card(`Checklists do dia — ${chk.concluidas}/${chk.total}`, html`${progress(chk.total ? 100 * chk.concluidas / chk.total : 0, chk.atrasadas ? 'red' : 'green')}
          <div class="mt">${table([
            { label: 'Tarefa', get: (t) => t.titulo },
            { label: 'Responsável', get: (t) => t.responsavel || t.perfil?.replace('_', ' ') || '—' },
            { label: 'Até', get: (t) => t.hora_limite || '' },
            { label: '', get: (t) => statusBadge[t.status] },
          ], chk.itens)}</div>`, html`<a href="#/agenda">abrir</a>`)}
        ${card('Agenda da semana', table([
          { label: 'Data', get: (a) => html`<span class="nowrap">${fmt.date(a.data)}</span>` },
          { label: 'O quê', get: (a) => html`<small class="muted">${a.tipo}</small><br><a href="${a.link}">${a.texto}</a>` },
        ], d.agenda, { empty: 'Nada previsto para os próximos 7 dias' }))}
      </div>
    </div>

    <div class="mt">${card('Faturamento — últimos 30 dias', lineChart([
      { name: 'Pista', color: 'var(--c1)', zero: true, points: d.serie.map((s) => ({ x: s.data, y: s.pista })) },
      { name: 'Conveniência', color: 'var(--c2)', zero: true, points: d.serie.map((s) => ({ x: s.data, y: s.conveniencia })) },
    ], { yFormat: (n) => 'R$ ' + fmt.num(n / 1000, 0) + 'k' }))}</div>
  `);
}
