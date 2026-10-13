'use strict';
// Pacote mensal para a contabilidade (ZIP com planilhas CSV e anexos).

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const crud = require('../crud');
const auth = require('../auth');
const core = require('./core');
const rh = require('./rh');
const fin = require('./financeiro');
const comb = require('./combustiveis');
const { toCsv, monthEnd, round2, HttpError } = require('../util');

// ZIP mínimo (deflate) sem dependências
function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  const now = new Date();
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime(now), 10);
    local.writeUInt16LE(dosDate(now), 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(dosTime(now), 12);
    c.writeUInt16LE(dosDate(now), 14);
    c.writeUInt32LE(crc >>> 0, 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + comp.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

const hm = (m) => rh.minToHm(m || 0);

function pacote(ctx, comp, uploadsDir) {
  if (!/^\d{4}-\d{2}$/.test(comp || '')) throw new HttpError(400, 'Competência inválida (AAAA-MM)');
  auth.requireModule(ctx.user, 'contabil');
  if (ctx.user.perfil === 'contabilidade') {
    const lib = ctx.db.prepare("SELECT 1 FROM fechamentos WHERE tipo = 'contabil' AND competencia = ? AND enviado_at IS NOT NULL").get(comp);
    if (!lib) throw new HttpError(403, 'Pacote desta competência ainda não foi liberado pelo posto');
  }
  // a geração usa uma visão de gerente para consolidar todos os módulos
  const sys = { ...ctx, user: { ...ctx.user, perfil: 'gerente' } };
  const de = comp + '-01', ate = monthEnd(de);
  const pf = ctx.postoId ? 'AND x.posto_id = ?' : '';
  const pp = ctx.postoId ? [ctx.postoId] : [];
  const files = [];
  const add = (name, cols, rows) => files.push({ name: `${comp}/${name}`, data: toCsv(cols, rows) });

  const eq = rh.resumoEquipe(sys, comp);
  add('RH/01_resumo_ponto.csv', [
    { label: 'Funcionário', key: 'nome' }, { label: 'Função', key: 'funcao' },
    { label: 'Horas trabalhadas', get: (r) => hm(r.trabalhado) }, { label: 'HE 50%', get: (r) => hm(r.extra50) }, { label: 'HE 100%', get: (r) => hm(r.extra100) },
    { label: 'Adicional noturno (h)', get: (r) => hm(r.noturno) }, { label: 'Atrasos (min)', key: 'atraso' }, { label: 'Faltas injustificadas', key: 'faltas' },
    { label: 'Faltas justificadas', key: 'faltas_justificadas' }, { label: 'Dias de atestado', key: 'atestados' }, { label: 'Saldo banco de horas', get: (r) => hm(r.banco_horas) },
    { label: 'Assiduidade %', key: 'assiduidade' },
  ], eq.linhas);

  const ponto = ctx.db.prepare(`SELECT x.*, f.nome FROM ponto x JOIN funcionarios f ON f.id = x.funcionario_id WHERE x.data BETWEEN ? AND ? ${pf} ORDER BY f.nome, x.data`).all(de, ate, ...pp);
  add('RH/02_ponto_detalhado.csv', [
    { label: 'Funcionário', key: 'nome' }, { label: 'Data', key: 'data' }, { label: 'Entrada', key: 'entrada' }, { label: 'Saída intervalo', key: 'saida_intervalo' },
    { label: 'Retorno', key: 'retorno_intervalo' }, { label: 'Saída', key: 'saida' }, { label: 'Ocorrência', key: 'ocorrencia' }, { label: 'HE aprovada', get: (r) => (r.he_aprovada ? 'Sim' : 'Não') },
  ], ponto);

  const faltas = ctx.db.prepare(`SELECT x.*, f.nome FROM faltas_caixa x JOIN funcionarios f ON f.id = x.funcionario_id WHERE x.data BETWEEN ? AND ? ${pf} ORDER BY f.nome, x.data`).all(de, ate, ...pp);
  add('RH/03_faltas_caixa.csv', [
    { label: 'Funcionário', key: 'nome' }, { label: 'Data', key: 'data' }, { label: 'Valor', key: 'valor' }, { label: 'Tratamento', key: 'tratamento' },
    { label: 'Termo anexado', get: (r) => (r.autorizacao && r.autorizacao !== '[]' ? 'Sim' : 'Não') },
  ], faltas);

  const com = rh.comissoes(sys, comp);
  add('RH/04_comissoes_grid.csv', [{ label: 'Funcionário', key: 'nome' }, { label: 'Vendas grid', key: 'vendas' }, { label: 'Comissão', key: 'comissao' }, { label: 'Meta', key: 'meta' }], com.ranking);

  // LGPD: atestados vão sem CID (minimização de dados de saúde)
  const atest = ctx.db.prepare(`SELECT x.data_inicio, x.dias, f.nome FROM atestados x JOIN funcionarios f ON f.id = x.funcionario_id WHERE x.data_inicio BETWEEN ? AND ? ${pf}`).all(de, ate, ...pp);
  add('RH/05_atestados.csv', [{ label: 'Funcionário', key: 'nome' }, { label: 'Início', key: 'data_inicio' }, { label: 'Dias', key: 'dias' }], atest);

  const adm = ctx.db.prepare(`SELECT x.nome, x.cpf, x.funcao, x.admissao, x.demissao, x.salario FROM funcionarios x WHERE ((x.admissao BETWEEN ? AND ?) OR (x.demissao BETWEEN ? AND ?)) ${pf}`).all(de, ate, de, ate, ...pp);
  add('RH/06_admissoes_demissoes.csv', [{ label: 'Nome', key: 'nome' }, { label: 'CPF', key: 'cpf' }, { label: 'Função', key: 'funcao' }, { label: 'Admissão', key: 'admissao' }, { label: 'Demissão', key: 'demissao' }, { label: 'Salário', key: 'salario' }], adm);

  const fer = ctx.db.prepare(`SELECT x.*, f.nome FROM ferias x JOIN funcionarios f ON f.id = x.funcionario_id WHERE x.status <> 'cancelada' AND x.inicio BETWEEN ? AND ? ${pf}`).all(de, addDays30(ate), ...pp);
  add('RH/07_ferias.csv', [{ label: 'Funcionário', key: 'nome' }, { label: 'Período aquisitivo', key: 'aquisitivo_inicio' }, { label: 'Início', key: 'inicio' }, { label: 'Dias', key: 'dias' }, { label: 'Abono pecuniário', key: 'abono_pecuniario' }], fer);

  const dec = rh.decimoTerceiro(sys, Number(comp.slice(0, 4)));
  add('RH/08_provisao_13.csv', [{ label: 'Funcionário', key: 'nome' }, { label: 'Remuneração', key: 'remuneracao' }, { label: 'Avos', key: 'avos' }, { label: 'Provisão mensal', key: 'provisao_mensal' }, { label: '1ª parcela', key: 'parcela1' }, { label: '2ª parcela', key: 'parcela2' }], dec.linhas);

  const pagas = ctx.db.prepare(`SELECT x.*, fo.nome AS fornecedor, pc.codigo, pc.nome AS conta FROM contas_pagar x LEFT JOIN fornecedores fo ON fo.id = x.fornecedor_id LEFT JOIN plano_contas pc ON pc.id = x.conta_id
    WHERE x.status = 'paga' AND x.pagamento_data BETWEEN ? AND ? ${pf} ORDER BY x.pagamento_data`).all(de, ate, ...pp);
  add('Financeiro/01_contas_pagas.csv', [
    { label: 'Pagamento', key: 'pagamento_data' }, { label: 'Vencimento', key: 'vencimento' }, { label: 'Fornecedor', key: 'fornecedor' }, { label: 'Descrição', key: 'descricao' },
    { label: 'Documento', key: 'documento' }, { label: 'Conta contábil', get: (r) => `${r.codigo || ''} ${r.conta || ''}`.trim() }, { label: 'Valor', key: 'valor' }, { label: 'Juros/multa', key: 'juros_multa' }, { label: 'Valor pago', key: 'valor_pago' },
  ], pagas);

  const receb = ctx.db.prepare(`SELECT x.*, c.nome AS cliente FROM contas_receber x JOIN clientes c ON c.id = x.cliente_id WHERE x.status = 'recebida' AND x.recebimento_data BETWEEN ? AND ? ${pf}`).all(de, ate, ...pp);
  add('Financeiro/02_contas_recebidas.csv', [{ label: 'Recebimento', key: 'recebimento_data' }, { label: 'Cliente', key: 'cliente' }, { label: 'Descrição', key: 'descricao' }, { label: 'Valor', key: 'valor' }, { label: 'Recebido', key: 'valor_recebido' }], receb);

  const ext = ctx.db.prepare(`SELECT x.*, cb.nome AS conta FROM extrato x JOIN contas_bancarias cb ON cb.id = x.conta_bancaria_id WHERE x.data BETWEEN ? AND ? ${pf} ORDER BY x.data`).all(de, ate, ...pp);
  add('Financeiro/03_extrato_conciliado.csv', [{ label: 'Conta', key: 'conta' }, { label: 'Data', key: 'data' }, { label: 'Histórico', key: 'descricao' }, { label: 'Valor', key: 'valor' }, { label: 'Conciliado com', key: 'conciliado_tipo' }], ext);

  const d = fin.dreMes(sys, comp);
  const dreRows = [
    ['Receita bruta — pista', d.receita_pista], ['Receita bruta — conveniência', d.receita_conveniencia], ['Receita bruta total', d.receita],
    ['(-) CMV pista', -d.cmv_pista], ['(-) CMV conveniência', -d.cmv_conveniencia], ['Lucro bruto', d.lucro_bruto],
    ...d.despesas.map((x) => [`(-) ${x.nome}`, -x.valor]), ['Resultado gerencial', d.resultado],
  ].map(([linha, valor]) => ({ linha, valor: round2(valor) }));
  add('Financeiro/04_dre_gerencial.csv', [{ label: 'Linha', key: 'linha' }, { label: 'Valor', key: 'valor' }], dreRows);

  const vend = ctx.db.prepare(`SELECT x.data, x.origem, x.forma_pagamento, SUM(x.quantidade) AS qtd, SUM(x.valor) AS valor FROM vendas x WHERE x.data BETWEEN ? AND ? ${pf} GROUP BY x.data, x.origem, x.forma_pagamento ORDER BY x.data`).all(de, ate, ...pp);
  add('Financeiro/05_vendas_por_dia.csv', [{ label: 'Data', key: 'data' }, { label: 'Origem', key: 'origem' }, { label: 'Pagamento', key: 'forma_pagamento' }, { label: 'Quantidade', get: (r) => round2(r.qtd) }, { label: 'Valor', get: (r) => round2(r.valor) }], vend);

  files.push({ name: `${comp}/Fiscal/01_LMC.csv`, data: comb.lmcCsv(sys, de, ate) });
  const descargas = ctx.db.prepare(`SELECT x.*, c.nome AS combustivel, fo.nome AS distribuidora FROM descargas x JOIN combustiveis c ON c.id = x.combustivel_id LEFT JOIN fornecedores fo ON fo.id = x.fornecedor_id WHERE x.data BETWEEN ? AND ? ${pf}`).all(de, ate, ...pp);
  add('Fiscal/02_entradas_combustivel.csv', [{ label: 'Data', key: 'data' }, { label: 'NF', key: 'nota' }, { label: 'Distribuidora', key: 'distribuidora' }, { label: 'Produto', key: 'combustivel' }, { label: 'Volume', key: 'volume_nf' }, { label: 'Custo unitário', key: 'custo_unitario' }, { label: 'Situação', key: 'status' }], descargas);
  const notas = ctx.db.prepare(`SELECT x.*, fo.nome AS fornecedor FROM notas_entrada x LEFT JOIN fornecedores fo ON fo.id = x.fornecedor_id WHERE x.data BETWEEN ? AND ? ${pf}`).all(de, ate, ...pp);
  add('Fiscal/03_notas_entrada_conveniencia.csv', [{ label: 'Data', key: 'data' }, { label: 'NF', key: 'numero' }, { label: 'Chave', key: 'chave' }, { label: 'Fornecedor', key: 'fornecedor' }, { label: 'Valor', key: 'valor' }, { label: 'Status', key: 'status' }], notas);

  // anexos: termos de desconto e boletos/notas pagos
  const anexos = [];
  for (const f of faltas) anexos.push(...parseFiles(f.autorizacao).map((a) => ({ ...a, pasta: 'RH/termos_desconto' })));
  for (const p of pagas) anexos.push(...parseFiles(p.anexo).map((a) => ({ ...a, pasta: 'Financeiro/comprovantes' })));
  for (const a of anexos) {
    const meta = ctx.db.prepare('SELECT * FROM arquivos WHERE id = ?').get(a.id);
    const p = path.join(uploadsDir, String(a.id).replace(/[^a-z0-9.-]/gi, ''));
    if (meta && fs.existsSync(p)) files.push({ name: `${comp}/${a.pasta}/${a.id.slice(0, 8)}_${meta.nome}`, data: fs.readFileSync(p) });
  }
  files.push({ name: `${comp}/LEIA-ME.txt`, data: `Pacote mensal — competência ${comp}\r\nGerado em ${new Date().toLocaleString('pt-BR')} por ${ctx.user.nome}.\r\nArquivos CSV separados por ponto e vírgula (abrem no Excel).\r\nAtestados enviados sem CID (LGPD).\r\n` });
  crud.audit(ctx.db, ctx.user, 'gerar_pacote', 'fechamentos', null, null, { competencia: comp, arquivos: files.length });
  return zip(files);
}

function addDays30(d) {
  const x = new Date(d + 'T12:00:00');
  x.setDate(x.getDate() + 30);
  return x.toISOString().slice(0, 10);
}

function parseFiles(v) {
  if (!v) return [];
  try { const a = typeof v === 'string' ? JSON.parse(v) : v; return Array.isArray(a) ? a : []; } catch { return []; }
}

const ITENS_CONTABIL = [
  'Fechamento do DP concluído',
  'LMC do mês conferido e assinado',
  'Conciliação bancária do mês concluída',
  'Conciliação de cartões concluída',
  'Contas pagas com comprovantes anexados',
  'DRE gerencial revisada',
  'Notas de entrada conferidas',
];

function fechamentoContabil(ctx, comp) {
  let f = ctx.db.prepare(`SELECT * FROM fechamentos WHERE tipo = 'contabil' AND competencia = ? ${ctx.postoId ? 'AND posto_id = ?' : ''}`)
    .get(comp, ...(ctx.postoId ? [ctx.postoId] : []));
  if (!f && ctx.user.perfil !== 'contabilidade') {
    f = crud.raw(ctx.db, 'fechamentos', crud.create(ctx, 'fechamentos', { competencia: comp, tipo: 'contabil', itens: ITENS_CONTABIL.map((t) => ({ titulo: t, ok: false })) }, { internal: true }).id);
  }
  return f ? crud.parseRow(crud.resource('fechamentos'), f) : null;
}

function liberar(ctx, id) {
  auth.requireRole(ctx.user, 'gerente', 'financeiro', 'rh');
  const f = crud.raw(ctx.db, 'fechamentos', id);
  if (!f) throw new HttpError(404, 'Fechamento não encontrado');
  const itens = JSON.parse(f.itens || '[]');
  if (itens.some((i) => !i.ok)) throw new HttpError(400, 'Conclua todos os itens do checklist antes de liberar');
  const now = new Date().toISOString();
  crud.update(ctx, 'fechamentos', id, { concluido_at: f.concluido_at || now, enviado_at: now }, { internal: true });
  core.concluirChave(ctx, f.tipo === 'dp' ? 'fechamento_dp' : 'pacote_contabil');
  return { ok: true };
}

module.exports = { zip, pacote, fechamentoContabil, liberar, ITENS_CONTABIL };
