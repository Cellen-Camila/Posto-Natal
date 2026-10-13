'use strict';
// Módulo Conveniência: vendas, curva ABC, produtos parados, entrada de notas (XML),
// precificação por margem-alvo, contagens, perdas e validade.

const crud = require('../crud');
const auth = require('../auth');
const core = require('./core');
const { paramNum } = require('../db');
const { HttpError, round2, num, sum, today, addDays, addMonths, diffDays, monthStart, monthEnd, competencia } = require('../util');

const pscope = (ctx, alias = '') => (ctx.postoId ? { sql: `AND ${alias}posto_id = ?`, p: [ctx.postoId] } : { sql: '', p: [] });

function vendas(ctx, de = monthStart(today()), ate = today()) {
  const ps = pscope(ctx, 'v.');
  const args = [de, ate, ...ps.p];
  const base = `FROM vendas v LEFT JOIN produtos p ON p.id = v.produto_id LEFT JOIN categorias_conv c ON c.id = p.categoria_id
    WHERE v.origem = 'conveniencia' AND v.data BETWEEN ? AND ? ${ps.sql}`;
  const tot = ctx.db.prepare(`SELECT SUM(v.valor) AS valor, SUM(v.custo) AS custo, COUNT(DISTINCT COALESCE(v.cupom, v.id)) AS cupons ${base}`).get(...args);
  const porCategoria = ctx.db.prepare(`SELECT COALESCE(c.nome,'Sem categoria') AS categoria, c.margem_alvo, SUM(v.valor) AS valor, SUM(v.custo) AS custo ${base} GROUP BY c.id ORDER BY valor DESC`).all(...args)
    .map((r) => ({ ...r, valor: round2(r.valor), custo: round2(r.custo), margem_pct: r.valor ? round2(100 * (r.valor - r.custo) / r.valor) : 0 }));
  const porHora = ctx.db.prepare(`SELECT substr(v.hora,1,2) AS hora, SUM(v.valor) AS valor, COUNT(DISTINCT COALESCE(v.cupom, v.id)) AS cupons ${base} GROUP BY substr(v.hora,1,2) ORDER BY hora`).all(...args)
    .map((r) => ({ ...r, valor: round2(r.valor) }));
  const porDia = ctx.db.prepare(`SELECT v.data, SUM(v.valor) AS valor, SUM(v.custo) AS custo, COUNT(DISTINCT COALESCE(v.cupom, v.id)) AS cupons ${base} GROUP BY v.data ORDER BY v.data`).all(...args)
    .map((r) => ({ ...r, valor: round2(r.valor), custo: round2(r.custo), ticket: r.cupons ? round2(r.valor / r.cupons) : 0 }));
  const valor = num(tot.valor), custo = num(tot.custo);
  const perdas = ctx.db.prepare(`SELECT COALESCE(SUM(valor),0) AS v FROM perdas WHERE data BETWEEN ? AND ? ${pscope(ctx).sql}`).get(...args).v;
  return {
    de, ate, faturamento: round2(valor), custo: round2(custo), lucro: round2(valor - custo),
    margem_pct: valor ? round2(100 * (valor - custo) / valor) : 0,
    cupons: tot.cupons || 0, ticket_medio: tot.cupons ? round2(valor / tot.cupons) : 0,
    perdas: round2(perdas), indice_perdas_pct: valor ? round2(100 * perdas / valor) : 0,
    por_categoria: porCategoria, por_hora: porHora, por_dia: porDia,
  };
}

// Curva ABC: A até 80% do faturamento acumulado, B até 95%, C o restante
function curvaAbc(ctx, de = addDays(today(), -90), ate = today()) {
  const ps = pscope(ctx, 'v.');
  const rows = ctx.db.prepare(`SELECT p.id, p.nome, p.codigo, p.estoque, SUM(v.quantidade) AS qtd, SUM(v.valor) AS valor, SUM(v.custo) AS custo
    FROM vendas v JOIN produtos p ON p.id = v.produto_id WHERE v.origem = 'conveniencia' AND v.data BETWEEN ? AND ? ${ps.sql}
    GROUP BY p.id ORDER BY valor DESC`).all(de, ate, ...ps.p);
  const total = sum(rows, (r) => r.valor);
  let acc = 0;
  const itens = rows.map((r) => {
    acc += r.valor;
    const pctAcc = total ? 100 * acc / total : 0;
    return {
      ...r, valor: round2(r.valor), custo: round2(r.custo), lucro: round2(r.valor - r.custo),
      participacao: total ? round2(100 * r.valor / total) : 0, acumulado: round2(pctAcc),
      classe: pctAcc - (total ? 100 * r.valor / total : 0) < 80 ? 'A' : pctAcc <= 95 ? 'B' : 'C',
    };
  });
  const resumo = ['A', 'B', 'C'].map((c) => {
    const g = itens.filter((i) => i.classe === c);
    return { classe: c, produtos: g.length, pct_produtos: itens.length ? round2(100 * g.length / itens.length) : 0, faturamento: round2(sum(g, (x) => x.valor)), pct_faturamento: total ? round2(100 * sum(g, (x) => x.valor) / total) : 0 };
  });
  return { de, ate, total: round2(total), resumo, itens };
}

function parados(ctx) {
  const ps = pscope(ctx, 'p.');
  const rows = ctx.db.prepare(`SELECT p.id, p.nome, p.codigo, p.estoque, p.custo, (SELECT MAX(data) FROM vendas v WHERE v.produto_id = p.id) AS ultima_venda
    FROM produtos p WHERE p.local = 'conveniencia' AND COALESCE(p.ativo,1) = 1 AND COALESCE(p.estoque,0) > 0 ${ps.sql}`).all(...ps.p);
  const hoje = today();
  return rows.map((r) => {
    const dias = r.ultima_venda ? diffDays(r.ultima_venda, hoje) : null;
    return { ...r, dias_sem_venda: dias, faixa: dias === null ? 'nunca' : dias >= 90 ? '90+' : dias >= 60 ? '60+' : dias >= 30 ? '30+' : null, valor_parado: round2(num(r.estoque) * num(r.custo)) };
  }).filter((r) => r.faixa).sort((a, b) => (b.dias_sem_venda ?? 9999) - (a.dias_sem_venda ?? 9999));
}

// Preço sugerido = custo / (1 - margem-alvo)
function precificacao(ctx) {
  const ps = pscope(ctx, 'p.');
  const alertaPp = paramNum(ctx.db, 'margem_alerta_pp', 3);
  return ctx.db.prepare(`SELECT p.id, p.nome, p.codigo, p.custo, p.preco, c.nome AS categoria, c.margem_alvo FROM produtos p
    LEFT JOIN categorias_conv c ON c.id = p.categoria_id WHERE p.local = 'conveniencia' AND COALESCE(p.ativo,1) = 1 ${ps.sql} ORDER BY p.nome`).all(...ps.p)
    .map((p) => {
      const margem = p.preco ? round2(100 * (p.preco - p.custo) / p.preco) : 0;
      const alvo = num(p.margem_alvo);
      const sugerido = alvo < 100 && p.custo ? round2(p.custo / (1 - alvo / 100)) : null;
      return { ...p, margem_atual: margem, preco_sugerido: sugerido, abaixo_alvo: alvo > 0 && margem < alvo - alertaPp };
    });
}

// ------------------------------------------------------------------ Notas de entrada (XML NF-e)
function parseNfe(xml) {
  const tag = (src, t) => {
    const m = src.match(new RegExp(`<(?:\\w+:)?${t}[^>]*>([^<]*)</(?:\\w+:)?${t}>`));
    return m ? m[1].trim() : null;
  };
  const block = (src, t) => {
    const m = src.match(new RegExp(`<(?:\\w+:)?${t}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${t}>`));
    return m ? m[1] : '';
  };
  const ide = block(xml, 'ide');
  const emit = block(xml, 'emit');
  const total = block(xml, 'ICMSTot');
  const chaveMatch = xml.match(/Id="NFe(\d{44})"/);
  const itens = [];
  const re = /<(?:\w+:)?det\b[^>]*>([\s\S]*?)<\/(?:\w+:)?det>/g;
  let m;
  while ((m = re.exec(xml))) {
    const prod = block(m[1], 'prod');
    itens.push({
      codigo: tag(prod, 'cProd'), ean: tag(prod, 'cEAN'), descricao: tag(prod, 'xProd'), unidade: tag(prod, 'uCom'),
      qtd_nf: Number(tag(prod, 'qCom') || 0), custo_nf: Number(tag(prod, 'vUnCom') || 0), total: Number(tag(prod, 'vProd') || 0),
    });
  }
  return {
    numero: tag(ide, 'nNF'), data: (tag(ide, 'dhEmi') || tag(ide, 'dEmi') || '').slice(0, 10),
    emitente_cnpj: tag(emit, 'CNPJ'), emitente_nome: tag(emit, 'xNome'),
    valor: Number(tag(total, 'vNF') || 0), chave: chaveMatch ? chaveMatch[1] : null, itens,
  };
}

function importarNfe(ctx, xml) {
  auth.requireWrite(ctx.user, 'notas_entrada');
  const nf = parseNfe(xml);
  if (!nf.numero || !nf.itens.length) throw new HttpError(400, 'XML de NF-e inválido');
  if (nf.chave && ctx.db.prepare('SELECT 1 FROM notas_entrada WHERE chave = ?').get(nf.chave)) throw new HttpError(409, 'Nota já importada');
  let forn = nf.emitente_cnpj && ctx.db.prepare("SELECT id FROM fornecedores WHERE replace(replace(replace(cnpj,'.',''),'/',''),'-','') = ?").get(nf.emitente_cnpj);
  if (!forn) forn = crud.create(ctx, 'fornecedores', { nome: nf.emitente_nome || 'Fornecedor', cnpj: nf.emitente_cnpj, categoria: 'Conveniência' });
  const itens = nf.itens.map((i) => {
    const p = ctx.db.prepare('SELECT id, nome, custo FROM produtos WHERE codigo = ? OR (ean = ? AND ean IS NOT NULL AND ean <> \'\')').get(i.codigo, i.ean);
    return { ...i, produto_id: p?.id || null, produto: p?.nome || null, custo_anterior: p?.custo ?? null, qtd_recebida: null, validade: null };
  });
  return crud.create(ctx, 'notas_entrada', { fornecedor_id: forn.id, numero: nf.numero, chave: nf.chave, data: nf.data || today(), valor: nf.valor, itens, status: 'pendente' });
}

// Confirma a conferência: atualiza estoque/custo, cria lotes de validade e aponta divergências
function conferirNota(ctx, id, { itens = [], pedido_ref } = {}) {
  auth.requireWrite(ctx.user, 'notas_entrada');
  const nota = crud.get(ctx, 'notas_entrada', id);
  if (nota.status !== 'pendente') throw new HttpError(400, 'Nota já conferida');
  const recebidos = new Map(itens.map((i, idx) => [i.idx ?? idx, i]));
  let divergente = false;
  const alertasPreco = [];
  const novos = (nota.itens || []).map((it, idx) => {
    const r = recebidos.get(idx) || {};
    const qtdRec = r.qtd_recebida != null && r.qtd_recebida !== '' ? Number(r.qtd_recebida) : it.qtd_nf;
    const produtoId = r.produto_id ? Number(r.produto_id) : it.produto_id;
    const div = Math.abs(qtdRec - it.qtd_nf) > 0.0001;
    if (div) divergente = true;
    if (produtoId) {
      const p = crud.raw(ctx.db, 'produtos', produtoId);
      if (p && p.custo && it.custo_nf > p.custo * 1.001) {
        const margemNova = p.preco ? round2(100 * (p.preco - it.custo_nf) / p.preco) : 0;
        alertasPreco.push({ produto: p.nome, custo_anterior: p.custo, custo_novo: it.custo_nf, aumento_pct: round2(100 * (it.custo_nf / p.custo - 1)), margem_nova: margemNova });
      }
      ctx.db.prepare('UPDATE produtos SET estoque = COALESCE(estoque,0) + ?, custo = ?, updated_at = ? WHERE id = ?')
        .run(qtdRec, it.custo_nf, new Date().toISOString(), produtoId);
      if (r.validade) crud.create(ctx, 'lotes_validade', { produto_id: produtoId, lote: `NF ${nota.numero}`, validade: r.validade, quantidade: qtdRec }, { noAudit: true });
    }
    return { ...it, produto_id: produtoId, qtd_recebida: qtdRec, validade: r.validade || null, divergencia: div ? round2(qtdRec - it.qtd_nf) : 0 };
  });
  crud.update(ctx, 'notas_entrada', id, { itens: novos, status: divergente ? 'divergente' : 'conferida', pedido_ref: pedido_ref ?? nota.pedido_ref });
  core.concluirChave(ctx, 'conferencia_notas');
  return { ok: true, divergente, alertas_preco: alertasPreco };
}

// ------------------------------------------------------------------ Contagem e ajuste de estoque
function registrarContagem(ctx, { tipo = 'ciclica', itens = [] }) {
  auth.requireWrite(ctx.user, 'contagens');
  const criados = [];
  for (const it of itens) {
    if (it.contado === '' || it.contado == null) continue;
    const p = crud.raw(ctx.db, 'produtos', it.produto_id);
    if (!p) continue;
    const dif = round2(Number(it.contado) - num(p.estoque));
    const c = crud.create(ctx, 'contagens', {
      data: today(), tipo, produto_id: p.id, sistema: num(p.estoque), contado: Number(it.contado),
      status: Math.abs(dif) < 0.0001 ? 'sem_divergencia' : 'pendente',
    }, { noAudit: true });
    criados.push(c);
  }
  const div = criados.filter((c) => c.status === 'pendente');
  if (div.length) {
    for (const c of div) {
      if (ctx.user.perfil === 'gerente') aplicarAjuste(ctx, c.id);
      else core.solicitarAprovacao(ctx, { tipo: 'ajuste_estoque', ref_tabela: 'contagens', ref_id: c.id, valor: c.valor_diferenca, descricao: `Ajuste de estoque: ${c._labels?.produto_id} (${c.diferenca > 0 ? '+' : ''}${c.diferenca})` });
    }
  }
  core.concluirChave(ctx, tipo === 'geral' ? 'inventario_geral' : 'contagem_ciclica');
  return {
    contados: criados.length, divergentes: div.length,
    divergencia_qtd: round2(sum(div, (c) => Math.abs(c.diferenca))),
    divergencia_valor: round2(sum(div, (c) => c.valor_diferenca)),
  };
}

crud.registerHooks('contagens', {
  beforeSave(ctx, data, old) {
    const m = { ...(old || {}), ...data };
    const p = crud.raw(ctx.db, 'produtos', m.produto_id);
    if (m.sistema == null && p) data.sistema = num(p.estoque);
    data.diferenca = round2(num(m.contado) - num(data.sistema ?? m.sistema));
    data.valor_diferenca = round2(data.diferenca * num(p?.custo));
    return data;
  },
});

function aplicarAjuste(ctx, contagemId) {
  const c = crud.raw(ctx.db, 'contagens', contagemId);
  ctx.db.prepare('UPDATE produtos SET estoque = ? WHERE id = ?').run(c.contado, c.produto_id);
  crud.update(ctx, 'contagens', contagemId, { status: 'ajustado' }, { internal: true });
}

core.onApproval('ajuste_estoque', {
  aprovar: (ctx, ap) => aplicarAjuste(ctx, ap.ref_id),
  recusar: (ctx, ap) => crud.update(ctx, 'contagens', ap.ref_id, { status: 'recusado' }, { internal: true }),
});

crud.registerHooks('perdas', {
  beforeSave(ctx, data, old) {
    const m = { ...(old || {}), ...data };
    const p = crud.raw(ctx.db, 'produtos', m.produto_id);
    data.valor = round2(num(m.quantidade) * num(p?.custo));
    return data;
  },
  afterSave(ctx, row, old) {
    const delta = num(row.quantidade) - num(old?.quantidade);
    if (delta) ctx.db.prepare('UPDATE produtos SET estoque = COALESCE(estoque,0) - ? WHERE id = ?').run(delta, row.produto_id);
  },
});

crud.registerHooks('temperaturas', {
  afterSave(ctx, row) {
    core.concluirChave(ctx, 'temperatura', row.data);
  },
});

function validade(ctx) {
  const ps = pscope(ctx, 'l.');
  const hoje = today();
  return ctx.db.prepare(`SELECT l.*, p.nome AS produto, p.custo FROM lotes_validade l JOIN produtos p ON p.id = l.produto_id
    WHERE COALESCE(l.baixado,0) = 0 AND l.validade <= ? ${ps.sql} ORDER BY l.validade`).all(addDays(hoje, 30), ...ps.p)
    .map((l) => ({ ...l, dias: diffDays(hoje, l.validade), valor: round2(num(l.quantidade) * num(l.custo)) }));
}

function indicePerdas(ctx, meses = 6) {
  const out = [];
  for (let i = meses - 1; i >= 0; i--) {
    const comp = competencia(addMonths(monthStart(today()), -i));
    const de = comp + '-01', ate = monthEnd(de);
    const ps = pscope(ctx);
    const fat = ctx.db.prepare(`SELECT COALESCE(SUM(valor),0) AS v FROM vendas WHERE origem = 'conveniencia' AND data BETWEEN ? AND ? ${ps.sql}`).get(de, ate, ...ps.p).v;
    const per = ctx.db.prepare(`SELECT COALESCE(SUM(valor),0) AS v FROM perdas WHERE data BETWEEN ? AND ? ${ps.sql}`).get(de, ate, ...ps.p).v;
    const div = ctx.db.prepare(`SELECT COALESCE(SUM(ABS(valor_diferenca)),0) AS v FROM contagens WHERE data BETWEEN ? AND ? AND status IN ('ajustado','pendente') ${ps.sql}`).get(de, ate, ...ps.p).v;
    out.push({ competencia: comp, faturamento: round2(fat), perdas: round2(per), divergencia_contagem: round2(div), indice_pct: fat ? round2(100 * per / fat) : 0 });
  }
  return out;
}

module.exports = { vendas, curvaAbc, parados, precificacao, parseNfe, importarNfe, conferirNota, registrarContagem, validade, indicePerdas };
