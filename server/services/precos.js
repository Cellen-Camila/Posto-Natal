'use strict';
// Módulo Pesquisa de Preços e Margem.

const crud = require('../crud');
const auth = require('../auth');
const core = require('./core');
const { paramNum } = require('../db');
const { HttpError, round2, num, sum, today, addDays, monthStart } = require('../util');

const r3 = (n) => Math.round(num(n) * 1000) / 1000;
const pscope = (ctx, alias = '') => (ctx.postoId ? { sql: `AND ${alias}posto_id = ?`, p: [ctx.postoId] } : { sql: '', p: [] });

crud.registerHooks('pesquisas_preco', {
  afterSave(ctx, row) {
    core.concluirChave(ctx, 'pesquisa_preco', row.data);
  },
});

function painel(ctx) {
  const hoje = today();
  const ps = pscope(ctx);
  return ctx.db.prepare('SELECT * FROM combustiveis ORDER BY id').all().map((c) => {
    const pesq = ctx.db.prepare(`SELECT p.preco, p.data, co.nome FROM pesquisas_preco p JOIN concorrentes co ON co.id = p.concorrente_id
      WHERE p.combustivel_id = ? AND p.data >= ? ${pscope(ctx, 'p.').sql} ORDER BY p.data DESC, p.id DESC`).all(c.id, addDays(hoje, -7), ...pscope(ctx, 'p.').p);
    // último preço de cada concorrente
    const porConc = new Map();
    for (const p of pesq) if (!porConc.has(p.nome)) porConc.set(p.nome, p);
    const precos = [...porConc.values()].map((p) => p.preco);
    const media = precos.length ? sum(precos) / precos.length : null;
    const anp = ctx.db.prepare('SELECT * FROM precos_anp WHERE combustivel_id = ? ORDER BY data DESC LIMIT 1').get(c.id);
    const ultCompra = ctx.db.prepare(`SELECT d.custo_unitario, d.data, f.nome AS distribuidora FROM descargas d LEFT JOIN fornecedores f ON f.id = d.fornecedor_id
      WHERE d.combustivel_id = ? AND d.status = 'aprovada' ${pscope(ctx, 'd.').sql} ORDER BY d.data DESC, d.id DESC LIMIT 1`).get(c.id, ...pscope(ctx, 'd.').p);
    const custo = ultCompra?.custo_unitario ?? c.custo_medio;
    const vol30 = ctx.db.prepare(`SELECT COALESCE(SUM(quantidade),0) AS q FROM vendas WHERE combustivel_id = ? AND data >= ? ${ps.sql}`).get(c.id, addDays(hoje, -30), ...ps.p).q;
    return {
      combustivel_id: c.id, combustivel: c.nome, unidade: c.unidade, preco: c.preco_bomba, custo: r3(custo),
      margem_un: r3(c.preco_bomba - custo), margem_pct: c.preco_bomba ? round2(100 * (c.preco_bomba - custo) / c.preco_bomba) : 0,
      media_concorrentes: media != null ? r3(media) : null, min_concorrentes: precos.length ? Math.min(...precos) : null, max_concorrentes: precos.length ? Math.max(...precos) : null,
      dif_media: media != null ? r3(c.preco_bomba - media) : null,
      posicao: media == null ? null : c.preco_bomba < media - 0.005 ? 'abaixo' : c.preco_bomba > media + 0.005 ? 'acima' : 'na média',
      anp: anp ? { data: anp.data, medio: anp.preco_medio, min: anp.preco_min, max: anp.preco_max } : null,
      ultima_compra: ultCompra || null, volume_30d: round2(vol30),
      concorrentes: [...porConc.values()],
    };
  });
}

// Simulador: novo preço → margem e impacto estimado no faturamento mensal
function simular(ctx, combustivelId, novoPreco) {
  const p = painel(ctx).find((x) => x.combustivel_id === Number(combustivelId));
  if (!p) throw new HttpError(404, 'Combustível não encontrado');
  const novo = Number(novoPreco);
  if (!(novo > 0)) throw new HttpError(400, 'Preço inválido');
  const elasticidade = paramNum(ctx.db, 'elasticidade', -1.5);
  const varPreco = p.preco ? (novo - p.preco) / p.preco : 0;
  const volAtual = p.volume_30d;
  const volNovo = Math.max(0, volAtual * (1 + elasticidade * varPreco));
  const margemNova = novo - p.custo;
  return {
    ...p,
    novo_preco: novo,
    nova_margem_un: r3(margemNova), nova_margem_pct: round2(100 * margemNova / novo),
    variacao_preco_pct: round2(100 * varPreco),
    volume_mes_atual: round2(volAtual), volume_mes_estimado: round2(volNovo),
    faturamento_atual: round2(volAtual * p.preco), faturamento_estimado: round2(volNovo * novo),
    lucro_bruto_atual: round2(volAtual * p.margem_un), lucro_bruto_estimado: round2(volNovo * margemNova),
    dif_media_nova: p.media_concorrentes != null ? r3(novo - p.media_concorrentes) : null,
    elasticidade,
  };
}

function alterarPreco(ctx, { combustivel_id, preco, motivo }) {
  auth.requireRole(ctx.user, 'gerente');
  const c = crud.raw(ctx.db, 'combustiveis', combustivel_id);
  if (!c) throw new HttpError(404, 'Combustível não encontrado');
  const novo = Number(String(preco).replace(',', '.'));
  if (!(novo > 0)) throw new HttpError(400, 'Preço inválido');
  if (!motivo) throw new HttpError(400, 'Informe o motivo da alteração');
  crud.update(ctx, 'combustiveis', c.id, { preco_bomba: novo }, { internal: true });
  const h = crud.create(ctx, 'historico_precos', {
    data: new Date().toISOString(), combustivel_id: c.id, preco_anterior: c.preco_bomba, preco_novo: novo, motivo, usuario_id: ctx.user.id, painel_atualizado: 0,
  }, { internal: true });
  crud.create(ctx, 'tarefas', {
    titulo: `Atualizar painel de preços da pista: ${c.nome} R$ ${novo.toFixed(3).replace('.', ',')}`,
    modulo: 'precos', data_prevista: today(), perfil: 'chefe_pista', obs: `historico:${h.id}`,
  }, { internal: true });
  return h;
}

// Ao concluir a tarefa de atualizar o painel, marca o histórico
crud.registerHooks('tarefas', {
  beforeSave(ctx, data, old) {
    if (data.concluida_at && !old?.concluida_at) data.concluida_por = ctx.user?.id ?? null;
    return data;
  },
  afterSave(ctx, row, old) {
    if (row.concluida_at && !old?.concluida_at && /^historico:\d+$/.test(row.obs || '')) {
      ctx.db.prepare('UPDATE historico_precos SET painel_atualizado = 1 WHERE id = ?').run(Number(row.obs.split(':')[1]));
    }
  },
});

// Série para o gráfico: preço do posto x média dos concorrentes x custo x ANP
function evolucao(ctx, combustivelId, dias = 60) {
  const de = addDays(today(), -dias);
  const c = crud.raw(ctx.db, 'combustiveis', combustivelId);
  if (!c) throw new HttpError(404, 'Combustível não encontrado');
  const hist = ctx.db.prepare('SELECT substr(data,1,10) AS data, preco_anterior, preco_novo FROM historico_precos WHERE combustivel_id = ? ORDER BY data').all(c.id);
  const conc = new Map(ctx.db.prepare(`SELECT data, AVG(preco) AS m FROM pesquisas_preco WHERE combustivel_id = ? AND data >= ? ${pscope(ctx).sql} GROUP BY data`)
    .all(c.id, de, ...pscope(ctx).p).map((x) => [x.data, x.m]));
  const custos = ctx.db.prepare(`SELECT data, custo_unitario FROM descargas WHERE combustivel_id = ? AND status = 'aprovada' ORDER BY data`).all(c.id);
  const anp = ctx.db.prepare('SELECT data, preco_medio FROM precos_anp WHERE combustivel_id = ? ORDER BY data').all(c.id);
  const precoEm = (d) => {
    let p = hist.length ? hist[0].preco_anterior : c.preco_bomba;
    for (const h of hist) if (h.data <= d) p = h.preco_novo;
    return p;
  };
  const ultimoAte = (arr, d, k) => { let v = null; for (const x of arr) if (x.data <= d) v = x[k]; return v; };
  const serie = [];
  for (let d = de; d <= today(); d = addDays(d, 1)) {
    serie.push({ data: d, posto: precoEm(d), concorrentes: conc.has(d) ? r3(conc.get(d)) : null, custo: ultimoAte(custos, d, 'custo_unitario'), anp: ultimoAte(anp, d, 'preco_medio') });
  }
  return { combustivel: c.nome, serie };
}

function custosCompra(ctx, de = addDays(monthStart(today()), -60)) {
  const ps = pscope(ctx, 'd.');
  return ctx.db.prepare(`SELECT d.data, c.nome AS combustivel, f.nome AS distribuidora, d.nota, d.volume_nf, d.custo_unitario FROM descargas d
    JOIN combustiveis c ON c.id = d.combustivel_id LEFT JOIN fornecedores f ON f.id = d.fornecedor_id WHERE d.data >= ? AND d.status = 'aprovada' ${ps.sql} ORDER BY d.data DESC`).all(de, ...ps.p);
}

module.exports = { painel, simular, alterarPreco, evolucao, custosCompra };
