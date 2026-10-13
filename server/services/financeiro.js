'use strict';
// Módulo Financeiro: contas a pagar/receber, inadimplência, conciliações,
// fluxo de caixa, indicadores de vendas e DRE gerencial.

const crud = require('../crud');
const auth = require('../auth');
const core = require('./core');
const { paramNum } = require('../db');
const {
  HttpError, round2, num, sum, today, addDays, diffDays, monthStart, monthEnd, addMonths, competencia, groupBy,
} = require('../util');

const pscope = (ctx, alias = '') => (ctx.postoId ? { sql: `AND ${alias}posto_id = ?`, p: [ctx.postoId] } : { sql: '', p: [] });

// ------------------------------------------------------------------ Contas a pagar
crud.registerHooks('contas_pagar', {
  beforeSave(ctx, data, old) {
    const m = { ...(old || {}), ...data };
    const limite = paramNum(ctx.db, 'aprovacao_pagar_acima', 5000);
    const isGerente = ctx.user?.perfil === 'gerente';
    if (data.status === 'paga' && old?.status !== 'paga') {
      if (num(m.valor) > limite && !m.aprovado_por && !isGerente) {
        throw new HttpError(400, `Pagamento acima de R$ ${limite.toFixed(2)} precisa de aprovação do gerente`);
      }
      if (!m.pagamento_data) data.pagamento_data = today();
      if (m.valor_pago == null) data.valor_pago = num(m.valor) + num(m.juros_multa);
    }
    if (!old && num(m.valor) > limite && !isGerente) data.status = 'aguardando_aprovacao';
    if (!old && num(m.valor) > limite && isGerente) data.aprovado_por = ctx.user.id;
    if (old && data.status === 'estornada' && old.status !== 'estornada' && !isGerente) {
      data.status = old.status;
      core.solicitarAprovacao(ctx, { tipo: 'estorno', ref_tabela: 'contas_pagar', ref_id: old.id, valor: old.valor, descricao: `Estorno do pagamento: ${old.descricao}` });
    }
    return data;
  },
  afterSave(ctx, row, old) {
    if (!old && row.status === 'aguardando_aprovacao') {
      core.solicitarAprovacao(ctx, { tipo: 'conta_pagar', ref_tabela: 'contas_pagar', ref_id: row.id, valor: row.valor, descricao: `Conta a pagar: ${row.descricao}` });
    }
  },
});

crud.registerHooks('contas_receber', {
  beforeSave(ctx, data, old) {
    const m = { ...(old || {}), ...data };
    if (data.status === 'recebida' && old?.status !== 'recebida') {
      if (!m.recebimento_data) data.recebimento_data = today();
      if (m.valor_recebido == null) data.valor_recebido = m.valor;
    }
    if (old && data.status === 'estornada' && old.status !== 'estornada' && ctx.user?.perfil !== 'gerente') {
      data.status = old.status;
      core.solicitarAprovacao(ctx, { tipo: 'estorno', ref_tabela: 'contas_receber', ref_id: old.id, valor: old.valor, descricao: `Estorno do recebimento: ${old.descricao}` });
    }
    return data;
  },
  afterSave(ctx, row) {
    atualizarBloqueio(ctx, row.cliente_id);
  },
});

core.onApproval('conta_pagar', {
  aprovar: (ctx, ap) => crud.update(ctx, 'contas_pagar', ap.ref_id, { status: 'aberta', aprovado_por: ctx.user.id }, { internal: true }),
  recusar: (ctx, ap) => crud.update(ctx, 'contas_pagar', ap.ref_id, { status: 'cancelada' }, { internal: true }),
});
core.onApproval('estorno', {
  aprovar: (ctx, ap) => crud.update(ctx, ap.ref_tabela, ap.ref_id, { status: 'estornada' }, { internal: true }),
});

// ------------------------------------------------------------------ Cartões
crud.registerHooks('recebiveis_cartao', {
  beforeSave(ctx, data, old) {
    const m = { ...(old || {}), ...data };
    const taxa = ctx.db.prepare('SELECT * FROM taxas_cartao WHERE lower(adquirente) = lower(?) AND lower(bandeira) = lower(?) AND modalidade = ?')
      .get(m.adquirente || '', m.bandeira || '', m.modalidade || '');
    if (taxa) {
      data.valor_esperado = round2(num(m.valor_bruto) * (1 - num(taxa.taxa_pct) / 100));
      if (!m.data_prevista || !old) data.data_prevista = addDays(m.data_venda, num(taxa.prazo_dias));
    } else if (!old) {
      data.valor_esperado = num(m.valor_bruto);
      data.data_prevista = m.data_venda;
    }
    return data;
  },
});

function conciliacaoCartoes(ctx, de = addDays(today(), -30), ate = today()) {
  const tol = paramNum(ctx.db, 'cartao_tolerancia', 0.05);
  const ps = pscope(ctx);
  const rows = ctx.db.prepare(`SELECT * FROM recebiveis_cartao WHERE data_venda BETWEEN ? AND ? ${ps.sql} ORDER BY data_prevista`).all(de, ate, ...ps.p);
  const hoje = today();
  const detalhes = rows.map((r) => {
    let situacao = 'a_receber';
    if (r.data_recebida) situacao = Math.abs(num(r.valor_recebido) - num(r.valor_esperado)) > tol ? 'divergente' : 'ok';
    else if (r.data_prevista < hoje) situacao = 'atrasado';
    const taxaEfetiva = r.data_recebida && r.valor_bruto ? round2(100 * (1 - num(r.valor_recebido) / r.valor_bruto)) : null;
    return { ...r, situacao, diferenca: r.data_recebida ? round2(num(r.valor_recebido) - num(r.valor_esperado)) : null, taxa_efetiva: taxaEfetiva };
  });
  const resumo = [...groupBy(detalhes, (d) => `${d.adquirente}|${d.bandeira}|${d.modalidade}`).entries()].map(([k, arr]) => {
    const [adquirente, bandeira, modalidade] = k.split('|');
    return {
      adquirente, bandeira, modalidade,
      vendas: round2(sum(arr, (x) => x.valor_bruto)),
      esperado: round2(sum(arr, (x) => x.valor_esperado)),
      recebido: round2(sum(arr, (x) => x.valor_recebido)),
      divergencia: round2(sum(arr.filter((x) => x.diferenca != null), (x) => x.diferenca)),
      atrasados: arr.filter((x) => x.situacao === 'atrasado').length,
      divergentes: arr.filter((x) => x.situacao === 'divergente').length,
      antecipados: arr.filter((x) => x.antecipado).length,
    };
  });
  return { de, ate, resumo, detalhes: detalhes.filter((d) => d.situacao !== 'ok').slice(0, 300) };
}

// ------------------------------------------------------------------ Inadimplência
function atualizarBloqueio(ctx, clienteId) {
  const c = crud.raw(ctx.db, 'clientes', clienteId);
  if (!c) return;
  const dias = paramNum(ctx.db, 'bloqueio_dias_atraso', 30);
  const aberto = ctx.db.prepare("SELECT COALESCE(SUM(valor),0) AS v FROM contas_receber WHERE cliente_id = ? AND status = 'aberta'").get(clienteId).v;
  const atrasado = ctx.db.prepare("SELECT COUNT(*) AS n FROM contas_receber WHERE cliente_id = ? AND status = 'aberta' AND vencimento < ?")
    .get(clienteId, addDays(today(), -dias)).n;
  const bloquear = (num(c.limite_credito) > 0 && aberto > num(c.limite_credito)) || atrasado > 0;
  if (bloquear && !c.bloqueado) {
    ctx.db.prepare('UPDATE clientes SET bloqueado = 1 WHERE id = ?').run(clienteId);
    crud.audit(ctx.db, null, 'bloqueio_automatico', 'clientes', clienteId, { bloqueado: 0 }, { bloqueado: 1, aberto, atrasado });
  }
}

function inadimplencia(ctx) {
  const ps = pscope(ctx, 'r.');
  const hoje = today();
  const rows = ctx.db.prepare(`SELECT r.*, c.nome, c.limite_credito, c.bloqueado FROM contas_receber r JOIN clientes c ON c.id = r.cliente_id
    WHERE r.status = 'aberta' ${ps.sql}`).all(...ps.p);
  const faixas = { '1-15': 0, '16-30': 0, '31-60': 0, '+60': 0 };
  const clientes = new Map();
  for (const r of rows) {
    if (!clientes.has(r.cliente_id)) clientes.set(r.cliente_id, { cliente_id: r.cliente_id, nome: r.nome, limite: r.limite_credito, bloqueado: r.bloqueado, aberto: 0, vencido: 0, '1-15': 0, '16-30': 0, '31-60': 0, '+60': 0, maior_atraso: 0 });
    const c = clientes.get(r.cliente_id);
    c.aberto = round2(c.aberto + r.valor);
    const atraso = diffDays(r.vencimento, hoje);
    if (atraso > 0) {
      const faixa = atraso <= 15 ? '1-15' : atraso <= 30 ? '16-30' : atraso <= 60 ? '31-60' : '+60';
      c[faixa] = round2(c[faixa] + r.valor);
      c.vencido = round2(c.vencido + r.valor);
      c.maior_atraso = Math.max(c.maior_atraso, atraso);
      faixas[faixa] = round2(faixas[faixa] + r.valor);
    }
  }
  const lista = [...clientes.values()].map((c) => ({ ...c, uso_limite: c.limite ? round2(100 * c.aberto / c.limite) : null }))
    .sort((a, b) => b.vencido - a.vencido);
  return { faixas, total_vencido: round2(sum(Object.values(faixas))), total_aberto: round2(sum(lista, (c) => c.aberto)), clientes: lista };
}

// ------------------------------------------------------------------ Conciliação bancária (OFX)
function parseOfx(texto) {
  const out = [];
  const blocos = String(texto).split(/<STMTTRN>/i).slice(1);
  const tag = (b, t) => {
    const m = b.match(new RegExp(`<${t}>([^<\\r\\n]*)`, 'i'));
    return m ? m[1].trim() : null;
  };
  for (const b of blocos) {
    const dt = tag(b, 'DTPOSTED');
    const valor = Number(String(tag(b, 'TRNAMT') || '0').replace(',', '.'));
    if (!dt) continue;
    out.push({
      data: `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`,
      valor,
      fitid: tag(b, 'FITID'),
      descricao: tag(b, 'MEMO') || tag(b, 'NAME') || tag(b, 'TRNTYPE'),
    });
  }
  return out;
}

function importarOfx(ctx, contaBancariaId, texto) {
  auth.requireWrite(ctx.user, 'extrato');
  if (!crud.raw(ctx.db, 'contas_bancarias', contaBancariaId)) throw new HttpError(400, 'Conta bancária inválida');
  const lanc = parseOfx(texto);
  let novos = 0;
  for (const l of lanc) {
    if (l.fitid && ctx.db.prepare('SELECT 1 FROM extrato WHERE conta_bancaria_id = ? AND fitid = ?').get(contaBancariaId, l.fitid)) continue;
    crud.create(ctx, 'extrato', { conta_bancaria_id: contaBancariaId, ...l }, { noAudit: true });
    novos++;
  }
  const conc = conciliarAutomatico(ctx);
  crud.audit(ctx.db, ctx.user, 'importar_ofx', 'extrato', null, null, { lidos: lanc.length, novos, conciliados: conc.conciliados });
  return { lidos: lanc.length, novos, ...conc };
}

// Casamento automático do extrato com pagamentos, recebimentos e cartões (valor exato, data ±3 dias)
function conciliarAutomatico(ctx) {
  const ps = pscope(ctx);
  const pend = ctx.db.prepare(`SELECT * FROM extrato WHERE conciliado_tipo IS NULL ${ps.sql}`).all(...ps.p);
  const usados = (tipo) => new Set(ctx.db.prepare('SELECT conciliado_id FROM extrato WHERE conciliado_tipo = ?').all(tipo).map((x) => x.conciliado_id));
  const usadosCP = usados('contas_pagar'), usadosCR = usados('contas_receber'), usadosCartao = usados('recebiveis_cartao');
  let conciliados = 0;
  const marcar = (ext, tipo, id) => {
    ctx.db.prepare('UPDATE extrato SET conciliado_tipo = ?, conciliado_id = ? WHERE id = ?').run(tipo, id, ext.id);
    conciliados++;
  };
  for (const e of pend) {
    const de = addDays(e.data, -3), ate = addDays(e.data, 3);
    if (e.valor < 0) {
      const cands = ctx.db.prepare("SELECT id FROM contas_pagar WHERE status = 'paga' AND ABS(COALESCE(valor_pago, valor) - ?) < 0.01 AND pagamento_data BETWEEN ? AND ?")
        .all(-e.valor, de, ate).filter((c) => !usadosCP.has(c.id));
      if (cands.length) { usadosCP.add(cands[0].id); marcar(e, 'contas_pagar', cands[0].id); }
    } else {
      const cr = ctx.db.prepare("SELECT id FROM contas_receber WHERE status = 'recebida' AND ABS(COALESCE(valor_recebido, valor) - ?) < 0.01 AND recebimento_data BETWEEN ? AND ?")
        .all(e.valor, de, ate).filter((c) => !usadosCR.has(c.id));
      if (cr.length) { usadosCR.add(cr[0].id); marcar(e, 'contas_receber', cr[0].id); continue; }
      const ca = ctx.db.prepare('SELECT id FROM recebiveis_cartao WHERE ABS(COALESCE(valor_recebido, valor_esperado) - ?) < 0.01 AND COALESCE(data_recebida, data_prevista) BETWEEN ? AND ?')
        .all(e.valor, de, ate).filter((c) => !usadosCartao.has(c.id));
      if (ca.length) {
        usadosCartao.add(ca[0].id);
        ctx.db.prepare('UPDATE recebiveis_cartao SET valor_recebido = COALESCE(valor_recebido, ?), data_recebida = COALESCE(data_recebida, ?) WHERE id = ?').run(e.valor, e.data, ca[0].id);
        marcar(e, 'recebiveis_cartao', ca[0].id);
        continue;
      }
      if (/DEP|DINHEIRO|PIX/i.test(e.descricao || '')) marcar(e, 'deposito_caixa', null);
    }
  }
  if (pend.length) core.concluirChave(ctx, 'conciliacao_bancaria');
  return { conciliados, pendentes: pend.length - conciliados };
}

function conciliarManual(ctx, extratoId, tipo, id) {
  auth.requireWrite(ctx.user, 'extrato');
  const e = crud.raw(ctx.db, 'extrato', extratoId);
  if (!e) throw new HttpError(404, 'Lançamento não encontrado');
  ctx.db.prepare('UPDATE extrato SET conciliado_tipo = ?, conciliado_id = ? WHERE id = ?').run(tipo || null, id || null, extratoId);
  crud.audit(ctx.db, ctx.user, 'conciliar', 'extrato', Number(extratoId), e, { conciliado_tipo: tipo, conciliado_id: id });
  return { ok: true };
}

function saldoBancario(ctx) {
  const ps = pscope(ctx, 'c.');
  const contas = ctx.db.prepare(`SELECT c.*, COALESCE((SELECT SUM(valor) FROM extrato e WHERE e.conta_bancaria_id = c.id AND e.data >= COALESCE(c.saldo_data, '0000')), 0) AS mov
    FROM contas_bancarias c WHERE 1=1 ${ps.sql}`).all(...ps.p);
  const lista = contas.map((c) => ({ id: c.id, nome: c.nome, banco: c.banco, saldo: round2(num(c.saldo_inicial) + c.mov) }));
  return { contas: lista, total: round2(sum(lista, (c) => c.saldo)) };
}

// PIX e dinheiro: depósitos no banco x fechamentos de caixa
function conciliacaoCaixaBanco(ctx, de = addDays(today(), -14), ate = today()) {
  const ps = pscope(ctx, 't.');
  const caixas = ctx.db.prepare(`SELECT t.data, SUM(c.dinheiro) AS dinheiro, SUM(c.pix) AS pix FROM caixas c JOIN turnos t ON t.id = c.turno_id
    WHERE t.data BETWEEN ? AND ? ${ps.sql} GROUP BY t.data`).all(de, ate, ...ps.p);
  const ps2 = pscope(ctx);
  const deps = ctx.db.prepare(`SELECT data, SUM(CASE WHEN descricao LIKE '%PIX%' THEN valor ELSE 0 END) AS pix,
    SUM(CASE WHEN descricao LIKE '%DEP%' OR descricao LIKE '%DINHEIRO%' THEN valor ELSE 0 END) AS deposito
    FROM extrato WHERE valor > 0 AND data BETWEEN ? AND ? ${ps2.sql} GROUP BY data`).all(de, addDays(ate, 2), ...ps2.p);
  const dmap = new Map(deps.map((d) => [d.data, d]));
  return caixas.map((c) => {
    // depósito do dinheiro costuma cair no dia útil seguinte
    const dep = num(dmap.get(c.data)?.deposito) + num(dmap.get(addDays(c.data, 1))?.deposito);
    const pix = num(dmap.get(c.data)?.pix);
    return {
      data: c.data, dinheiro_caixa: round2(c.dinheiro), deposito_banco: round2(dep), dif_dinheiro: round2(dep - num(c.dinheiro)),
      pix_caixa: round2(c.pix), pix_banco: round2(pix), dif_pix: round2(pix - num(c.pix)),
    };
  });
}

// ------------------------------------------------------------------ Fluxo de caixa
function fluxoCaixa(ctx, dias = 30) {
  const hoje = today();
  const ate = addDays(hoje, dias);
  const ps = pscope(ctx);
  const saldo = saldoBancario(ctx).total;
  const pagar = ctx.db.prepare(`SELECT vencimento AS data, SUM(valor) AS v FROM contas_pagar WHERE status IN ('aberta','aguardando_aprovacao') AND vencimento <= ? ${ps.sql} GROUP BY vencimento`).all(ate, ...ps.p);
  const receber = ctx.db.prepare(`SELECT vencimento AS data, SUM(valor) AS v FROM contas_receber WHERE status = 'aberta' AND vencimento <= ? ${ps.sql} GROUP BY vencimento`).all(ate, ...ps.p);
  const cartoes = ctx.db.prepare(`SELECT data_prevista AS data, SUM(valor_esperado) AS v FROM recebiveis_cartao WHERE data_recebida IS NULL AND data_prevista <= ? ${ps.sql} GROUP BY data_prevista`).all(ate, ...ps.p);
  const toMap = (arr) => {
    const m = new Map();
    for (const x of arr) {
      const d = x.data < hoje ? hoje : x.data; // vencidos entram hoje
      m.set(d, (m.get(d) || 0) + x.v);
    }
    return m;
  };
  const mp = toMap(pagar), mr = toMap(receber), mc = toMap(cartoes);
  const serie = [];
  let s = saldo;
  for (let d = hoje; d <= ate; d = addDays(d, 1)) {
    const entradas = round2(num(mr.get(d)) + num(mc.get(d)));
    const saidas = round2(num(mp.get(d)));
    s = round2(s + entradas - saidas);
    serie.push({ data: d, entradas, saidas, saldo: s });
  }
  // realizado dos últimos 30 dias pelo extrato
  const realizado = ctx.db.prepare(`SELECT data, SUM(CASE WHEN valor > 0 THEN valor ELSE 0 END) AS entradas, SUM(CASE WHEN valor < 0 THEN -valor ELSE 0 END) AS saidas
    FROM extrato WHERE data BETWEEN ? AND ? ${ps.sql} GROUP BY data ORDER BY data`).all(addDays(hoje, -30), hoje, ...ps.p)
    .map((r) => ({ ...r, entradas: round2(r.entradas), saidas: round2(r.saidas) }));
  return { saldo_atual: saldo, previsto: serie, realizado, menor_saldo: Math.min(...serie.map((x) => x.saldo)) };
}

function proximos(ctx, dias = 7) {
  const hoje = today(), ate = addDays(hoje, dias);
  const ps = pscope(ctx);
  return {
    pagar: round2(ctx.db.prepare(`SELECT COALESCE(SUM(valor),0) AS v FROM contas_pagar WHERE status IN ('aberta','aguardando_aprovacao') AND vencimento BETWEEN ? AND ? ${ps.sql}`).get(hoje, ate, ...ps.p).v),
    pagar_vencidas: round2(ctx.db.prepare(`SELECT COALESCE(SUM(valor),0) AS v FROM contas_pagar WHERE status IN ('aberta','aguardando_aprovacao') AND vencimento < ? ${ps.sql}`).get(hoje, ...ps.p).v),
    receber: round2(ctx.db.prepare(`SELECT COALESCE(SUM(valor),0) AS v FROM contas_receber WHERE status = 'aberta' AND vencimento BETWEEN ? AND ? ${ps.sql}`).get(hoje, ate, ...ps.p).v)
      + round2(ctx.db.prepare(`SELECT COALESCE(SUM(valor_esperado),0) AS v FROM recebiveis_cartao WHERE data_recebida IS NULL AND data_prevista BETWEEN ? AND ? ${ps.sql}`).get(hoje, ate, ...ps.p).v),
  };
}

function jurosPagos(ctx, de, ate) {
  const ps = pscope(ctx);
  return ctx.db.prepare(`SELECT descricao, vencimento, pagamento_data, juros_multa FROM contas_pagar WHERE status = 'paga' AND juros_multa > 0 AND pagamento_data BETWEEN ? AND ? ${ps.sql} ORDER BY pagamento_data`).all(de, ate, ...ps.p);
}

// ------------------------------------------------------------------ Indicadores de vendas
function indicadores(ctx, de = monthStart(today()), ate = today()) {
  const ps = pscope(ctx, 'v.');
  const base = `FROM vendas v WHERE v.data BETWEEN ? AND ? ${ps.sql}`;
  const args = [de, ate, ...ps.p];
  const q = (sql) => ctx.db.prepare(sql).all(...args);
  const porProduto = q(`SELECT c.nome AS produto, c.unidade, SUM(v.quantidade) AS qtd, SUM(v.valor) AS valor, SUM(v.custo) AS custo, COUNT(*) AS n
    ${base.replace('FROM vendas v', 'FROM vendas v JOIN combustiveis c ON c.id = v.combustivel_id')} AND v.origem = 'pista' GROUP BY c.id ORDER BY c.id`);
  const porTurno = q(`SELECT t.periodo, SUM(v.valor) AS valor, COUNT(*) AS n, SUM(v.quantidade) AS litros ${base.replace('FROM vendas v', 'FROM vendas v JOIN turnos t ON t.id = v.turno_id')} AND v.origem = 'pista' GROUP BY t.periodo`);
  const porFrentista = q(`SELECT f.nome, SUM(v.valor) AS valor, COUNT(*) AS n, SUM(v.quantidade) AS litros ${base.replace('FROM vendas v', 'FROM vendas v JOIN funcionarios f ON f.id = v.funcionario_id')} AND v.origem = 'pista' GROUP BY f.id ORDER BY valor DESC`);
  const porBico = q(`SELECT b.nome AS bico, SUM(v.quantidade) AS litros, SUM(v.valor) AS valor ${base.replace('FROM vendas v', 'FROM vendas v JOIN bicos b ON b.id = v.bico_id')} GROUP BY b.id ORDER BY b.nome`);
  const mix = q(`SELECT v.forma_pagamento, v.origem, SUM(v.valor) AS valor, COUNT(*) AS n ${base} GROUP BY v.forma_pagamento, v.origem`);
  const porDia = q(`SELECT v.data, v.origem, SUM(v.valor) AS valor, SUM(CASE WHEN v.origem='pista' THEN v.quantidade ELSE 0 END) AS litros ${base} GROUP BY v.data, v.origem ORDER BY v.data`);
  const tot = ctx.db.prepare(`SELECT v.origem, SUM(v.valor) AS valor, SUM(v.custo) AS custo, COUNT(DISTINCT COALESCE(v.cupom, v.id)) AS cupons ${base} GROUP BY v.origem`).all(...args);
  const fmt = (arr) => arr.map((r) => {
    const o = { ...r };
    for (const k of Object.keys(o)) if (typeof o[k] === 'number') o[k] = round2(o[k]);
    if (o.valor != null && o.n) o.ticket = round2(o.valor / o.n);
    if (o.custo != null && o.valor) { o.margem = round2(o.valor - o.custo); o.margem_pct = round2(100 * (o.valor - o.custo) / o.valor); }
    if (o.qtd) { o.preco_medio = round2(o.valor / o.qtd * 1000) / 1000; o.margem_un = o.custo != null ? round2((o.valor - o.custo) / o.qtd * 1000) / 1000 : null; }
    return o;
  });
  const faltas = ctx.db.prepare(`SELECT COALESCE(SUM(valor),0) AS v FROM faltas_caixa WHERE data BETWEEN ? AND ? ${ctx.postoId ? 'AND posto_id = ?' : ''}`).get(...args).v;
  return {
    de, ate,
    totais: fmt(tot).map((t) => ({ ...t, ticket: t.cupons ? round2(t.valor / t.cupons) : 0 })),
    por_produto: fmt(porProduto), por_turno: fmt(porTurno), por_frentista: fmt(porFrentista), por_bico: fmt(porBico),
    mix: fmt(mix), por_dia: fmt(porDia), faltas_caixa: round2(faltas),
  };
}

// ------------------------------------------------------------------ DRE gerencial
function dreMes(ctx, comp) {
  const de = comp + '-01', ate = monthEnd(de);
  const ps = pscope(ctx);
  const v = ctx.db.prepare(`SELECT origem, SUM(valor) AS receita, SUM(custo) AS custo FROM vendas WHERE data BETWEEN ? AND ? ${ps.sql} GROUP BY origem`).all(de, ate, ...ps.p);
  const rec = (o) => num(v.find((x) => x.origem === o)?.receita);
  const cus = (o) => num(v.find((x) => x.origem === o)?.custo);
  const ps2 = pscope(ctx, 'cp.');
  const desp = ctx.db.prepare(`SELECT pc.nome, pc.tipo, SUM(COALESCE(cp.valor_pago, cp.valor)) AS valor FROM contas_pagar cp LEFT JOIN plano_contas pc ON pc.id = cp.conta_id
    WHERE cp.status = 'paga' AND cp.pagamento_data BETWEEN ? AND ? AND COALESCE(pc.tipo,'despesa') IN ('despesa','financeira') ${ps2.sql} GROUP BY pc.id ORDER BY valor DESC`).all(de, ate, ...ps2.p);
  const juros = ctx.db.prepare(`SELECT COALESCE(SUM(juros_multa),0) AS v FROM contas_pagar cp WHERE status = 'paga' AND pagamento_data BETWEEN ? AND ? ${ps2.sql}`).get(de, ate, ...ps2.p).v;
  const perdas = ctx.db.prepare(`SELECT COALESCE(SUM(valor),0) AS v FROM perdas WHERE data BETWEEN ? AND ? ${ps.sql}`).get(de, ate, ...ps.p).v;
  const taxasCartao = ctx.db.prepare(`SELECT COALESCE(SUM(valor_bruto - valor_esperado),0) AS v FROM recebiveis_cartao WHERE data_venda BETWEEN ? AND ? ${ps.sql}`).get(de, ate, ...ps.p).v;
  const receita = rec('pista') + rec('conveniencia');
  const cmv = cus('pista') + cus('conveniencia');
  const lucroBruto = receita - cmv;
  const despesas = sum(desp, (d) => d.valor) + num(perdas) + num(taxasCartao) + num(juros);
  return {
    competencia: comp,
    receita_pista: round2(rec('pista')), receita_conveniencia: round2(rec('conveniencia')), receita: round2(receita),
    cmv_pista: round2(cus('pista')), cmv_conveniencia: round2(cus('conveniencia')), cmv: round2(cmv),
    lucro_bruto: round2(lucroBruto), margem_bruta_pct: receita ? round2(100 * lucroBruto / receita) : 0,
    despesas: desp.map((d) => ({ nome: d.nome || 'Sem categoria', valor: round2(d.valor) }))
      .concat([{ nome: 'Taxas de cartão', valor: round2(taxasCartao) }, { nome: 'Perdas e avarias (conveniência)', valor: round2(perdas) }, { nome: 'Juros e multas por atraso', valor: round2(juros) }]),
    total_despesas: round2(despesas),
    resultado: round2(lucroBruto - despesas),
    margem_liquida_pct: receita ? round2(100 * (lucroBruto - despesas) / receita) : 0,
  };
}

function dre(ctx, comp = competencia(today())) {
  return {
    atual: dreMes(ctx, comp),
    mes_anterior: dreMes(ctx, competencia(addMonths(comp + '-01', -1))),
    ano_anterior: dreMes(ctx, competencia(addMonths(comp + '-01', -12))),
  };
}

// ------------------------------------------------------------------ Importação de vendas (Linx/Webposto)
// CSV com cabeçalho: data;hora;origem;cupom;bico;combustivel;produto_codigo;frentista_cpf;quantidade;valor;custo;forma_pagamento
function importarVendasCsv(ctx, texto) {
  auth.requireWrite(ctx.user, 'vendas');
  const linhas = String(texto).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (linhas.length < 2) throw new HttpError(400, 'Arquivo vazio');
  const sep = linhas[0].includes(';') ? ';' : ',';
  const head = linhas[0].split(sep).map((h) => h.trim().toLowerCase());
  const idx = (n) => head.indexOf(n);
  const bicos = new Map(ctx.db.prepare('SELECT id, nome, combustivel_id FROM bicos').all().map((b) => [b.nome.toLowerCase(), b]));
  const combs = new Map(ctx.db.prepare('SELECT id, nome, custo_medio FROM combustiveis').all().map((c) => [c.nome.toLowerCase(), c]));
  const combsById = new Map([...combs.values()].map((c) => [c.id, c]));
  const prods = new Map(ctx.db.prepare('SELECT id, codigo, custo FROM produtos').all().map((p) => [String(p.codigo), p]));
  const funcs = new Map(ctx.db.prepare('SELECT id, cpf FROM funcionarios').all().map((f) => [String(f.cpf || '').replace(/\D/g, ''), f.id]));
  const nf = (s) => Number(String(s || '0').replace(/\./g, '').replace(',', '.'));
  let n = 0;
  const erros = [];
  ctx.db.exec('BEGIN');
  try {
    for (let i = 1; i < linhas.length; i++) {
      const c = linhas[i].split(sep);
      const g = (k) => (idx(k) >= 0 ? (c[idx(k)] || '').trim() : '');
      const data = g('data').includes('/') ? g('data').split('/').reverse().join('-') : g('data');
      const bico = bicos.get(g('bico').toLowerCase());
      const comb = combs.get(g('combustivel').toLowerCase()) || (bico ? { id: bico.combustivel_id } : null);
      const prod = prods.get(g('produto_codigo'));
      const qtd = nf(g('quantidade'));
      const valor = nf(g('valor'));
      if (!data || !valor) { erros.push(`linha ${i + 1}: data/valor inválidos`); continue; }
      const turno = ctx.db.prepare(`SELECT id FROM turnos WHERE data = ? AND periodo = ? ${ctx.postoId ? 'AND posto_id = ?' : ''}`)
        .get(data, periodoDaHora(g('hora')), ...(ctx.postoId ? [ctx.postoId] : []));
      const custo = g('custo') ? nf(g('custo')) : comb ? qtd * num(combsById.get(comb.id)?.custo_medio) : prod ? qtd * num(prod.custo) : null;
      crud.create(ctx, 'vendas', {
        data, hora: g('hora'), origem: g('origem') || (prod ? 'conveniencia' : 'pista'), cupom: g('cupom'),
        bico_id: bico?.id, combustivel_id: comb?.id, produto_id: prod?.id, funcionario_id: funcs.get(g('frentista_cpf').replace(/\D/g, '')),
        turno_id: turno?.id, quantidade: qtd, valor, custo: custo != null ? round2(custo) : null, forma_pagamento: g('forma_pagamento') || 'dinheiro',
      }, { noAudit: true });
      n++;
    }
    ctx.db.exec('COMMIT');
  } catch (e) {
    ctx.db.exec('ROLLBACK');
    throw e;
  }
  crud.audit(ctx.db, ctx.user, 'importar_vendas', 'vendas', null, null, { linhas: n });
  return { importadas: n, erros };
}

function periodoDaHora(h) {
  const m = Number(String(h || '12').split(':')[0]);
  if (m >= 6 && m < 14) return 'manha';
  if (m >= 14 && m < 22) return 'tarde';
  return 'noite';
}

module.exports = {
  conciliacaoCartoes, inadimplencia, atualizarBloqueio, parseOfx, importarOfx, conciliarAutomatico, conciliarManual,
  saldoBancario, conciliacaoCaixaBanco, fluxoCaixa, proximos, jurosPagos, indicadores, dre, dreMes, importarVendasCsv, periodoDaHora,
};
