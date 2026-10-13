// Pacote mensal para a contabilidade.
import { html, raw, mount, $, $$, get, put, post, toast, handleErr, fmt, badge, card, table, progress, compSelect, competencia, prevComp, compLabel, downloadUrl, isRole, canWrite } from '../lib.js';
import { setTitle, navigate, reload } from '../app.js';

export async function pacote(view, _p, query) {
  setTitle('Pacote contábil');
  const comp = query.competencia || prevComp(competencia());
  const contador = isRole('contabilidade');
  const [f, lista] = await Promise.all([get(`/api/contabil/fechamento?competencia=${comp}`), get('/api/r/fechamentos?limit=50')]);
  const itens = f?.itens || [];
  const ok = itens.filter((i) => i.ok).length;
  const w = canWrite('fechamentos') && !f?.enviado_at;
  const liberados = lista.rows.filter((x) => x.enviado_at);
  mount(view, html`
    <div class="page-head"><div><h1>Pacote mensal para a contabilidade — ${compLabel(comp)}</h1><div class="sub">Planilhas de RH, financeiro e fiscal (LMC, entradas) + termos e comprovantes, em um único ZIP</div></div>
      <div class="row">${compSelect(comp)}${!contador || f?.enviado_at ? html`<a class="btn btn-primary" href="${downloadUrl(`/api/contabil/pacote?competencia=${comp}`)}">⬇ Baixar pacote (ZIP)</a>` : ''}</div></div>
    <div class="grid g2">
      ${contador ? card('Situação', f?.enviado_at ? html`${badge('Liberado', 'green')} em ${fmt.dt(f.enviado_at)}` : html`<div class="empty">O posto ainda não liberou o pacote desta competência.</div>`)
        : card(`Checklist de envio — ${ok}/${itens.length}`, html`${progress(itens.length ? 100 * ok / itens.length : 0, ok === itens.length ? 'green' : '')}
        <div class="check-list mt">${itens.map((i, idx) => html`<label class="${i.ok ? 'done' : ''}"><input type="checkbox" data-i="${idx}" ${raw(i.ok ? 'checked' : '')} ${raw(w ? '' : 'disabled')}> ${i.titulo}</label>`)}</div>
        ${f?.enviado_at ? html`<p class="mt">${badge('Liberado à contabilidade', 'green')} em ${fmt.dt(f.enviado_at)}</p>` : w ? html`<button class="btn btn-primary mt" id="lib" ${raw(ok === itens.length ? '' : 'disabled')}>Liberar à contabilidade</button>` : ''}`)}
      ${card('Conteúdo do pacote', html`<ul>
        <li><b>RH</b>: resumo e detalhe do ponto, faltas de caixa (com indicação do termo), comissões, atestados (sem CID — LGPD), admissões/demissões, férias, provisão de 13º</li>
        <li><b>Financeiro</b>: contas pagas e recebidas, extrato conciliado, DRE gerencial, vendas por dia e forma de pagamento</li>
        <li><b>Fiscal</b>: LMC do mês, entradas de combustível, notas de entrada da conveniência</li>
        <li><b>Anexos</b>: termos de desconto assinados e comprovantes de pagamento</li></ul>`)}
    </div>
    <div class="mt">${card('Competências liberadas', table([
      { label: 'Competência', get: (x) => compLabel(x.competencia) }, { label: 'Tipo', get: (x) => (x.tipo === 'dp' ? 'Fechamento do DP' : 'Pacote contábil') },
      { label: 'Liberado em', get: (x) => fmt.dt(x.enviado_at) },
      { label: '', get: (x) => (x.tipo === 'contabil' ? html`<a class="btn btn-sm" href="${downloadUrl(`/api/contabil/pacote?competencia=${x.competencia}`)}">⬇ ZIP</a>` : '') },
    ], liberados, { empty: 'Nenhuma competência liberada ainda' }))}</div>`);
  $('[data-comp]', view).addEventListener('change', (e) => navigate(`#/contabil?competencia=${e.target.value}`));
  $$('[data-i]', view).forEach((cb) => cb.addEventListener('change', async () => {
    itens[cb.dataset.i].ok = cb.checked;
    try { await put(`/api/fechamentos/${f.id}/itens`, { itens }); reload(); } catch (e) { handleErr(e); }
  }));
  $('#lib', view)?.addEventListener('click', async () => {
    try { await post(`/api/fechamentos/${f.id}/liberar`); toast('Pacote liberado à contabilidade', 'ok'); reload(); } catch (e) { handleErr(e); }
  });
}
