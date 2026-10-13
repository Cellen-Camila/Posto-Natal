'use strict';
// Módulo Documentos, Licenças e Alvarás.

const crud = require('../crud');
const { param, paramNum } = require('../db');
const { today, diffDays } = require('../util');

function statusDocumento(db, d, ref = today()) {
  const aVencer = paramNum(db, 'a_vencer_dias', 30);
  if (!d.validade) return { status: d.em_renovacao ? 'em_renovacao' : 'sem_validade', dias: null };
  const dias = diffDays(ref, d.validade);
  if (d.em_renovacao) return { status: 'em_renovacao', dias };
  if (dias < 0) return { status: 'vencido', dias };
  if (dias <= aVencer) return { status: 'a_vencer', dias };
  return { status: 'em_dia', dias };
}

function corPorDias(dias) {
  if (dias == null) return 'verde';
  if (dias < 0 || dias <= 7) return 'vermelho';
  if (dias <= 15) return 'amarelo';
  return 'verde';
}

crud.registerHooks('documentos', {
  decorate(ctx, rows) {
    return rows.map((r) => {
      const s = statusDocumento(ctx.db, r);
      return { ...r, _status: s.status, _dias: s.dias, _cor: s.status === 'em_renovacao' ? 'amarelo' : corPorDias(s.dias) };
    });
  },
});

function avisosDias(db) {
  return String(param(db, 'avisos_dias', '90,60,30,15,7')).split(',').map(Number).filter((n) => n > 0).sort((a, b) => b - a);
}

function pastaFiscalizacao(ctx) {
  const { rows } = crud.list(ctx, 'documentos', { limit: 1000 });
  return rows.filter((r) => r.fiscalizacao && r._status !== 'vencido').map((r) => ({
    id: r.id, nome: r.nome, categoria: r.categoria, orgao: r.orgao, numero: r.numero, validade: r.validade,
    status: r._status, protocolo: r.protocolo, arquivo: r.arquivo,
  }));
}

module.exports = { statusDocumento, corPorDias, avisosDias, pastaFiscalizacao };
