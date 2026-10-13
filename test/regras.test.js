'use strict';
process.env.TZ = 'America/Fortaleza';
const test = require('node:test');
const assert = require('node:assert/strict');
const rh = require('../server/services/rh');
const fin = require('../server/services/financeiro');
const conv = require('../server/services/conveniencia');
const { zip } = require('../server/services/contabil');
const { modeloOcorreEm } = require('../server/services/core');
const { addMonths, monthEnd } = require('../server/util');

test('ponto: jornada normal dentro da tolerância não gera saldo', () => {
  const c = rh.calcularDia({ entrada: '06:05', saida_intervalo: '10:00', retorno_intervalo: '11:00', saida: '14:25' }, { jornada_min: 440, horario_entrada: '06:00' });
  assert.equal(c.trabalhado, 235 + 205);
  assert.equal(c.saldo, 0);
  assert.equal(c.atraso, 0);
});

test('ponto: hora extra 50%, atraso e falta injustificada', () => {
  const he = rh.calcularDia({ entrada: '06:30', saida_intervalo: '10:00', retorno_intervalo: '11:00', saida: '16:00' }, { jornada_min: 440, horario_entrada: '06:00' });
  assert.equal(he.atraso, 30);
  assert.equal(he.extra50, 510 - 440);
  const falta = rh.calcularDia({ ocorrencia: 'falta_injustificada' }, { jornada_min: 440 });
  assert.equal(falta.saldo, -440);
  assert.equal(falta.falta, 1);
  const feriado = rh.calcularDia({ entrada: '06:00', saida: '12:00', feriado: 1 }, { jornada_min: 440 });
  assert.equal(feriado.extra100, 360);
});

test('ponto: adicional noturno com hora reduzida e virada de dia', () => {
  assert.equal(rh.minutosNoturnos(22 * 60, 5 * 60), 420);
  const c = rh.calcularDia({ entrada: '19:00', saida_intervalo: '01:00', retorno_intervalo: '02:00', saida: '07:00' }, { jornada_min: 660, horario_entrada: '19:00' });
  assert.equal(c.trabalhado, 660);
  // 22h–1h (180) + 2h–5h (180) = 360 min reais → 411 min reduzidos
  assert.equal(c.noturno, Math.round(360 * 60 / 52.5));
});

test('AFD: layouts Portaria 1510 e 671', () => {
  const antigo = '000000001312102026063001234567890123\n000000002312102026143001234567890123';
  const m1 = rh.parseAfd(antigo);
  assert.deepEqual(m1[0], { data: '2026-10-12', hora: '06:30', id: '012345678901' });
  const novo = '0000000013' + '2026-10-12T06:30:00-0300' + '012345678901' + 'ABCD';
  const m2 = rh.parseAfd(novo);
  assert.equal(m2[0].data, '2026-10-12');
  assert.equal(m2[0].hora, '06:30');
  assert.equal(m2[0].id, '012345678901');
});

test('OFX: leitura de lançamentos', () => {
  const l = fin.parseOfx('<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261010<TRNAMT>150,25<FITID>abc<MEMO>PIX RECEBIDO</STMTTRN>');
  assert.deepEqual(l[0], { data: '2026-10-10', valor: 150.25, fitid: 'abc', descricao: 'PIX RECEBIDO' });
});

test('NF-e: leitura de itens com namespace', () => {
  const nf = conv.parseNfe('<nfe:NFe><nfe:infNFe Id="NFe12345678901234567890123456789012345678901234"><nfe:ide><nfe:nNF>77</nfe:nNF><nfe:dhEmi>2026-10-01T08:00:00-03:00</nfe:dhEmi></nfe:ide><nfe:det nItem="1"><nfe:prod><nfe:cProd>A1</nfe:cProd><nfe:xProd>Item</nfe:xProd><nfe:qCom>2</nfe:qCom><nfe:vUnCom>3.5</nfe:vUnCom><nfe:vProd>7</nfe:vProd></nfe:prod></nfe:det></nfe:infNFe></nfe:NFe>');
  assert.equal(nf.numero, '77');
  assert.equal(nf.data, '2026-10-01');
  assert.equal(nf.itens[0].qtd_nf, 2);
  assert.equal(nf.chave.length, 44);
});

test('agenda: regras de recorrência', () => {
  assert.ok(modeloOcorreEm({ frequencia: 'diaria' }, '2026-10-13'));
  assert.ok(modeloOcorreEm({ frequencia: 'semanal', dia_semana: 2 }, '2026-10-13')); // terça
  assert.ok(!modeloOcorreEm({ frequencia: 'semanal', dia_semana: 1 }, '2026-10-13'));
  assert.ok(modeloOcorreEm({ frequencia: 'mensal', dia_mes: 13 }, '2026-10-13'));
  assert.ok(modeloOcorreEm({ frequencia: 'semestral', dia_mes: 15, meses: '1,7' }, '2026-07-15'));
  assert.ok(!modeloOcorreEm({ frequencia: 'anual', dia_mes: 15, meses: '1' }, '2026-07-15'));
});

test('datas: soma de meses respeita fim de mês', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(monthEnd('2028-02-10'), '2028-02-29');
});

test('zip: estrutura válida', () => {
  const b = zip([{ name: 'a.txt', data: 'olá' }]);
  assert.equal(b.readUInt32LE(0), 0x04034b50);
  assert.equal(b.readUInt32LE(b.length - 22), 0x06054b50);
});
