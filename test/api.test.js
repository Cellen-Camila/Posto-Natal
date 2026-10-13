'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const { today, addDays, competencia } = require('../server/util');

let S;
test.before(async () => { S = await startServer(); });
test.after(async () => { await S.close(); });

test('login inválido é recusado e rotas exigem sessão', async () => {
  const r = await fetch(S.base + '/api/login', { method: 'POST', body: JSON.stringify({ login: 'gerente', senha: 'errada' }) });
  assert.equal(r.status, 401);
  const r2 = await S.req('GET', '/api/painel', { as: null });
  assert.equal(r2.status, 401);
});

test('todas as telas de leitura respondem sem erro para o gerente', async () => {
  const comp = competencia(today());
  const urls = [
    '/api/meta', '/api/painel', '/api/alertas', '/api/pista/abertura', '/api/pista/faltas',
    '/api/rh/equipe', '/api/rh/ferias', '/api/rh/decimo', `/api/rh/comissoes?competencia=${comp}`, '/api/rh/epi', '/api/rh/escalas', '/api/rh/fechamento',
    '/api/fin/indicadores', '/api/fin/inadimplencia', '/api/fin/cartoes', '/api/fin/saldo', '/api/fin/caixa-banco', '/api/fin/fluxo', '/api/fin/dre', '/api/fin/juros',
    '/api/conv/vendas', '/api/conv/abc', '/api/conv/parados', '/api/conv/precos', '/api/conv/validade', '/api/conv/perdas',
    `/api/comb/lmc?data=${addDays(today(), -1)}`, `/api/comb/lmc?de=${addDays(today(), -5)}&ate=${today()}`, '/api/comb/tanques', '/api/comb/gnv',
    '/api/precos/painel', '/api/precos/simular?combustivel_id=1&preco=6.39', '/api/precos/evolucao/1', '/api/precos/custos',
    '/api/docs/fiscalizacao', `/api/agenda?de=${today()}&ate=${addDays(today(), 7)}`, '/api/contabil/fechamento', '/api/meu',
  ];
  for (const u of urls) {
    const r = await S.req('GET', u);
    if (u === '/api/meu') { assert.equal(r.status, 200, u); continue; }
    assert.equal(r.status, 200, `${u}: ${JSON.stringify(r.data).slice(0, 200)}`);
  }
  const meta = (await S.req('GET', '/api/meta')).data;
  for (const res of meta.resources) {
    const r = await S.req('GET', `/api/r/${res.name}?limit=5`);
    assert.equal(r.status, 200, `${res.name}: ${JSON.stringify(r.data).slice(0, 200)}`);
    const csv = await S.req('GET', `/api/r/${res.name}?format=csv`, { raw: true });
    assert.equal(csv.status, 200, `csv ${res.name}`);
  }
});

test('painel do gerente traz indicadores, alertas e checklists', async () => {
  const { data } = await S.req('GET', '/api/painel');
  assert.ok(data.vendas.mes.faturamento > 0);
  assert.ok(data.vendas.mes.por_combustivel.length >= 4);
  assert.ok(data.margens.every((m) => m.margem_un > 0));
  assert.ok(data.caixa.saldo_bancario !== undefined);
  assert.ok(data.alertas.contagem.vermelho > 0, 'seed gera alertas críticos');
  assert.ok(data.checklists.total > 0);
  const titulos = data.alertas.lista.map((a) => a.titulo).join(' | ');
  assert.match(titulos, /AVCB|Certificado de regularidade do FGTS/);
  assert.match(titulos, /faltas de caixa no mês/);
});

test('perfis: frentista não vê financeiro; proprietário não vê atestados (LGPD)', async () => {
  assert.equal((await S.req('GET', '/api/r/contas_pagar', { as: 'joao' })).status, 403);
  assert.equal((await S.req('GET', '/api/fin/dre', { as: 'joao' })).status, 403);
  assert.equal((await S.req('GET', '/api/r/atestados', { as: 'dono' })).status, 403);
  assert.equal((await S.req('GET', '/api/r/asos', { as: 'dono' })).status, 403);
  assert.equal((await S.req('GET', '/api/r/atestados', { as: 'rh' })).status, 200);
  // proprietário é somente leitura
  const r = await S.req('POST', '/api/r/fornecedores', { as: 'dono', body: { nome: 'X' } });
  assert.equal(r.status, 403);
  // frentista só vê os próprios registros
  const me = (await S.req('GET', '/api/me', { as: 'joao' })).data;
  const ponto = (await S.req('GET', '/api/r/ponto?limit=50', { as: 'joao' })).data;
  assert.ok(ponto.rows.length > 0);
  assert.ok(ponto.rows.every((p) => p.funcionario_id === me.funcionario_id));
  const meu = (await S.req('GET', '/api/meu', { as: 'joao' })).data;
  assert.ok(Array.isArray(meu.escala) && meu.escala.length > 0);
  // contabilidade só acessa pacote liberado
  assert.equal((await S.req('GET', '/api/r/funcionarios', { as: 'contador' })).status, 403);
});

test('fluxo completo de turno: abertura, caixa com falta, assinatura e fechamento', async () => {
  const data = addDays(today(), 1); // dia sem turno no seed
  const prep = (await S.req('GET', `/api/pista/abertura?data=${data}&periodo=manha`, { as: 'chefe' })).data;
  const frentista = (await S.req('GET', '/api/me', { as: 'maria' })).data;
  const ab = await S.req('POST', '/api/pista/turnos', {
    as: 'chefe',
    body: {
      data, periodo: 'manha', presencas: prep.escalados.map((e) => ({ funcionario_id: e.funcionario_id, presente: true })),
      checklist: { itens: { 0: true } },
      encerrantes: prep.bicos.map((b) => ({ bico_id: b.id, inicial: b.encerrante_atual })),
      medicoes: prep.tanques.map((t) => ({ tanque_id: t.id, volume: 10000 })),
    },
  });
  assert.equal(ab.status, 200, JSON.stringify(ab.data));
  const turnoId = ab.data.turno.id;
  // duplicado é recusado
  assert.equal((await S.req('POST', '/api/pista/turnos', { as: 'chefe', body: { data, periodo: 'manha' } })).status, 409);
  // caixa com falta de R$ 30
  const cx = await S.req('POST', '/api/r/caixas', { as: 'chefe', body: { turno_id: turnoId, funcionario_id: frentista.funcionario_id, dinheiro: 470, pix: 500, sistema_total: 1000, justificativa: 'Troco errado' } });
  assert.equal(cx.status, 200, JSON.stringify(cx.data));
  assert.equal(cx.data.diferenca, -30);
  const falta = S.db.prepare('SELECT * FROM faltas_caixa WHERE caixa_id = ?').get(cx.data.id);
  assert.equal(falta.valor, 30);
  // assinatura com credenciais erradas falha; com as do frentista funciona
  assert.equal((await S.req('POST', `/api/pista/assinar/caixas/${cx.data.id}`, { as: 'chefe', body: { login: 'joao', senha: 'posto123' } })).status, 401);
  assert.equal((await S.req('POST', `/api/pista/assinar/caixas/${cx.data.id}`, { as: 'chefe', body: { login: 'maria', senha: 'posto123' } })).status, 200);
  // desconto em folha exige termo anexado
  const semTermo = await S.req('PUT', `/api/r/faltas_caixa/${falta.id}`, { as: 'chefe', body: { tratamento: 'desconto' } });
  assert.equal(semTermo.status, 400);
  // abono pelo chefe vira solicitação; gerente aprova
  const ab2 = await S.req('PUT', `/api/r/faltas_caixa/${falta.id}`, { as: 'chefe', body: { tratamento: 'abonado' } });
  assert.equal(ab2.data.tratamento, 'abono_solicitado');
  const ap = S.db.prepare("SELECT * FROM aprovacoes WHERE ref_tabela = 'faltas_caixa' AND ref_id = ?").get(falta.id);
  assert.equal((await S.req('POST', `/api/aprovacoes/${ap.id}`, { as: 'chefe', body: { aprovado: true } })).status, 403);
  assert.equal((await S.req('POST', `/api/aprovacoes/${ap.id}`, { body: { aprovado: true } })).status, 200);
  assert.equal(S.db.prepare('SELECT tratamento FROM faltas_caixa WHERE id = ?').get(falta.id).tratamento, 'abonado');
  // fechamento exige encerrante final >= inicial
  const det = (await S.req('GET', `/api/pista/turnos/${turnoId}`, { as: 'chefe' })).data;
  const bad = await S.req('POST', `/api/pista/turnos/${turnoId}/fechar`, { as: 'chefe', body: { encerrantes: det.encerrantes.map((e) => ({ id: e.id, final: e.inicial - 1 })) } });
  assert.equal(bad.status, 400);
  const fe = await S.req('POST', `/api/pista/turnos/${turnoId}/fechar`, {
    as: 'chefe', body: { encerrantes: det.encerrantes.map((e) => ({ id: e.id, final: e.inicial + 100 })), medicoes: prep.tanques.map((t) => ({ tanque_id: t.id, volume: 9800 })) },
  });
  assert.equal(fe.status, 200, JSON.stringify(fe.data));
  assert.equal(fe.data.turno.status, 'fechado');
  assert.ok(fe.data.encerrantes.every((e) => e.litros === 100));
  // auditoria registrou as ações
  const aud = S.db.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE tabela IN ('turnos','caixas','faltas_caixa')").get().n;
  assert.ok(aud >= 4);
});

test('descarga reprovada no teste de qualidade fica bloqueada', async () => {
  const tanque = S.db.prepare("SELECT t.* FROM tanques t JOIN combustiveis c ON c.id = t.combustivel_id WHERE c.tipo_teste = 'gasolina' LIMIT 1").get();
  const r = await S.req('POST', '/api/r/descargas', { body: { data: today(), combustivel_id: tanque.combustivel_id, tanque_id: tanque.id, nota: '999', volume_nf: 5000, custo_unitario: 5.8, teor_etanol: 35, densidade: 740, aspecto: 'ok', cor: 'ok' } });
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'recusada');
  assert.match(r.data.reprovacoes, /etanol/);
  const edit = await S.req('PUT', `/api/r/descargas/${r.data.id}`, { as: 'financeiro', body: { teor_etanol: 30 } });
  assert.equal(edit.status, 403);
});

test('LMC calcula perda/sobra e marca fora da tolerância', async () => {
  const d = addDays(today(), -2);
  const { data } = await S.req('GET', `/api/comb/lmc?data=${d}`);
  const gc = data.find((l) => l.combustivel === 'Gasolina comum');
  assert.ok(gc.fora_tolerancia, JSON.stringify(gc));
  assert.ok(gc.perda_sobra < 0);
  const ok = data.find((l) => l.combustivel === 'Diesel S10');
  assert.equal(ok.fora_tolerancia, false);
  assert.equal(Math.round((ok.estoque_abertura + ok.recebimentos - ok.vendas) * 100) / 100, ok.estoque_escritural);
});

test('contas a pagar acima do limite pedem aprovação; estorno também', async () => {
  const r = await S.req('POST', '/api/r/contas_pagar', { as: 'financeiro', body: { descricao: 'Reforma', valor: 12000, vencimento: addDays(today(), 10) } });
  assert.equal(r.data.status, 'aguardando_aprovacao');
  const pagar = await S.req('PUT', `/api/r/contas_pagar/${r.data.id}`, { as: 'financeiro', body: { status: 'paga' } });
  assert.equal(pagar.status, 400);
  const ap = S.db.prepare("SELECT id FROM aprovacoes WHERE ref_tabela = 'contas_pagar' AND ref_id = ?").get(r.data.id);
  await S.req('POST', `/api/aprovacoes/${ap.id}`, { body: { aprovado: true } });
  const pagar2 = await S.req('PUT', `/api/r/contas_pagar/${r.data.id}`, { as: 'financeiro', body: { status: 'paga' } });
  assert.equal(pagar2.status, 200);
  assert.equal(pagar2.data.valor_pago, 12000);
  const est = await S.req('PUT', `/api/r/contas_pagar/${r.data.id}`, { as: 'financeiro', body: { status: 'estornada' } });
  assert.equal(est.data.status, 'paga');
  assert.ok(S.db.prepare("SELECT 1 FROM aprovacoes WHERE tipo = 'estorno' AND ref_id = ? AND status = 'pendente'").get(r.data.id));
});

test('importação OFX concilia automaticamente com pagamento', async () => {
  const cp = await S.req('POST', '/api/r/contas_pagar', { body: { descricao: 'Teste OFX', valor: 321.45, vencimento: today(), status: 'paga', pagamento_data: today() } });
  assert.equal(cp.status, 200);
  const ofx = `OFXHEADER:100\n<OFX><BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>${today().replace(/-/g, '')}120000<TRNAMT>-321.45<FITID>T1<MEMO>PAG BOLETO TESTE</STMTTRN></BANKTRANLIST></OFX>`;
  const r = await S.req('POST', '/api/fin/ofx', { as: 'financeiro', body: { conta_bancaria_id: 1, texto: ofx } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.novos, 1);
  const e = S.db.prepare("SELECT * FROM extrato WHERE fitid = 'T1'").get();
  assert.equal(e.conciliado_tipo, 'contas_pagar');
  assert.equal(e.conciliado_id, cp.data.id);
  // reimportar não duplica
  const r2 = await S.req('POST', '/api/fin/ofx', { as: 'financeiro', body: { conta_bancaria_id: 1, texto: ofx } });
  assert.equal(r2.data.novos, 0);
});

test('NF-e XML importada e conferida atualiza estoque e custo', async () => {
  const xml = `<nfeProc><NFe><infNFe Id="NFe24261012345678000190550010000123451000012345"><ide><nNF>12345</nNF><dhEmi>${today()}T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>11222333000144</CNPJ><xNome>Fornecedor XML</xNome></emit>
    <det nItem="1"><prod><cProd>7891</cProd><cEAN>SEM GTIN</cEAN><xProd>AGUA</xProd><uCom>UN</uCom><qCom>10.0000</qCom><vUnCom>1.2000</vUnCom><vProd>12.00</vProd></prod></det>
    <total><ICMSTot><vNF>12.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
  const r = await S.req('POST', '/api/conv/nfe', { as: 'conveniencia', body: { xml } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.itens[0].produto, 'Água mineral 500 ml');
  const antes = S.db.prepare("SELECT estoque FROM produtos WHERE codigo = '7891'").get().estoque;
  const c = await S.req('POST', `/api/conv/notas/${r.data.id}/conferir`, { as: 'conveniencia', body: { itens: [{ idx: 0, qtd_recebida: 9, validade: addDays(today(), 200) }] } });
  assert.equal(c.data.divergente, true);
  assert.equal(c.data.alertas_preco.length, 1);
  const p = S.db.prepare("SELECT estoque, custo FROM produtos WHERE codigo = '7891'").get();
  assert.equal(p.estoque, antes + 9);
  assert.equal(p.custo, 1.2);
  assert.equal((await S.req('POST', '/api/conv/nfe', { as: 'conveniencia', body: { xml } })).status, 409);
});

test('contagem com divergência só ajusta estoque após aprovação do gerente', async () => {
  const p = S.db.prepare("SELECT * FROM produtos WHERE codigo = '7902'").get();
  const r = await S.req('POST', '/api/conv/contagem', { as: 'conveniencia', body: { itens: [{ produto_id: p.id, contado: p.estoque - 5 }] } });
  assert.equal(r.data.divergentes, 1);
  assert.equal(S.db.prepare('SELECT estoque FROM produtos WHERE id = ?').get(p.id).estoque, p.estoque);
  const c = S.db.prepare('SELECT id FROM contagens WHERE produto_id = ? ORDER BY id DESC').get(p.id);
  const ap = S.db.prepare("SELECT id FROM aprovacoes WHERE ref_tabela = 'contagens' AND ref_id = ?").get(c.id);
  await S.req('POST', `/api/aprovacoes/${ap.id}`, { body: { aprovado: true } });
  assert.equal(S.db.prepare('SELECT estoque FROM produtos WHERE id = ?').get(p.id).estoque, p.estoque - 5);
});

test('alteração de preço gera histórico e tarefa de atualizar o painel', async () => {
  const r = await S.req('POST', '/api/precos/alterar', { body: { combustivel_id: 3, preco: 4.69, motivo: 'Reajuste da distribuidora' } });
  assert.equal(r.status, 200);
  assert.equal(S.db.prepare('SELECT preco_bomba FROM combustiveis WHERE id = 3').get().preco_bomba, 4.69);
  const t = S.db.prepare("SELECT * FROM tarefas WHERE obs = ?").get(`historico:${r.data.id}`);
  assert.ok(t);
  await S.req('POST', `/api/tarefas/${t.id}/concluir`, { as: 'chefe', body: {} });
  assert.equal(S.db.prepare('SELECT painel_atualizado FROM historico_precos WHERE id = ?').get(r.data.id).painel_atualizado, 1);
  assert.equal((await S.req('POST', '/api/precos/alterar', { as: 'chefe', body: { combustivel_id: 3, preco: 1, motivo: 'x' } })).status, 403);
});

test('EPI com CA vencido não pode ser entregue', async () => {
  const item = S.db.prepare("SELECT * FROM epi_itens WHERE ca_validade < ? AND tipo = 'epi'").get(today());
  const r = await S.req('POST', '/api/r/epi_entregas', { as: 'rh', body: { funcionario_id: 5, item_id: item.id, data: today(), quantidade: 1 } });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /CA/);
});

test('autoatendimento: frentista assina EPI e confirma comunicado', async () => {
  const meu = (await S.req('GET', '/api/meu', { as: 'joao' })).data;
  const me = (await S.req('GET', '/api/me', { as: 'joao' })).data;
  const ent = S.db.prepare('INSERT INTO epi_entregas (funcionario_id, item_id, quantidade, data) VALUES (?, 1, 1, ?)').run(me.funcionario_id, today());
  const r = await S.req('POST', `/api/meu/assinar/epi/${ent.lastInsertRowid}`, { as: 'joao' });
  assert.equal(r.status, 200);
  const outro = S.db.prepare('SELECT id FROM epi_entregas WHERE funcionario_id <> ? LIMIT 1').get(me.funcionario_id);
  assert.equal((await S.req('POST', `/api/meu/assinar/epi/${outro.id}`, { as: 'joao' })).status, 403);
  if (meu.comunicados.length) {
    assert.equal((await S.req('POST', `/api/meu/assinar/comunicado/${meu.comunicados[0].id}`, { as: 'joao' })).status, 200);
  }
});

test('pacote contábil: gerado como ZIP e liberado à contabilidade só após checklist', async () => {
  const comp = competencia(addDays(today().slice(0, 8) + '01', -1));
  const zip = await S.req('GET', `/api/contabil/pacote?competencia=${comp}`, { raw: true });
  assert.equal(zip.status, 200);
  const buf = Buffer.from(await zip.arrayBuffer());
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  assert.ok(buf.includes(Buffer.from(`${comp}/Fiscal/01_LMC.csv`)));
  assert.equal((await S.req('GET', `/api/contabil/pacote?competencia=${comp}`, { as: 'contador' })).status, 403);
  const f = (await S.req('GET', `/api/contabil/fechamento?competencia=${comp}`)).data;
  assert.equal((await S.req('POST', `/api/fechamentos/${f.id}/liberar`)).status, 400);
  await S.req('PUT', `/api/fechamentos/${f.id}/itens`, { body: { itens: f.itens.map((i) => ({ ...i, ok: true })) } });
  assert.equal((await S.req('POST', `/api/fechamentos/${f.id}/liberar`)).status, 200);
  assert.equal((await S.req('GET', `/api/contabil/pacote?competencia=${comp}`, { as: 'contador', raw: true })).status, 200);
});

test('upload e download de arquivo anexado', async () => {
  const up = await S.req('POST', '/api/upload', { body: { nome: 'termo.pdf', tipo: 'application/pdf', dados: Buffer.from('%PDF-1.4 teste').toString('base64') } });
  assert.equal(up.status, 200);
  const tok = (await (await fetch(S.base + '/api/login', { method: 'POST', body: JSON.stringify({ login: 'gerente', senha: 'posto123' }) })).json()).token;
  const r = await fetch(`${S.base}/api/files/${up.data.id}?token=${tok}`);
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '%PDF-1.4 teste');
});

test('implantação real: banco vazio, troca de senha obrigatória e bloqueio por tentativas', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { open } = require('../server/db');
  const { createApp } = require('../server/app');
  const { setupInicial } = require('../server/seed');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posto-real-'));
  const db = open(path.join(dir, 'posto.db'));
  setupInicial(db, { posto: 'Posto Teste', senha: 'provisoria1' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM funcionarios').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM vendas').get().n, 0);
  assert.ok(db.prepare('SELECT COUNT(*) AS n FROM tarefas_modelo').get().n > 20);
  const server = createApp({ db, dataDir: dir }).server();
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (m, u, body, tok) => fetch(base + u, { method: m, headers: { 'content-type': 'application/json', ...(tok ? { authorization: `Bearer ${tok}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  try {
    const info = await (await call('GET', '/api/info')).json();
    assert.deepEqual(info, { demo: false, posto: 'Posto Teste' });
    const { token, user } = await (await call('POST', '/api/login', { login: 'gerente', senha: 'provisoria1' })).json();
    assert.equal(user.trocar_senha, 1);
    assert.equal((await call('GET', '/api/painel', null, token)).status, 403);
    assert.equal((await call('POST', '/api/me/senha', { atual: 'provisoria1', nova: 'curta' }, token)).status, 400);
    assert.equal((await call('POST', '/api/me/senha', { atual: 'provisoria1', nova: 'MinhaSenha2026' }, token)).status, 200);
    assert.equal((await call('GET', '/api/painel', null, token)).status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/login', { login: 'gerente', senha: 'errada' })).status, 401);
    assert.equal((await call('POST', '/api/login', { login: 'gerente', senha: 'MinhaSenha2026' })).status, 429);
  } finally {
    await new Promise((r) => server.close(r));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('importação da programação de férias da contabilidade', async () => {
  const csv = '﻿codigo;nome;admissao;aquisitivo_inicio;aquisitivo_fim;dias_restantes;data_base\r\n'
    + '54;Anne Karine Teste;01/03/2021;01/03/2025;28/02/2026;15;17/07/2026\r\n'
    + '54;Anne Karine Teste;01/03/2021;01/03/2026;28/02/2027;30;17/07/2026\r\n'
    + '8;Joao Batista Silva;01/10/2020;01/10/2022;30/09/2023;30;17/07/2026\r\n';
  const r = await S.req('POST', '/api/rh/ferias/importar', { as: 'rh', body: { texto: csv } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.criados, ['Anne Karine Teste']);
  assert.deepEqual(r.data.atualizados, ['João Batista Silva']); // casa sem acento
  const { situacao } = (await S.req('GET', '/api/rh/ferias', { as: 'rh' })).data;
  const anne = situacao.filter((x) => x.nome === 'Anne Karine Teste');
  assert.equal(anne[0].limite_gozo, '2027-02-14');
  assert.equal(anne[0].dias_restantes, 15);
  const joao = situacao.filter((x) => x.nome === 'João Batista Silva');
  assert.equal(joao[0].aquisitivo_inicio, '2022-10-01');
  assert.equal(joao[0].situacao, 'vencida_dobro');
  assert.equal((await S.req('POST', '/api/rh/ferias/importar', { as: 'joao', body: { texto: csv } })).status, 403);
});
