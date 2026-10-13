'use strict';
// Ponto de entrada: `npm start` (PORT, DATA_DIR e TZ configuráveis por variável de ambiente).

process.env.TZ = process.env.TZ || 'America/Fortaleza';

const path = require('node:path');
const { open } = require('./db');
const { createApp, rotinasDiarias } = require('./app');

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const dbFile = path.join(dataDir, 'posto.db');
const db = open(dbFile);

const empty = !db.prepare('SELECT 1 FROM usuarios LIMIT 1').get();
if (empty) {
  console.log('Banco vazio: carregando dados de demonstração…');
  require('./seed').seed(db);
}

const app = createApp({ db, dataDir });
const port = Number(process.env.PORT) || 3000;

app.server().listen(port, () => {
  console.log(`Plataforma do Posto rodando em http://localhost:${port}`);
  if (empty) console.log('Acesse com usuário "gerente" e senha "posto123" (veja README para os demais perfis).');
});

async function rodar() {
  try {
    const log = await rotinasDiarias(db, dataDir);
    console.log(`[rotinas ${new Date().toLocaleString('pt-BR')}] ${log.join(' | ')}`);
  } catch (e) {
    console.error('Falha nas rotinas diárias:', e);
  }
}
rodar();
setInterval(rodar, 60 * 60 * 1000).unref();
