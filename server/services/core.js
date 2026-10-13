'use strict';
// Serviços transversais: aprovações do gerente, agenda de obrigações recorrentes
// e envio de notificações (WhatsApp / e-mail).

const crud = require('../crud');
const { param } = require('../db');
const { today, addDays, weekday, parseDate, HttpError } = require('../util');

// ------------------------------------------------------------------ Aprovações
const approvalHandlers = {}; // tipo -> { aprovar(ctx, ap), recusar(ctx, ap) }

function onApproval(tipo, handler) {
  approvalHandlers[tipo] = handler;
}

function solicitarAprovacao(ctx, { tipo, descricao, ref_tabela, ref_id, valor }) {
  const existing = ctx.db.prepare("SELECT id FROM aprovacoes WHERE tipo = ? AND ref_tabela = ? AND ref_id = ? AND status = 'pendente'")
    .get(tipo, ref_tabela, ref_id);
  if (existing) return existing;
  return crud.create(ctx, 'aprovacoes', {
    tipo, descricao, ref_tabela, ref_id, valor: valor ?? null, status: 'pendente', solicitado_por: ctx.user?.id,
  }, { internal: true });
}

function decidir(ctx, id, aprovado, motivo) {
  if (ctx.user.perfil !== 'gerente') throw new HttpError(403, 'Somente o gerente aprova');
  const ap = crud.raw(ctx.db, 'aprovacoes', id);
  if (!ap) throw new HttpError(404, 'Aprovação não encontrada');
  if (ap.status !== 'pendente') throw new HttpError(400, 'Aprovação já decidida');
  const h = approvalHandlers[ap.tipo];
  if (h) (aprovado ? h.aprovar : h.recusar)?.(ctx, ap);
  return crud.update(ctx, 'aprovacoes', id, {
    status: aprovado ? 'aprovado' : 'recusado', decidido_por: ctx.user.id, decidido_at: new Date().toISOString(), motivo: motivo || null,
  }, { internal: true });
}

// ------------------------------------------------------------------ Tarefas
function modeloOcorreEm(m, data) {
  const d = parseDate(data);
  const dia = d.getDate();
  const mes = d.getMonth() + 1;
  const meses = String(m.meses || '').split(',').map((x) => Number(x.trim())).filter(Boolean);
  switch (m.frequencia) {
    case 'diaria': return true;
    case 'semanal': return weekday(data) === (m.dia_semana ?? 1);
    case 'mensal': return dia === (m.dia_mes || 1);
    case 'semestral': return dia === (m.dia_mes || 1) && (meses.length ? meses : [1, 7]).includes(mes);
    case 'anual': return dia === (m.dia_mes || 1) && (meses.length ? meses : [1]).includes(mes);
    default: return false;
  }
}

// Gera as instâncias de tarefas recorrentes para um intervalo (idempotente)
function gerarTarefas(db, de = addDays(today(), -1), ate = addDays(today(), 7)) {
  const modelos = db.prepare('SELECT * FROM tarefas_modelo WHERE ativo = 1').all();
  const exists = db.prepare('SELECT 1 FROM tarefas WHERE modelo_id = ? AND data_prevista = ? AND (posto_id IS ? OR posto_id = ?)');
  const ins = db.prepare(`INSERT INTO tarefas (posto_id, titulo, modelo_id, modulo, data_prevista, hora_limite, perfil, responsavel_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  let n = 0;
  for (let d = de; d <= ate; d = addDays(d, 1)) {
    for (const m of modelos) {
      if (!modeloOcorreEm(m, d)) continue;
      if (exists.get(m.id, d, m.posto_id, m.posto_id)) continue;
      const now = new Date().toISOString();
      ins.run(m.posto_id, m.titulo, m.id, m.modulo, d, m.hora_limite, m.perfil, m.responsavel_id, now, now);
      n++;
    }
  }
  return n;
}

// Conclui automaticamente a tarefa do dia ligada a uma rotina do sistema
function concluirChave(ctx, chave, data = today()) {
  const rows = ctx.db.prepare(`SELECT t.id FROM tarefas t JOIN tarefas_modelo m ON m.id = t.modelo_id
    WHERE m.chave = ? AND t.data_prevista = ? AND t.concluida_at IS NULL ${ctx.postoId ? 'AND (t.posto_id = ? OR t.posto_id IS NULL)' : ''}`)
    .all(chave, data, ...(ctx.postoId ? [ctx.postoId] : []));
  for (const r of rows) {
    ctx.db.prepare('UPDATE tarefas SET concluida_at = ?, concluida_por = ?, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), ctx.user?.id ?? null, new Date().toISOString(), r.id);
  }
  return rows.length;
}

function statusTarefa(t, agora = new Date()) {
  if (t.concluida_at) return 'concluida';
  const hoje = today();
  if (t.data_prevista < hoje) return 'atrasada';
  if (t.data_prevista === hoje && t.hora_limite) {
    const [h, m] = t.hora_limite.split(':').map(Number);
    if (agora.getHours() * 60 + agora.getMinutes() > h * 60 + m) return 'atrasada';
  }
  return 'pendente';
}

// ------------------------------------------------------------------ Notificações
async function enviarNotificacao(db, { canal, destino, mensagem, chave }) {
  if (chave && db.prepare('SELECT 1 FROM notificacoes WHERE chave = ?').get(chave)) return false;
  const url = param(db, canal === 'email' ? 'webhook_email' : 'webhook_whatsapp', '');
  let status = 'registrado (integração não configurada)';
  if (url && destino) {
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ canal, destino, mensagem }),
        signal: AbortSignal.timeout(8000),
      });
      status = res.ok ? 'enviado' : `erro HTTP ${res.status}`;
    } catch (e) {
      status = `erro: ${e.message}`;
    }
  }
  db.prepare('INSERT INTO notificacoes (at, canal, destino, mensagem, status, chave, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), canal, destino || '', mensagem, status, chave || null, new Date().toISOString());
  return true;
}

module.exports = { onApproval, solicitarAprovacao, decidir, gerarTarefas, concluirChave, statusTarefa, modeloOcorreEm, enviarNotificacao };
