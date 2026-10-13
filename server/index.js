'use strict';
// Ponto de entrada.
//   npm start      → uso real: banco em ./data, começa vazio só com o posto e o gerente
//   npm run demo   → demonstração: banco separado em ./data-demo com dados fictícios
// Variáveis opcionais: PORT, DATA_DIR, TZ, POSTO_NOME, SENHA_GERENTE.

process.env.TZ = process.env.TZ || 'America/Fortaleza';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { open } = require('./db');
const { createApp, rotinasDiarias } = require('./app');

const demo = process.argv.includes('--demo');
const raiz = path.join(__dirname, '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(raiz, demo ? 'data-demo' : 'data'));
const db = open(path.join(dataDir, 'posto.db'));

let acessoInicial = null;
if (!db.prepare('SELECT 1 FROM usuarios LIMIT 1').get()) {
  if (demo) {
    console.log('Banco de demonstração vazio: carregando dados fictícios…');
    require('./seed').seed(db);
  } else {
    // senha legível, sem caracteres ambíguos
    const alfabeto = 'abcdefghjkmnpqrstuvwxyz23456789';
    const senha = process.env.SENHA_GERENTE || Array.from(crypto.randomBytes(10), (b) => alfabeto[b % alfabeto.length]).join('');
    const posto = process.env.POSTO_NOME || 'Meu Posto';
    require('./seed').setupInicial(db, { posto, senha });
    acessoInicial = { senha, posto };
    fs.writeFileSync(path.join(dataDir, 'ACESSO-INICIAL.txt'),
      `Posto: ${posto}\r\nUsuário: gerente\r\nSenha inicial: ${senha}\r\n\r\nNo primeiro acesso o sistema pede uma nova senha. Depois disso, apague este arquivo.\r\n`);
  }
}

const app = createApp({ db, dataDir, demo });
const port = Number(process.env.PORT) || 3000;

function enderecosRede() {
  const out = [];
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const a of lista || []) if (a.family === 'IPv4' && !a.internal) out.push(`http://${a.address}:${port}`);
  }
  return out;
}

app.server().listen(port, () => {
  const linha = '─'.repeat(64);
  console.log(linha);
  console.log(demo ? '  DEMONSTRAÇÃO (dados fictícios) — Gestão do Posto' : '  Gestão do Posto');
  console.log(`  Neste computador:  http://localhost:${port}`);
  for (const e of enderecosRede()) console.log(`  Celulares no mesmo Wi-Fi:  ${e}`);
  if (demo) console.log('  Usuários: gerente, dono, chefe, joao, financeiro, rh, conveniencia, contador — senha posto123');
  if (acessoInicial) {
    console.log('');
    console.log('  PRIMEIRO ACESSO');
    console.log('  Usuário: gerente');
    console.log(`  Senha:   ${acessoInicial.senha}`);
    console.log(`  (também salva em ${path.join(dataDir, 'ACESSO-INICIAL.txt')})`);
  }
  console.log(`  Dados e backups em: ${dataDir}`);
  console.log('  Para desligar, feche esta janela ou aperte Ctrl+C.');
  console.log(linha);
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
