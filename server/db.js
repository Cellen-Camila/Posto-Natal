'use strict';
// Banco SQLite (módulo nativo node:sqlite). O esquema é derivado de resources.js
// e migrado automaticamente (tabelas e colunas novas) a cada inicialização.

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { RESOURCES } = require('./resources');

const SQL_TYPES = {
  text: 'TEXT', textarea: 'TEXT', select: 'TEXT', date: 'TEXT', datetime: 'TEXT', time: 'TEXT',
  json: 'TEXT', files: 'TEXT', password: 'TEXT',
  number: 'REAL', money: 'REAL', money3: 'REAL', int: 'INTEGER', bool: 'INTEGER', ref: 'INTEGER',
};

// Parâmetros configuráveis (regras legais e municipais mudam — PRD seção 13)
const DEFAULT_PARAMS = [
  ['pista', 'falta_caixa_limite_valor', '50', 'Alerta de falta de caixa acima deste valor (R$)'],
  ['pista', 'falta_caixa_limite_qtd', '3', 'Alerta quando o frentista tiver este nº de faltas no mês'],
  ['rh', 'tolerancia_ponto_min', '10', 'Tolerância diária de atraso/extra (min) — CLT art. 58 §1º'],
  ['rh', 'limite_he_mes_min', '2640', 'Limite de horas extras no mês por funcionário (min)'],
  ['rh', 'limite_he_dia_min', '120', 'Limite de horas extras por dia (min)'],
  ['rh', 'atestado_inss_dias', '15', 'Dias de atestado (60 dias) para encaminhar ao INSS'],
  ['financeiro', 'aprovacao_pagar_acima', '5000', 'Contas a pagar acima deste valor exigem aprovação do gerente'],
  ['financeiro', 'bloqueio_dias_atraso', '30', 'Bloquear cliente a prazo com título vencido há mais de N dias'],
  ['financeiro', 'cartao_tolerancia', '0.05', 'Tolerância de divergência no crédito de cartão (R$)'],
  ['combustiveis', 'lmc_tolerancia_pct', '0.6', 'Tolerância de perda/sobra no LMC (% do volume disponível) — confirmar regra ANP vigente'],
  ['combustiveis', 'etanol_gasolina_pct', '30', 'Teor obrigatório de etanol anidro na gasolina C (%)'],
  ['combustiveis', 'etanol_gasolina_tol', '1', 'Tolerância do teor de etanol (pontos percentuais)'],
  ['combustiveis', 'densidade_gasolina', '715-770', 'Faixa de massa específica aceitável da gasolina (kg/m³)'],
  ['combustiveis', 'densidade_etanol', '805.2-811.2', 'Faixa de massa específica do etanol hidratado (kg/m³)'],
  ['combustiveis', 'densidade_diesel', '815-865', 'Faixa de massa específica do diesel (kg/m³)'],
  ['combustiveis', 'amostra_guarda_dias', '30', 'Dias de guarda da amostra-testemunha'],
  ['combustiveis', 'afericao_tolerancia_ml', '100', 'Erro máximo admissível na aferição de 20 L (mL)'],
  ['combustiveis', 'dias_estoque_alerta', '2', 'Alertar quando o estoque do tanque durar menos que N dias'],
  ['conveniencia', 'temp_geladeira_max', '7', 'Temperatura máxima de geladeiras (°C)'],
  ['conveniencia', 'temp_freezer_max', '-15', 'Temperatura máxima de freezers (°C)'],
  ['conveniencia', 'margem_alerta_pp', '3', 'Alertar quando a margem ficar N pontos abaixo da margem-alvo'],
  ['precos', 'pesquisa_dias', '2', 'Alertar se não houver pesquisa de preço há N dias'],
  ['precos', 'elasticidade', '-1.5', 'Elasticidade-preço estimada do volume (simulador)'],
  ['documentos', 'avisos_dias', '90,60,30,15,7', 'Dias de antecedência dos avisos de vencimento'],
  ['documentos', 'a_vencer_dias', '30', 'Documento passa a "a vencer" com N dias'],
  ['notificacoes', 'webhook_whatsapp', '', 'URL do webhook/API de WhatsApp (vazio = só registra)'],
  ['notificacoes', 'webhook_email', '', 'URL do webhook de e-mail (vazio = só registra)'],
];

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  for (const r of RESOURCES) {
    const cols = ['id INTEGER PRIMARY KEY AUTOINCREMENT'];
    if (r.posto) cols.push('posto_id INTEGER');
    for (const f of r.fields) cols.push(`"${f.name}" ${SQL_TYPES[f.type] || 'TEXT'}`);
    cols.push('created_at TEXT', 'updated_at TEXT', 'created_by INTEGER');
    db.exec(`CREATE TABLE IF NOT EXISTS "${r.name}" (${cols.join(', ')})`);
    const existing = new Set(db.prepare(`PRAGMA table_info("${r.name}")`).all().map((c) => c.name));
    if (r.posto && !existing.has('posto_id')) db.exec(`ALTER TABLE "${r.name}" ADD COLUMN posto_id INTEGER`);
    for (const f of r.fields) {
      if (!existing.has(f.name)) db.exec(`ALTER TABLE "${r.name}" ADD COLUMN "${f.name}" ${SQL_TYPES[f.type] || 'TEXT'}`);
    }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessoes (token TEXT PRIMARY KEY, usuario_id INTEGER, expira TEXT);
    CREATE TABLE IF NOT EXISTS arquivos (id TEXT PRIMARY KEY, nome TEXT, tipo TEXT, tamanho INTEGER, created_at TEXT, created_by INTEGER);
    CREATE INDEX IF NOT EXISTS ix_vendas_data ON vendas(data, origem);
    CREATE INDEX IF NOT EXISTS ix_ponto ON ponto(funcionario_id, data);
    CREATE INDEX IF NOT EXISTS ix_escalas ON escalas(data);
    CREATE INDEX IF NOT EXISTS ix_tarefas ON tarefas(data_prevista);
    CREATE INDEX IF NOT EXISTS ix_encerrantes ON encerrantes(turno_id);
    CREATE INDEX IF NOT EXISTS ix_auditoria ON auditoria(tabela, registro_id);
  `);
  const ins = db.prepare('INSERT INTO parametros (grupo, chave, descricao, valor, created_at) VALUES (?, ?, ?, ?, ?)');
  const has = db.prepare('SELECT 1 FROM parametros WHERE chave = ?');
  for (const [g, k, d, v] of DEFAULT_PARAMS) {
    if (!has.get(k)) ins.run(g, k, d, v, new Date().toISOString());
  }
}

function param(db, chave, fallback) {
  const row = db.prepare('SELECT valor FROM parametros WHERE chave = ?').get(chave);
  if (!row || row.valor === null || row.valor === '') return fallback;
  return row.valor;
}

function paramNum(db, chave, fallback) {
  const v = Number(String(param(db, chave, fallback)).replace(',', '.'));
  return Number.isFinite(v) ? v : fallback;
}

module.exports = { open, migrate, param, paramNum, SQL_TYPES };
