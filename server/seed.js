'use strict';
// Dados de demonstração: ~75 dias de operação simulada de um posto em Natal/RN.
// Uso: `npm run seed` (recria o banco) ou automaticamente quando o banco está vazio.

process.env.TZ = process.env.TZ || 'America/Fortaleza';

const path = require('node:path');
const fs = require('node:fs');
const { hashPassword } = require('./auth');
const { today, addDays, addMonths, addYears, round2, weekday, monthStart } = require('./util');

const DIAS = 75;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seed(db) {
  const R = rng(20261012);
  const rand = (a, b) => a + R() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(R() * arr.length)];
  const now = new Date().toISOString();
  const H = today();
  const stmts = new Map();
  function ins(table, obj) {
    const o = { ...obj, created_at: obj.created_at || now, updated_at: now };
    const keys = Object.keys(o);
    const sql = `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
    if (!stmts.has(sql)) stmts.set(sql, db.prepare(sql));
    const vals = keys.map((k) => (o[k] !== null && typeof o[k] === 'object' ? JSON.stringify(o[k]) : typeof o[k] === 'boolean' ? (o[k] ? 1 : 0) : o[k] ?? null));
    return Number(stmts.get(sql).run(...vals).lastInsertRowid);
  }
  const upd = (sql, ...args) => db.prepare(sql).run(...args);

  db.exec('BEGIN');
  try {
    const posto = ins('postos', { nome: 'Posto Natal', cnpj: '12.345.678/0001-90', endereco: 'Av. Engenheiro Roberto Freire, 1000', cidade: 'Natal', uf: 'RN', bandeira: 'Bandeira branca' });
    const P = { posto_id: posto };

    // ------------------------------------------------------------ Funcionários
    const funcs = [
      ['Carlos Menezes', 'Gerente', '2016-03-01', 4800, 0, 'manha', '5x2', '07:00', 480],
      ['Ana Paula Ribeiro', 'Auxiliar administrativo', '2019-02-11', 2300, 0, 'manha', '5x2', '08:00', 480],
      ['Roberto Lima', 'Chefe de pista', '2017-08-14', 2900, 1, 'manha', '6x1', '06:00', 440],
      ['Marcos Vinícius Souza', 'Chefe de pista', '2018-05-02', 2900, 1, 'tarde', '6x1', '14:00', 440],
      ['João Batista Silva', 'Frentista caixa', addDays(addYears(H, -3), 26), 1850, 1, 'manha', '6x1', '06:00', 440],
      ['Francisco das Chagas', 'Frentista', addDays(addYears(H, -3), 55), 1750, 1, 'manha', '6x1', '06:00', 440],
      ['Maria José Costa', 'Frentista caixa', '2020-01-06', 1850, 1, 'manha', '6x1', '06:00', 440],
      ['Pedro Henrique Alves', 'Frentista', '2021-07-19', 1750, 1, 'tarde', '6x1', '14:00', 440],
      ['Luciana Ferreira', 'Frentista', '2022-03-07', 1750, 1, 'tarde', '6x1', '14:00', 440],
      ['Antônio Carlos Dantas', 'Frentista', '2019-10-21', 1750, 1, 'tarde', '6x1', '14:00', 440],
      ['José Wellington Nunes', 'Frentista', '2023-01-16', 1750, 1, 'noite', '12x36', '19:00', 660],
      ['Rafael Medeiros', 'Operador GNV', '2021-11-08', 1900, 1, 'noite', '12x36', '19:00', 660],
      ['Juliana Araújo', 'Atendente conveniência', '2022-09-12', 1650, 0, 'manha', '6x1', '07:00', 440],
      ['Patrícia Gomes', 'Atendente conveniência', '2024-02-05', 1650, 0, 'tarde', '6x1', '14:00', 440],
    ];
    const F = funcs.map(([nome, funcao, admissao, salario, peric, turno, escala, entrada, jornada], i) => ({
      id: ins('funcionarios', {
        ...P, nome, funcao, admissao, salario, periculosidade: peric, escala_tipo: escala, horario_entrada: entrada, jornada_min: jornada,
        cpf: `${String(100 + i).padStart(3, '0')}.${String(200 + i * 7).padStart(3, '0')}.${String(300 + i * 3).padStart(3, '0')}-${String(10 + i).slice(-2)}`,
        pis: String(12000000000 + i * 137), nascimento: `${1975 + i}-0${(i % 9) + 1}-15`,
        gnv_habilitado: funcao === 'Operador GNV' || nome.startsWith('José Wellington') ? 1 : 0,
        meta_grid: /Frentista/.test(funcao) ? 2500 : null, tamanho_uniforme: pick(['M', 'G', 'GG']), calcado: randi(37, 43),
        telefone: `(84) 9${randi(8100, 9999)}-${randi(1000, 9999)}`, consentimento_lgpd: 1, ativo: 1, dependentes: randi(0, 3),
      }),
      nome, funcao, admissao, turno, escala, entrada, jornada,
    }));
    const byName = (n) => F.find((f) => f.nome.startsWith(n));
    const frentistas = F.filter((f) => /Frentista|GNV/.test(f.funcao));
    const chefes = F.filter((f) => f.funcao === 'Chefe de pista');

    // ------------------------------------------------------------ Usuários
    const senha = hashPassword('posto123');
    const U = {};
    for (const [login, nome, perfil, fn] of [
      ['gerente', 'Carlos Menezes', 'gerente', 'Carlos'], ['dono', 'Sr. Eduardo Bezerra (proprietário)', 'proprietario', null],
      ['chefe', 'Roberto Lima', 'chefe_pista', 'Roberto'], ['joao', 'João Batista Silva', 'frentista', 'João'],
      ['financeiro', 'Ana Paula Ribeiro', 'financeiro', 'Ana Paula'], ['rh', 'Fernanda Rocha (RH/DP)', 'rh', null],
      ['conveniencia', 'Juliana Araújo', 'conveniencia', 'Juliana'], ['contador', 'Escritório Contábil Potiguar', 'contabilidade', null],
      ['maria', 'Maria José Costa', 'frentista', 'Maria José'], ['marcos', 'Marcos Vinícius Souza', 'chefe_pista', 'Marcos'],
    ]) {
      U[login] = ins('usuarios', { nome, login, senha, perfil, funcionario_id: fn ? byName(fn).id : null, ativo: 1, email: `${login}@postonatal.com.br`, telefone: perfil === 'gerente' ? '(84) 99999-0001' : null });
    }

    // ------------------------------------------------------------ Fornecedores e plano de contas
    const forn = {};
    for (const [k, nome, cat] of [
      ['dist1', 'Distribuidora Nordeste Combustíveis Ltda', 'Distribuidora'], ['dist2', 'Potiguar Petróleo Distribuidora S.A.', 'Distribuidora'],
      ['gnv', 'Potigás — Gás Natural', 'Distribuidora'], ['bebidas', 'Distribuidora de Bebidas Litoral', 'Conveniência'],
      ['snacks', 'Atacadão Snacks RN', 'Conveniência'], ['tabaco', 'Tabacaria Distribuidora NE', 'Conveniência'],
      ['energia', 'Companhia Energética do RN', 'Energia/Água'], ['agua', 'Companhia de Águas e Esgotos do RN', 'Energia/Água'],
      ['aluguel', 'Imobiliária Ponta Negra (locador)', 'Aluguel'], ['manut', 'TecBombas Manutenção', 'Manutenção'],
      ['sst', 'SegTrab Saúde e Segurança do Trabalho', 'SST'], ['contab', 'Escritório Contábil Potiguar', 'Serviços'],
      ['pragas', 'DedetizaRN Controle de Pragas', 'Serviços'], ['lub', 'Lubrificantes Nordeste', 'Conveniência'],
    ]) forn[k] = ins('fornecedores', { nome, categoria: cat, cnpj: `${randi(10, 99)}.${randi(100, 999)}.${randi(100, 999)}/0001-${randi(10, 99)}`, telefone: `(84) 3${randi(200, 999)}-${randi(1000, 9999)}` });

    const PC = {};
    for (const [k, cod, nome, tipo] of [
      ['rec_comb', '3.1.01', 'Receita de combustíveis', 'receita'], ['rec_conv', '3.1.02', 'Receita da conveniência', 'receita'],
      ['cmv_comb', '4.1.01', 'Compra de combustíveis', 'cmv'], ['cmv_conv', '4.1.02', 'Compra de mercadorias (conveniência)', 'cmv'],
      ['folha', '5.1.01', 'Salários e encargos', 'despesa'], ['energia', '5.2.01', 'Energia elétrica', 'despesa'], ['agua', '5.2.02', 'Água e esgoto', 'despesa'],
      ['aluguel', '5.2.03', 'Aluguel', 'despesa'], ['manut', '5.2.04', 'Manutenção de equipamentos', 'despesa'], ['impostos', '5.3.01', 'Impostos e taxas', 'despesa'],
      ['servicos', '5.2.05', 'Serviços de terceiros', 'despesa'], ['sst', '5.2.06', 'Saúde e segurança do trabalho', 'despesa'], ['tarifas', '6.1.01', 'Tarifas bancárias', 'financeira'],
    ]) PC[k] = ins('plano_contas', { codigo: cod, nome, tipo });

    // ------------------------------------------------------------ Combustíveis, tanques e bicos
    const C = {
      gc: { id: ins('combustiveis', { nome: 'Gasolina comum', codigo_anp: '320102001', unidade: 'L', preco_bomba: 6.29, custo_medio: 5.71, tipo_teste: 'gasolina' }), dia: 3600, preco: 6.29, custo: 5.71, tm: 32 },
      ga: { id: ins('combustiveis', { nome: 'Gasolina aditivada', codigo_anp: '320102002', unidade: 'L', preco_bomba: 6.49, custo_medio: 5.86, tipo_teste: 'gasolina' }), dia: 900, preco: 6.49, custo: 5.86, tm: 35 },
      et: { id: ins('combustiveis', { nome: 'Etanol hidratado', codigo_anp: '810101001', unidade: 'L', preco_bomba: 4.59, custo_medio: 4.04, tipo_teste: 'etanol' }), dia: 1400, preco: 4.59, custo: 4.04, tm: 30 },
      s10: { id: ins('combustiveis', { nome: 'Diesel S10', codigo_anp: '820101034', unidade: 'L', preco_bomba: 6.19, custo_medio: 5.62, tipo_teste: 'diesel' }), dia: 2300, preco: 6.19, custo: 5.62, tm: 85 },
      gnv: { id: ins('combustiveis', { nome: 'GNV', codigo_anp: '220101003', unidade: 'm³', preco_bomba: 4.99, custo_medio: 3.62, tipo_teste: 'gnv' }), dia: 650, preco: 4.99, custo: 3.62, tm: 13 },
    };
    const T = {
      gc: { id: ins('tanques', { ...P, nome: 'T1 — Gasolina comum', combustivel_id: C.gc.id, capacidade: 30000, estoque_minimo: 3000 }), cap: 30000, est: 18000 },
      ga: { id: ins('tanques', { ...P, nome: 'T2 — Gasolina aditivada', combustivel_id: C.ga.id, capacidade: 15000, estoque_minimo: 1500 }), cap: 15000, est: 9000 },
      et: { id: ins('tanques', { ...P, nome: 'T3 — Etanol', combustivel_id: C.et.id, capacidade: 15000, estoque_minimo: 1500 }), cap: 15000, est: 8000 },
      s10: { id: ins('tanques', { ...P, nome: 'T4 — Diesel S10', combustivel_id: C.s10.id, capacidade: 30000, estoque_minimo: 3000 }), cap: 30000, est: 16000 },
    };
    const B = [
      ['B01', 'Bomba 1', 'gc', 0.55], ['B02', 'Bomba 1', 'gc', 0.45], ['B03', 'Bomba 2', 'ga', 1], ['B04', 'Bomba 2', 'et', 0.6],
      ['B05', 'Bomba 3', 'et', 0.4], ['B06', 'Bomba 3', 's10', 0.5], ['B07', 'Bomba 4', 's10', 0.5], ['B08', 'Dispenser GNV', 'gnv', 1],
    ].map(([nome, bomba, c, share], i) => ({
      id: ins('bicos', { ...P, nome, bomba, combustivel_id: C[c].id, tanque_id: T[c]?.id ?? null, lacre: `IPEM-${4410 + i}`, encerrante_atual: 0 }),
      c, share, enc: randi(100000, 900000),
    }));

    // ------------------------------------------------------------ Conveniência
    const CAT = {};
    for (const [k, nome, m] of [['beb', 'Bebidas', 35], ['snk', 'Snacks e doces', 40], ['tab', 'Tabacaria', 12], ['gel', 'Sorvetes', 45], ['mer', 'Mercearia', 30], ['lub', 'Lubrificantes e aditivos', 30], ['aut', 'Acessórios automotivos', 45]]) {
      CAT[k] = ins('categorias_conv', { nome, margem_alvo: m });
    }
    const prodDefs = [
      ['7891', 'Água mineral 500 ml', 'beb', 1.1, 3.0, 300, 6], ['7892', 'Refrigerante lata 350 ml', 'beb', 2.6, 5.5, 240, 8], ['7893', 'Refrigerante 2 L', 'beb', 6.2, 11.0, 60, 2],
      ['7894', 'Energético 250 ml', 'beb', 5.9, 10.9, 90, 4], ['7895', 'Cerveja long neck', 'beb', 4.2, 7.5, 200, 7], ['7896', 'Suco 1 L', 'beb', 4.8, 8.9, 40, 1.5],
      ['7897', 'Café expresso', 'mer', 1.2, 5.0, 999, 6], ['7898', 'Pão de queijo (un.)', 'mer', 0.9, 3.5, 180, 7], ['7899', 'Sanduíche natural', 'mer', 6.5, 12.9, 25, 2],
      ['7900', 'Batata chips 100 g', 'snk', 4.1, 8.5, 80, 3], ['7901', 'Chocolate barra 90 g', 'snk', 3.9, 7.9, 70, 3], ['7902', 'Biscoito recheado', 'snk', 1.9, 4.5, 90, 3],
      ['7903', 'Chiclete', 'snk', 0.9, 2.5, 150, 4], ['7904', 'Amendoim 150 g', 'snk', 3.1, 6.9, 40, 1], ['7905', 'Cigarro maço', 'tab', 9.3, 10.75, 200, 6],
      ['7906', 'Isqueiro', 'tab', 2.1, 5.0, 60, 1], ['7907', 'Picolé', 'gel', 2.0, 5.0, 120, 3], ['7908', 'Pote sorvete 1,5 L', 'gel', 14.0, 26.9, 20, 0.5],
      ['7909', 'Gelo 5 kg', 'mer', 4.5, 10.0, 40, 2], ['7910', 'Carvão 3 kg', 'mer', 8.5, 16.0, 15, 0.3], ['7911', 'Aromatizante automotivo', 'aut', 6.0, 14.9, 30, 0.4],
      ['7912', 'Flanela', 'aut', 2.5, 7.0, 50, 0.6], ['7913', 'Revista de palavras cruzadas', 'mer', 5.0, 9.9, 12, 0],
    ];
    const PR = prodDefs.map(([codigo, nome, cat, custo, preco, estoque, giro]) => ({
      id: ins('produtos', { ...P, codigo, ean: '789' + codigo + '00001', nome, categoria_id: CAT[cat], local: 'conveniencia', custo, preco, estoque, estoque_minimo: Math.max(5, Math.round(estoque * 0.15)), ativo: 1 }),
      custo, preco, giro, nome,
    }));
    // margem abaixo do alvo (custo subiu)
    upd('UPDATE produtos SET custo = 4.6 WHERE codigo = ?', '7900');
    PR.find((p) => p.nome.startsWith('Batata')).custo = 4.6;
    const grid = [
      ['L01', 'Óleo motor 15W40 1 L', 22, 39.9, 60, 6], ['L02', 'Óleo motor 5W30 sintético 1 L', 32, 59.9, 40, 6], ['L03', 'Aditivo radiador 1 L', 9, 19.9, 30, 8],
      ['L04', 'Aditivo combustível', 12, 29.9, 30, 10], ['L05', 'Filtro de óleo', 18, 39.9, 25, 7], ['L06', 'Palheta limpador (par)', 25, 59.9, 20, 8], ['L07', 'Fluido de freio', 11, 24.9, 20, 6],
    ].map(([codigo, nome, custo, preco, estoque, com]) => ({ id: ins('produtos', { ...P, codigo, nome, categoria_id: CAT.lub, local: 'grid', custo, preco, estoque, estoque_minimo: 5, comissao_pct: com, ativo: 1 }), custo, preco, com }));

    // ------------------------------------------------------------ Escalas (6x1 e 12x36) e ponto
    const inicio = addDays(H, -DIAS);
    const escalaDe = (f, d, idx) => {
      if (f.escala === '5x2') return [0, 6].includes(weekday(d)) ? 'folga' : f.turno;
      if (f.escala === '12x36') return (idx + (f.id % 2)) % 2 === 0 ? f.turno : 'folga';
      return (idx + f.id) % 7 === 0 ? 'folga' : f.turno;
    };
    const escalasDia = new Map();
    for (let i = 0, d = inicio; d <= addDays(H, 14); i++, d = addDays(d, 1)) {
      const list = [];
      for (const f of F) {
        const t = escalaDe(f, d, i);
        ins('escalas', { ...P, funcionario_id: f.id, data: d, turno: t, gnv: f.funcao === 'Operador GNV' && t !== 'folga' ? 1 : 0 });
        list.push({ f, t });
      }
      escalasDia.set(d, list);
    }
    const toHm = (m) => `${String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(((m % 60) + 60) % 60).padStart(2, '0')}`;
    const hmToMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
    const faltaDias = new Set([`${byName('Francisco').id}|${addDays(H, -9)}`, `${byName('Luciana').id}|${addDays(H, -20)}`, `${byName('Antônio').id}|${addDays(H, -33)}`]);
    for (let d = inicio; d <= H; d = addDays(d, 1)) {
      for (const { f, t } of escalasDia.get(d)) {
        if (t === 'folga') { ins('ponto', { ...P, funcionario_id: f.id, data: d, ocorrencia: 'folga', origem: 'afd' }); continue; }
        if (faltaDias.has(`${f.id}|${d}`)) { ins('ponto', { ...P, funcionario_id: f.id, data: d, ocorrencia: 'falta_injustificada', origem: 'afd' }); continue; }
        const e0 = hmToMin(f.entrada);
        if (d === H) {
          if (e0 <= new Date().getHours() * 60 + new Date().getMinutes() && f.nome !== 'Pedro Henrique Alves') ins('ponto', { ...P, funcionario_id: f.id, data: d, entrada: toHm(e0 + randi(-8, 6)), origem: 'afd', ocorrencia: 'normal' });
          continue;
        }
        const atraso = R() < 0.06 ? randi(15, 40) : randi(-10, 5);
        const extra = R() < 0.18 ? randi(30, 110) : randi(-5, 8);
        const ent = e0 + atraso;
        const sai = e0 + f.jornada + 60 + extra;
        const si = e0 + Math.round(f.jornada / 2) + randi(-10, 10);
        ins('ponto', { ...P, funcionario_id: f.id, data: d, entrada: toHm(ent), saida_intervalo: toHm(si), retorno_intervalo: toHm(si + 60 + randi(0, 5)), saida: toHm(sai), origem: 'afd', ocorrencia: 'normal', he_aprovada: d < monthStart(H) ? 1 : 0, feriado: 0 });
      }
    }
    // feriado trabalhado (12/10 — Nossa Senhora Aparecida) e excesso de HE
    const pedro = byName('Pedro');
    upd("UPDATE ponto SET saida = '03:00' WHERE funcionario_id = ? AND data >= ? AND ocorrencia = 'normal' AND saida IS NOT NULL", pedro.id, monthStart(H));

    // ------------------------------------------------------------ Turnos, vendas, encerrantes, caixas
    const insVenda = db.prepare(`INSERT INTO vendas (posto_id, data, hora, origem, cupom, turno_id, bico_id, combustivel_id, produto_id, funcionario_id, quantidade, valor, custo, forma_pagamento, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const formas = [['dinheiro', 0.16], ['debito', 0.27], ['credito', 0.3], ['pix', 0.2], ['prazo', 0.04], ['frota', 0.03]];
    const pickForma = () => { let x = R(); for (const [f, p] of formas) { if ((x -= p) <= 0) return f; } return 'pix'; };
    const periodos = [['manha', 6 * 60, 0.42], ['tarde', 14 * 60, 0.4], ['noite', 22 * 60, 0.18]];
    let cupom = 100000;
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    const custos = Object.fromEntries(Object.entries(C).map(([k, c]) => [k, c.custo]));
    const precosAt = Object.fromEntries(Object.entries(C).map(([k, c]) => [k, c.preco]));
    const cartaoDia = new Map();
    const faltasPlan = new Set();
    // João: 3 faltas de caixa neste mês (alerta); outras esporádicas
    const joao = byName('João');
    const diasMes = Math.max(1, Number(H.slice(8, 10)) - 1);
    for (const k of [1, Math.max(2, Math.floor(diasMes / 2)), Math.max(3, diasMes)]) faltasPlan.add(`${joao.id}|${addDays(monthStart(H), Math.min(k, diasMes) - 1)}`);
    let ultimoTurno = null;
    const descargasPend = [];
    for (let i = 0, d = inicio; d <= H; i++, d = addDays(d, 1)) {
      // reajustes de preço/custo ao longo do período
      if (i === 20) { precosAt.gc = 6.19; custos.gc = 5.62; }
      if (i === 21) { precosAt.gc = 6.29; custos.gc = 5.71; }
      if (i === 45) { custos.s10 = 5.58; }
      const fatorDia = [0.85, 1.0, 1.0, 1.02, 1.05, 1.18, 1.1][weekday(d)] * rand(0.9, 1.1);
      // descarga quando o tanque estiver abaixo de 45%
      for (const [k, t] of Object.entries(T)) {
        if (t.est < t.cap * 0.45 && d !== H) {
          const vol = t.cap >= 30000 ? 15000 : 10000;
          const antes = t.est;
          const custo = round2(custos[k] + rand(-0.03, 0.03) * 1) ;
          const reprovar = k === 'et' && d === addDays(H, -4);
          ins('descargas', {
            ...P, data: d, hora: '05:30', combustivel_id: C[k].id, tanque_id: t.id, fornecedor_id: k === 's10' ? forn.dist2 : forn.dist1,
            nota: String(randi(100000, 999999)), volume_nf: vol, custo_unitario: custo, placa: `QG${pick(['A', 'B', 'K'])}${randi(1000, 9999)}`,
            motorista: pick(['Severino', 'Damião', 'Edvaldo', 'Gilson']), medicao_antes: round2(antes), medicao_depois: reprovar ? null : round2(antes + vol - rand(0, 25)),
            aspecto: 'ok', cor: 'ok', densidade: k === 'et' ? (reprovar ? 812.9 : round2(rand(806, 810))) : k === 's10' ? round2(rand(830, 845)) : round2(rand(735, 750)),
            temperatura: round2(rand(27, 31)), teor_etanol: k === 'gc' || k === 'ga' ? round2(rand(29.3, 30.6)) : null,
            amostra_numero: `AT-${randi(10000, 99999)}`, amostra_descarte: addDays(d, 30),
            status: reprovar ? 'recusada' : 'aprovada', reprovacoes: reprovar ? 'Massa específica 812.9 fora da faixa 805.2–811.2 kg/m³' : null,
          });
          if (!reprovar) {
            t.est += vol;
            descargasPend.push({ d, k, vol, custo });
            upd('UPDATE combustiveis SET custo_medio = ? WHERE id = ?', custo, C[k].id);
          } else {
            // carga recusada; nova carga aprovada no mesmo dia
            ins('descargas', {
              ...P, data: d, hora: '09:10', combustivel_id: C[k].id, tanque_id: t.id, fornecedor_id: forn.dist2, nota: String(randi(100000, 999999)), volume_nf: vol, custo_unitario: custo,
              placa: `QGK${randi(1000, 9999)}`, motorista: 'Gilson', medicao_antes: round2(antes), medicao_depois: round2(antes + vol - 10), aspecto: 'ok', cor: 'ok', densidade: 808.4, temperatura: 29.5,
              amostra_numero: `AT-${randi(10000, 99999)}`, amostra_descarte: addDays(d, 30), status: 'aprovada',
            });
            t.est += vol;
            descargasPend.push({ d, k, vol, custo });
          }
        }
      }
      for (const [periodo, iniMin, share] of periodos) {
        if (d === H && iniMin > nowMin && periodo !== 'manha') continue;
        const aberto = d === H && (periodo === 'tarde' ? nowMin < 22 * 60 : periodo === 'manha' ? nowMin < 14 * 60 : true);
        const chefe = periodo === 'tarde' ? chefes[1] : chefes[0];
        const equipe = escalasDia.get(d).filter((x) => x.t === periodo && /Frentista|GNV/.test(x.f.funcao)).map((x) => x.f);
        if (!equipe.length) equipe.push(frentistas[0]);
        const turnoId = ins('turnos', {
          ...P, data: d, periodo, chefe_id: chefe.id, status: aberto ? 'aberto' : 'fechado',
          abertura_at: `${d}T${toHm(iniMin)}:00`, fechamento_at: aberto ? null : `${d}T${toHm(iniMin + 480)}:00`,
          presencas: equipe.map((f) => ({ funcionario_id: f.id, presente: true })),
          checklist_abertura: { itens: Object.fromEntries([...Array(9).keys()].map((n) => [n, true])) },
          checklist_fechamento: aberto ? null : { itens: Object.fromEntries([...Array(6).keys()].map((n) => [n, true])) },
        });
        ultimoTurno = turnoId;
        const vendasFunc = new Map(equipe.map((f) => [f.id, { total: 0, dinheiro: 0, debito: 0, credito: 0, pix: 0, a_prazo: 0, vales: 0 }]));
        const encTurno = [];
        const fracao = aberto ? Math.max(0.1, Math.min(1, (nowMin - iniMin) / 480)) : 1;
        for (const b of B) {
          const c = C[b.c];
          let litros = c.dia * share * b.share * fatorDia * fracao;
          const tm = c.tm;
          let vendido = 0;
          while (litros > 1) {
            const q = Math.min(litros, round2(tm * rand(0.4, 1.6)));
            litros -= q;
            const f = b.c === 'gnv' ? (equipe.find((x) => x.funcao === 'Operador GNV') || equipe[0]) : pick(equipe);
            const forma = pickForma();
            const valor = round2(q * precosAt[b.c]);
            const hora = toHm(iniMin + Math.floor(R() * 480 * fracao));
            insVenda.run(posto, d, hora, 'pista', String(cupom++), turnoId, b.id, c.id, null, f.id, round2(q), valor, round2(q * custos[b.c]), forma, now, now);
            vendido += round2(q);
            const vf = vendasFunc.get(f.id) || vendasFunc.get(equipe[0].id);
            vf.total += valor;
            const campo = forma === 'prazo' || forma === 'frota' ? 'a_prazo' : forma;
            vf[campo] += valor;
            if (forma === 'debito' || forma === 'credito') {
              const k = `${d}|${forma}`;
              cartaoDia.set(k, (cartaoDia.get(k) || 0) + valor);
            }
          }
          vendido = round2(vendido);
          const inicial = b.enc;
          b.enc = round2(b.enc + vendido);
          encTurno.push({ b, inicial, final: aberto ? null : b.enc });
          if (T[b.c]) T[b.c].est -= vendido;
        }
        for (const e of encTurno) ins('encerrantes', { ...P, turno_id: turnoId, bico_id: e.b.id, inicial: e.inicial, final: e.final, afericao_litros: 0 });
        // medições: abertura no turno da manhã e fechamento no turno da noite
        if (periodo === 'manha') {
          for (const t of Object.values(T)) ins('medicoes_tanque', { ...P, data: d, turno_id: turnoId, tanque_id: t.id, momento: 'abertura', metodo: 'regua', volume: round2(t.lastClose ?? t.est) });
        }
        if (periodo === 'noite' && !aberto) {
          for (const [k, t] of Object.entries(T)) {
            let ruido = t.est * rand(-0.0015, 0.0012);
            if (k === 'gc' && d === addDays(H, -2)) ruido = -t.est * 0.011; // perda acima da tolerância → alerta
            const medido = round2(t.est + ruido);
            t.est = medido;
            t.lastClose = medido;
            ins('medicoes_tanque', { ...P, data: d, turno_id: turnoId, tanque_id: t.id, momento: 'fechamento', metodo: 'regua', volume: medido });
          }
        }
        // sangrias
        if (!aberto) ins('sangrias', { ...P, turno_id: turnoId, tipo: 'sangria', horario: toHm(iniMin + 240), valor: 500, entregue_por: equipe[0].id, recebido_por: chefe.id });
        // fechamento de caixa por frentista
        if (!aberto) {
          for (const f of equipe) {
            const v = vendasFunc.get(f.id);
            if (!v.total) continue;
            let falta = 0;
            if (faltasPlan.has(`${f.id}|${d}`)) falta = round2(rand(25, 70));
            else if (R() < 0.025) falta = round2(rand(5, 60));
            const dinheiro = round2(v.dinheiro - falta);
            const total = round2(dinheiro + v.debito + v.credito + v.pix + v.a_prazo + v.vales);
            const dif = round2(total - round2(v.total));
            const assin = R() < 0.9 || d < addDays(H, -3);
            const cx = ins('caixas', {
              ...P, turno_id: turnoId, funcionario_id: f.id, dinheiro, debito: round2(v.debito), credito: round2(v.credito), pix: round2(v.pix), a_prazo: round2(v.a_prazo), vales: 0,
              total_informado: total, sistema_total: round2(v.total), diferenca: dif, justificativa: falta ? pick(['Troco errado', 'Não soube explicar', 'Possível nota falsa', 'Erro na contagem']) : null,
              assinado_at: assin ? `${d}T${toHm(iniMin + 485)}:00` : null,
            });
            if (dif < -0.009) {
              const antigo = d < monthStart(H);
              ins('faltas_caixa', {
                ...P, data: d, turno_id: turnoId, caixa_id: cx, funcionario_id: f.id, valor: -dif, forma_pagamento: 'Dinheiro',
                justificativa: 'Diferença no fechamento', tratamento: antigo ? pick(['desconto', 'abonado', 'desconto']) : 'pendente',
                autorizacao: antigo ? [] : null, assinado_at: assin ? `${d}T${toHm(iniMin + 485)}:00` : null,
              });
            }
          }
        }
        // grid: lubrificantes/aditivos vendidos pelos frentistas
        if (!aberto) {
          for (const f of equipe) {
            if (R() < 0.55) {
              const g = pick(grid);
              const q = randi(1, 3);
              ins('vendas_grid', { ...P, data: d, funcionario_id: f.id, produto_id: g.id, quantidade: q, valor: round2(q * g.preco) });
            }
          }
        }
      }
      // conveniência
      const cupons = Math.round(95 * fatorDia * (d === H ? Math.min(1, nowMin / 1320) : 1));
      for (let c = 0; c < cupons; c++) {
        const hora = toHm(randi(6 * 60, 23 * 60));
        const forma = pickForma();
        const atendente = Number(hora.slice(0, 2)) < 14 ? byName('Juliana').id : byName('Patrícia').id;
        const n = randi(1, 3);
        const cp = String(cupom++);
        for (let k = 0; k < n; k++) {
          let p = pick(PR);
          if (R() * 8 > p.giro) p = PR[randi(0, 7)];
          if (p.nome.startsWith('Revista')) continue; // produto parado
          const q = p.nome.startsWith('Água') || p.nome.startsWith('Cerveja') ? randi(1, 4) : 1;
          insVenda.run(posto, d, hora, 'conveniencia', cp, null, null, null, p.id, atendente, q, round2(q * p.preco), round2(q * p.custo), forma === 'frota' ? 'credito' : forma, now, now);
          if (forma === 'debito' || forma === 'credito') cartaoDia.set(`${d}|${forma}`, (cartaoDia.get(`${d}|${forma}`) || 0) + round2(q * p.preco));
        }
      }
    }
    for (const b of B) upd('UPDATE bicos SET encerrante_atual = ? WHERE id = ?', b.enc, b.id);
    for (const [k, c] of Object.entries(C)) upd('UPDATE combustiveis SET preco_bomba = ? WHERE id = ?', precosAt[k], c.id);

    // ------------------------------------------------------------ Cartões
    const TX = [['Cielo', 'Visa', 'debito', 1.19, 1], ['Cielo', 'Visa', 'credito', 2.69, 30], ['Cielo', 'Mastercard', 'debito', 1.19, 1], ['Cielo', 'Mastercard', 'credito', 2.69, 30],
      ['Stone', 'Elo', 'debito', 1.29, 1], ['Stone', 'Elo', 'credito', 2.89, 30]];
    for (const [a, b, m, t, p] of TX) ins('taxas_cartao', { ...P, adquirente: a, bandeira: b, modalidade: m, taxa_pct: t, prazo_dias: p });
    const recebEntradas = [];
    let recIdx = 0;
    for (const [k, total] of cartaoDia) {
      const [d, mod] = k.split('|');
      const parts = mod === 'debito' ? [['Cielo', 'Visa', 0.45], ['Cielo', 'Mastercard', 0.35], ['Stone', 'Elo', 0.2]] : [['Cielo', 'Visa', 0.4], ['Cielo', 'Mastercard', 0.4], ['Stone', 'Elo', 0.2]];
      for (const [a, b, s] of parts) {
        const tx = TX.find((x) => x[0] === a && x[1] === b && x[2] === mod);
        const bruto = round2(total * s);
        const esperado = round2(bruto * (1 - tx[3] / 100));
        const prev = addDays(d, tx[4]);
        recIdx++;
        let recebido = null, dataRec = null;
        if (prev < H) {
          recebido = esperado;
          dataRec = prev;
          if (recIdx % 97 === 0) recebido = round2(esperado - rand(3, 15)); // taxa divergente
          if (a === 'Stone' && mod === 'debito' && prev >= addDays(H, -3) && prev < addDays(H, -1)) { recebido = null; dataRec = null; } // atrasado
        }
        ins('recebiveis_cartao', { ...P, data_venda: d, adquirente: a, bandeira: b, modalidade: mod, valor_bruto: bruto, valor_esperado: esperado, data_prevista: prev, valor_recebido: recebido, data_recebida: dataRec, antecipado: 0 });
        if (dataRec) recebEntradas.push({ data: dataRec, valor: recebido, desc: `CRED ${a.toUpperCase()} ${b.toUpperCase()} ${mod.toUpperCase()}` });
      }
    }

    // ------------------------------------------------------------ Contas bancárias, pagar, receber e extrato
    const cb1 = ins('contas_bancarias', { ...P, nome: 'Banco do Brasil — movimento', banco: 'Banco do Brasil', agencia: '1234-5', conta: '98765-4', saldo_inicial: 265000, saldo_data: inicio });
    const cb2 = ins('contas_bancarias', { ...P, nome: 'Caixa — reserva', banco: 'Caixa Econômica', agencia: '0032', conta: '00012345-6', saldo_inicial: 60000, saldo_data: inicio });
    const extrato = [];
    const pagar = (o) => {
      const id = ins('contas_pagar', { ...P, status: 'aberta', ...o });
      if (o.status === 'paga') extrato.push({ conta: cb1, data: o.pagamento_data, valor: -round2(o.valor_pago ?? o.valor), desc: `PAG ${o.descricao}`.toUpperCase().slice(0, 40) });
      return id;
    };
    const NOMES = { gc: 'gasolina comum', ga: 'gasolina aditivada', et: 'etanol', s10: 'diesel S10' };
    for (const dsc of descargasPend) {
      const venc = addDays(dsc.d, 3);
      const valor = round2(dsc.vol * dsc.custo);
      const pago = venc < H;
      pagar({ fornecedor_id: dsc.k === 's10' ? forn.dist2 : forn.dist1, descricao: `Combustível ${NOMES[dsc.k]} ${dsc.vol} L`, conta_id: PC.cmv_comb, valor, vencimento: venc, status: pago ? 'paga' : 'aberta', pagamento_data: pago ? venc : null, valor_pago: pago ? valor : null, juros_multa: 0, aprovado_por: U.gerente });
    }
    for (let m = -2; m <= 1; m++) {
      const base = addMonths(monthStart(H), m);
      const fixas = [
        [forn.energia, 'Energia elétrica', PC.energia, 9800 + randi(-600, 600), 10], [forn.agua, 'Água e esgoto', PC.agua, 780 + randi(-80, 80), 12],
        [forn.aluguel, 'Aluguel do imóvel', PC.aluguel, 18000, 5], [null, 'Folha de pagamento', PC.folha, 41500 + randi(-900, 900), 5],
        [null, 'FGTS', PC.folha, 3350, 7], [null, 'DAS / impostos', PC.impostos, 12800 + randi(-1500, 1500), 20], [forn.contab, 'Honorários contábeis', PC.servicos, 2200, 10],
        [forn.manut, 'Manutenção preventiva bombas', PC.manut, 1450, 15], [forn.sst, 'Assessoria SST (PGR/PCMSO)', PC.sst, 890, 15],
        [forn.bebidas, 'Compra bebidas conveniência', PC.cmv_conv, 7400 + randi(-900, 900), 18], [forn.snacks, 'Compra snacks conveniência', PC.cmv_conv, 3900 + randi(-500, 500), 22],
      ];
      for (const [fid, descricao, conta, valor, dia] of fixas) {
        const venc = addDays(base, dia - 1);
        const pago = venc < H && !(m === 0 && descricao === 'Honorários contábeis');
        const juros = pago && R() < 0.12 ? round2(valor * 0.02) : 0;
        const pagData = pago ? addDays(venc, juros ? randi(2, 6) : 0) : null;
        pagar({ fornecedor_id: fid, descricao: `${descricao} ${base.slice(5, 7)}/${base.slice(0, 4)}`, conta_id: conta, valor, vencimento: venc, status: pago ? 'paga' : 'aberta', pagamento_data: pagData, valor_pago: pago ? round2(valor + juros) : null, juros_multa: juros, aprovado_por: valor > 5000 ? U.gerente : null });
      }
    }
    const cpGrande = ins('contas_pagar', { ...P, fornecedor_id: forn.manut, descricao: 'Troca do compressor de ar da pista', conta_id: PC.manut, valor: 8900, vencimento: addDays(H, 6), status: 'aguardando_aprovacao' });
    ins('aprovacoes', { tipo: 'conta_pagar', descricao: 'Conta a pagar: Troca do compressor de ar da pista', ref_tabela: 'contas_pagar', ref_id: cpGrande, valor: 8900, solicitado_por: U.financeiro, status: 'pendente', created_at: now });

    const clientes = [
      ['Transportadora Seridó Ltda', 'frotista', 25000, 'quinzenal'], ['Construtora Dunas', 'frotista', 15000, 'mensal'], ['Prefeitura — convênio frota', 'frotista', 40000, 'mensal'],
      ['Auto Escola Potengi', 'prazo', 5000, 'mensal'], ['Táxi Cooperativa Natal', 'frotista', 12000, 'quinzenal'], ['Mercadinho Bom Preço', 'prazo', 3000, 'mensal'],
    ].map(([nome, tipo, limite, fat]) => ({ id: ins('clientes', { ...P, nome, tipo, limite_credito: limite, faturamento: fat, bloqueado: 0, documento: `${randi(10, 99)}.${randi(100, 999)}.${randi(100, 999)}/0001-${randi(10, 99)}`, telefone: `(84) 9${randi(8000, 9999)}-${randi(1000, 9999)}` }), nome, limite, fat }));
    for (const c of clientes) {
      for (let k = 0; k < 6; k++) {
        const emissao = addDays(H, -k * (c.fat === 'quinzenal' ? 15 : 30) - 5);
        const venc = addDays(emissao, c.fat === 'quinzenal' ? 10 : 20);
        const valor = round2(c.limite * rand(0.25, 0.55));
        let recebido = venc < H;
        if (c.nome.startsWith('Mercadinho') && k <= 2) recebido = false; // inadimplente
        if (c.nome.startsWith('Auto Escola') && k === 1) recebido = false;
        if (c.nome.startsWith('Construtora') && k === 2) recebido = false;
        const dRec = recebido ? addDays(venc, randi(0, 3)) : null;
        ins('contas_receber', { ...P, cliente_id: c.id, descricao: `Fatura ${emissao.slice(5, 7)}/${emissao.slice(0, 4)} #${k + 1}`, emissao, valor, vencimento: venc, status: recebido && dRec <= H ? 'recebida' : 'aberta', recebimento_data: recebido && dRec <= H ? dRec : null, valor_recebido: recebido && dRec <= H ? valor : null });
        if (recebido && dRec <= H) extrato.push({ conta: cb1, data: dRec, valor, desc: `TED REC ${c.nome}`.toUpperCase().slice(0, 40) });
      }
    }
    upd("UPDATE clientes SET bloqueado = 1 WHERE nome LIKE 'Mercadinho%'");
    ins('cobrancas', { ...P, cliente_id: clientes[5].id, data: addDays(H, -6), meio: 'WhatsApp', resultado: 'Prometeu pagar metade na sexta-feira' });
    for (const r of recebEntradas) extrato.push({ conta: cb1, data: r.data, valor: r.valor, desc: r.desc });
    // depósitos de dinheiro e PIX recebidos
    for (const row of db.prepare(`SELECT t.data, SUM(c.dinheiro) AS din, SUM(c.pix) AS pix FROM caixas c JOIN turnos t ON t.id = c.turno_id GROUP BY t.data`).all()) {
      if (row.data >= H) continue;
      extrato.push({ conta: cb1, data: addDays(row.data, 1) > H ? row.data : addDays(row.data, 1), valor: round2(row.din), desc: 'DEP DINHEIRO CAIXA' });
      extrato.push({ conta: cb1, data: row.data, valor: round2(row.pix), desc: 'PIX RECEBIDOS' });
    }
    extrato.push({ conta: cb1, data: addDays(H, -1), valor: -87.5, desc: 'TARIFA PACOTE SERVICOS' });
    extrato.push({ conta: cb1, data: addDays(H, -3), valor: -1290, desc: 'PAG BOLETO DESCONHECIDO' });
    let fit = 1;
    for (const e of extrato.filter((x) => x.data <= H && x.valor).sort((a, b) => a.data.localeCompare(b.data))) {
      ins('extrato', { ...P, conta_bancaria_id: e.conta, data: e.data, descricao: e.desc, valor: e.valor, fitid: `SEED${fit++}` });
    }

    // ------------------------------------------------------------ RH: atestados, ASOs, treinamentos, férias, EPI, advertências
    ins('atestados', { ...P, funcionario_id: byName('Antônio').id, data_inicio: addDays(H, -40), dias: 10, cid: 'M54.5', medico: 'Dr. Paulo — CRM/RN 1234' });
    ins('atestados', { ...P, funcionario_id: byName('Antônio').id, data_inicio: addDays(H, -18), dias: 8, cid: 'M54.5', medico: 'Dr. Paulo — CRM/RN 1234' });
    ins('atestados', { ...P, funcionario_id: byName('Luciana').id, data_inicio: addDays(H, -2), dias: 3, cid: null, medico: 'UPA Zona Sul' });
    for (const [a, dias] of [['Antônio', [-40, 10]], ['Antônio', [-18, 8]], ['Luciana', [-2, 3]]]) {
      for (let k = 0; k < dias[1]; k++) upd("UPDATE ponto SET ocorrencia = 'atestado', entrada = NULL, saida = NULL, saida_intervalo = NULL, retorno_intervalo = NULL WHERE funcionario_id = ? AND data = ? AND ocorrencia <> 'folga'", byName(a).id, addDays(H, dias[0] + k));
    }
    for (const f of F) {
      const dataAso = addDays(H, -randi(30, 300));
      let validade = addYears(dataAso, 1);
      if (f.nome.startsWith('Rafael')) validade = addDays(H, 10);
      ins('asos', { ...P, funcionario_id: f.id, tipo: 'Periódico', data: dataAso, validade, benzeno: /Frentista|GNV|Chefe/.test(f.funcao) ? 1 : 0, resultado: 'Apto' });
      if (/Frentista|GNV|Chefe/.test(f.funcao)) {
        const d = addDays(H, -randi(60, 700));
        let val = addYears(d, 2);
        if (f.nome.startsWith('Luciana')) val = addDays(H, 20);
        if (f.nome.startsWith('José')) val = addDays(H, -5);
        ins('treinamentos', { ...P, funcionario_id: f.id, tipo: 'NR-20 Inflamáveis e combustíveis', data: d, validade: val, carga_horaria: 16 });
        ins('treinamentos', { ...P, funcionario_id: f.id, tipo: 'Benzeno (NR-9 Anexo 2)', data: d, validade: addYears(d, 1) > H ? addYears(d, 1) : addYears(H, 1), carga_horaria: 4 });
      }
    }
    for (const f of [byName('Roberto'), byName('Marcos'), byName('Carlos')]) ins('treinamentos', { ...P, funcionario_id: f.id, tipo: 'Brigada de incêndio (NR-23)', data: addDays(H, -200), validade: addDays(H, 165), carga_horaria: 8 });
    for (const f of [byName('Juliana'), byName('Patrícia')]) ins('treinamentos', { ...P, funcionario_id: f.id, tipo: 'Boas práticas (manipulação de alimentos)', data: addDays(H, -300), validade: addDays(H, 65), carga_horaria: 8 });
    // férias: períodos já gozados; alguns pendentes perto do limite concessivo (alertas)
    for (const f of F) {
      for (let ini = f.admissao; addYears(ini, 1) <= H; ini = addYears(ini, 1)) {
        const limite = addDays(addYears(ini, 2), -1);
        const pendente = /^(João|Francisco)/.test(f.nome) && limite > H && limite <= addDays(H, 90);
        if (pendente) continue;
        if (f.nome.startsWith('Maria José') && limite > H) {
          ins('ferias', { ...P, funcionario_id: f.id, aquisitivo_inicio: ini, inicio: addDays(H, 5), dias: 30, status: 'programada' });
          continue;
        }
        if (limite > addDays(H, 200)) continue; // ainda a programar
        let inicioF = addDays(addYears(ini, 1), randi(30, 200));
        if (inicioF > addDays(limite, -30)) inicioF = addDays(limite, -60);
        if (inicioF < H) ins('ferias', { ...P, funcionario_id: f.id, aquisitivo_inicio: ini, inicio: inicioF, dias: 30, status: 'gozada' });
      }
    }

    const EPI = {};
    for (const [k, nome, tipo, tam, ca, caVal, est, rep, troca] of [
      ['luva', 'Luva nitrílica', 'epi', 'G', '12345', addYears(H, 2), 40, 20, 30], ['bota', 'Botina de segurança', 'epi', '40', '23456', addDays(H, -12), 6, 4, 365],
      ['oculos', 'Óculos de proteção', 'epi', 'Único', '34567', addYears(H, 3), 10, 5, 180], ['protetor', 'Protetor auricular', 'epi', 'Único', '45678', addYears(H, 1), 50, 20, 90],
      ['avental', 'Avental impermeável (descarga)', 'epi', 'Único', '56789', addYears(H, 2), 3, 2, 365], ['camisaM', 'Camisa uniforme', 'uniforme', 'M', null, null, 8, 5, 180],
      ['camisaG', 'Camisa uniforme', 'uniforme', 'G', null, null, 3, 5, 180], ['calca', 'Calça uniforme', 'uniforme', 'G', null, null, 9, 5, 180], ['bone', 'Boné', 'uniforme', 'Único', null, null, 15, 5, 365],
    ]) EPI[k] = ins('epi_itens', { ...P, nome, tipo, tamanho: tam, ca, ca_validade: caVal, estoque: est, ponto_reposicao: rep, troca_dias: troca });
    for (const f of F.filter((x) => /Frentista|GNV|Chefe/.test(x.funcao))) {
      for (const k of ['luva', 'oculos', 'camisaG', 'calca', 'bota']) {
        if (f.nome.startsWith('José') && k === 'oculos') continue;
        const d = k === 'luva' ? addDays(H, -randi(5, 50)) : addDays(H, -randi(30, 170));
        ins('epi_entregas', { ...P, funcionario_id: f.id, item_id: EPI[k], quantidade: 1, data: d, ca: k === 'bota' ? '23456' : null, assinado_at: f.nome.startsWith('Pedro') && k === 'luva' ? null : `${d}T10:00:00` });
      }
    }
    ins('advertencias', { ...P, funcionario_id: byName('João').id, tipo: 'escrita', data: addDays(H, -25), motivo: 'Reincidência em falta de caixa sem justificativa', testemunhas: 'Roberto Lima', assinado_at: `${addDays(H, -25)}T15:00:00` });
    ins('advertencias', { ...P, funcionario_id: byName('Pedro').id, tipo: 'verbal', data: addDays(H, -8), motivo: 'Uso de celular na pista durante abastecimento', assinado_at: null });
    const com1 = ins('comunicados', { ...P, titulo: 'Novo procedimento de sangria', data: addDays(H, -3), texto: 'A partir de segunda-feira, toda sangria acima de R$ 300 deve ser feita na presença do chefe de pista e registrada no aplicativo.', exige_assinatura: 1 });
    ins('comunicados', { ...P, titulo: 'Treinamento de brigada — próximo mês', data: addDays(H, -10), texto: 'Teremos reciclagem da brigada de incêndio. Verifique sua escala.', exige_assinatura: 1 });
    for (const f of F.slice(0, 8)) ins('comunicados_leitura', { ...P, comunicado_id: com1, funcionario_id: f.id, lido_at: `${addDays(H, -2)}T08:00:00` });
    ins('trocas_folga', { ...P, funcionario_id: byName('Luciana').id, data_folga: addDays(H, 3), data_nova: addDays(H, 5), motivo: 'Consulta médica do filho', status: 'solicitada' });

    for (let m = 1; m <= 3; m++) {
      const comp = addMonths(monthStart(H), -m).slice(0, 7);
      for (const ev of ['S-2220', 'S-2240']) ins('esocial_sst', { ...P, competencia: comp, evento: ev, quantidade: randi(1, 4), enviado: m === 1 && ev === 'S-2240' ? 0 : 1, recibo: m === 1 && ev === 'S-2240' ? null : `1.2.${randi(100000, 999999)}` });
    }

    // ------------------------------------------------------------ Conveniência: validade, perdas, contagens, temperaturas, nota pendente
    const prodBy = (n) => PR.find((p) => p.nome.startsWith(n));
    for (const [n, dias, q] of [['Sanduíche', 2, 6], ['Iogurte', 0, 0], ['Suco', 12, 10], ['Pão de queijo', 5, 30], ['Chocolate', 25, 20], ['Biscoito', 40, 25], ['Pote sorvete', 60, 8]]) {
      const p = prodBy(n);
      if (p) ins('lotes_validade', { ...P, produto_id: p.id, lote: `L${randi(1000, 9999)}`, validade: addDays(H, dias), quantidade: q, baixado: 0 });
    }
    for (const [n, tipo, q, d] of [['Refrigerante lata', 'avaria', 3, -12], ['Sanduíche', 'vencimento', 4, -6], ['Cerveja', 'quebra', 2, -3], ['Café', 'consumo_interno', 20, -1], ['Chocolate', 'furto', 2, -15]]) {
      const p = prodBy(n);
      ins('perdas', { ...P, data: addDays(H, d), produto_id: p.id, tipo, quantidade: q, valor: round2(q * p.custo), responsavel_id: byName('Juliana').id });
    }
    for (const [n, sis, cont, st] of [['Energético', 90, 87, 'ajustado'], ['Chiclete', 150, 150, 'sem_divergencia'], ['Cigarro', 200, 196, 'pendente']]) {
      const p = prodBy(n);
      const cid = ins('contagens', { ...P, data: addDays(H, -2), tipo: 'ciclica', produto_id: p.id, sistema: sis, contado: cont, diferenca: cont - sis, valor_diferenca: round2((cont - sis) * p.custo), status: st });
      if (st === 'pendente') ins('aprovacoes', { tipo: 'ajuste_estoque', descricao: `Ajuste de estoque: ${p.nome} (${cont - sis})`, ref_tabela: 'contagens', ref_id: cid, valor: round2((cont - sis) * p.custo), solicitado_por: U.conveniencia, status: 'pendente', created_at: now });
    }
    for (let k = 14; k >= 1; k--) {
      for (const eq of ['Geladeira bebidas 1', 'Geladeira bebidas 2', 'Freezer sorvetes']) {
        let t = eq.startsWith('Freezer') ? round2(rand(-21, -17)) : round2(rand(2, 6));
        if (k === 1 && eq === 'Geladeira bebidas 2') t = 9.5;
        ins('temperaturas', { ...P, data: addDays(H, -k), hora: '08:00', equipamento: eq, temperatura: t, responsavel_id: byName('Juliana').id });
      }
    }
    ins('notas_entrada', {
      ...P, fornecedor_id: forn.bebidas, numero: '458721', chave: '24' + String(randi(1e9, 9e9)) + '0'.repeat(32), data: addDays(H, -1), valor: 1534.8, status: 'pendente', pedido_ref: 'PC-2026-118',
      itens: [
        { codigo: '7892', descricao: 'REFRIG LATA 350ML', qtd_nf: 240, custo_nf: 2.75, total: 660, produto_id: prodBy('Refrigerante lata').id, produto: 'Refrigerante lata 350 ml', custo_anterior: 2.6 },
        { codigo: '7891', descricao: 'AGUA MINERAL 500ML', qtd_nf: 300, custo_nf: 1.1, total: 330, produto_id: prodBy('Água').id, produto: 'Água mineral 500 ml', custo_anterior: 1.1 },
        { codigo: '7894', descricao: 'ENERGETICO 250ML', qtd_nf: 60, custo_nf: 6.1, total: 366, produto_id: prodBy('Energético').id, produto: 'Energético 250 ml', custo_anterior: 5.9 },
        { codigo: '7896', descricao: 'SUCO 1L', qtd_nf: 20, custo_nf: 8.94, total: 178.8, produto_id: prodBy('Suco').id, produto: 'Suco 1 L', custo_anterior: 4.8 },
      ],
    });

    // ------------------------------------------------------------ Equipamentos e meio ambiente
    for (let k = 0; k < 10; k++) {
      const d = addDays(H, -7 * k - 1);
      for (const b of B.slice(0, 7)) {
        const vol = round2(20 + rand(-0.06, 0.07));
        const erro = Math.round((vol - 20) * 1000);
        ins('equipamentos', { ...P, tipo: 'Aferição de bomba (20 L)', item: `Bico ${b.id}`, bico_id: b.id, data: d, volume_medido: vol, resultado: `${erro >= 0 ? '+' : ''}${erro} mL — ${Math.abs(erro) <= 100 ? 'dentro da tolerância' : 'FORA da tolerância'}`, proxima_data: addDays(d, 7), responsavel: 'Roberto Lima' });
      }
    }
    upd("UPDATE equipamentos SET item = 'Bicos (semanal)' WHERE tipo = 'Aferição de bomba (20 L)'");
    for (const [tipo, item, d, prox, resp] of [
      ['Verificação Inmetro/IPEM', 'Todas as bombas', -300, 65, 'IPEM/RN'], ['Teste de estanqueidade', 'Tanques T1–T4 e linhas', -340, 25, 'Ambiental Testes Ltda'],
      ['Monitoramento intersticial / poços', 'Poços PM-01 a PM-04', -28, 2, 'Roberto Lima'], ['Caixa separadora água e óleo', 'CSAO principal', -25, 5, 'Limpa Óleo RN (MTR 2026-0457)'],
      ['Troca de filtro de diesel', 'Bomba 3/4', -80, 10, 'TecBombas'], ['Manutenção compressor GNV', 'Compressor GNV', -55, 35, 'GásTec'], ['Inspeção vaso de pressão (NR-13)', 'Cilindros GNV', -330, 35, 'Inspetora NR-13'],
      ['Extintores', '12 extintores', -200, 165, 'Extintores Potiguar'],
    ]) ins('equipamentos', { ...P, tipo, item, data: addDays(H, d), proxima_data: addDays(H, prox), responsavel: resp, resultado: 'Conforme', horas_operacao: tipo.includes('compressor') ? 18450 : null, mtr: tipo.includes('separadora') ? 'MTR 2026-0457' : null });

    // ------------------------------------------------------------ Preços: concorrentes, pesquisas, ANP, histórico
    const conc = [['Posto Ponta Negra', 'Av. Roberto Freire, 2100', 'Ipiranga', 1.2], ['Auto Posto Capim Macio', 'Rua Missionário Gunnar Vingren, 300', 'Shell', 1.8],
      ['Posto Via Costeira', 'Via Costeira, km 3', 'BR', 2.5], ['Posto Econômico Neópolis', 'Av. Ayrton Senna, 900', 'Bandeira branca', 3.1], ['Posto Lagoa Nova', 'Av. Prudente de Morais, 4500', 'Ipiranga', 4.0]]
      .map(([nome, endereco, bandeira, dist]) => ins('concorrentes', { ...P, nome, endereco, bandeira, distancia_km: dist }));
    const deltas = [0.06, 0.1, 0.0, -0.12, 0.04];
    for (let k = 40; k >= 1; k -= 2) {
      const d = addDays(H, -k);
      for (const [i, co] of conc.entries()) {
        for (const key of ['gc', 'et', 's10', 'ga']) {
          if (key === 'ga' && i > 2) continue;
          const base = C[key].preco + deltas[i] + (key === 'et' ? -0.03 : 0);
          ins('pesquisas_preco', { ...P, data: d, hora: '10:30', concorrente_id: co, combustivel_id: C[key].id, preco: Math.round((base + rand(-0.04, 0.04)) * 100) / 100 - 0.01 });
        }
        if (i < 2) ins('pesquisas_preco', { ...P, data: d, hora: '10:40', concorrente_id: co, combustivel_id: C.gnv.id, preco: 5.09 + deltas[i] / 2 });
      }
    }
    for (let k = 8; k >= 0; k--) {
      const d = addDays(H, -k * 7 - weekday(H) - 1);
      for (const key of ['gc', 'ga', 'et', 's10', 'gnv']) {
        const m = C[key].preco + 0.03 + rand(-0.05, 0.05);
        ins('precos_anp', { data: d, combustivel_id: C[key].id, preco_medio: Math.round(m * 1000) / 1000, preco_min: Math.round((m - 0.25) * 100) / 100, preco_max: Math.round((m + 0.3) * 100) / 100 });
      }
    }
    ins('historico_precos', { ...P, data: `${addDays(inicio, 20)}T07:10:00`, combustivel_id: C.gc.id, preco_anterior: 6.29, preco_novo: 6.19, motivo: 'Promoção de fim de semana', usuario_id: U.gerente, painel_atualizado: 1 });
    ins('historico_precos', { ...P, data: `${addDays(inicio, 21)}T07:05:00`, combustivel_id: C.gc.id, preco_anterior: 6.19, preco_novo: 6.29, motivo: 'Fim da promoção', usuario_id: U.gerente, painel_atualizado: 1 });

    // ------------------------------------------------------------ Documentos e licenças
    const DOCS = [
      ['Autorização de revenda varejista', 'Regulatório (ANP)', 'ANP', null, 'Manter dados cadastrais atualizados no SIMP/ANP.', 0, 30],
      ['Licença de operação ambiental', 'Ambiental', 'IDEMA/RN', 45, 'Requerimento no portal do IDEMA; laudo de estanqueidade; relatório de monitoramento; ART do responsável técnico; taxa. Protocolar 120 dias antes do vencimento.', 4800, 90],
      ['AVCB — Auto de Vistoria do Corpo de Bombeiros', 'Bombeiros', 'CBM-RN', 12, 'Projeto aprovado; ART de extintores e hidrantes; certificado de brigada; taxa de vistoria.', 1200, 45],
      ['Alvará de funcionamento', 'Prefeitura', 'SEMURB — Natal', 160, 'Requerimento; AVCB vigente; licença ambiental; taxa TLF.', 650, 20],
      ['Alvará sanitário (conveniência)', 'Vigilância sanitária', 'Vigilância Sanitária de Natal', 80, 'Manual de Boas Práticas; certificados de dedetização e caixa d\'água; curso de manipuladores.', 380, 30],
      ['Certificado de verificação do Inmetro', 'Inmetro/IPEM', 'IPEM/RN', 65, 'Agendar verificação periódica das bombas.', 900, 30],
      ['Laudo de estanqueidade dos tanques', 'Ambiental', 'Ambiental Testes Ltda', 25, 'Contratar empresa acreditada pelo Inmetro.', 3500, 15],
      ['Certificado de controle de pragas', 'Vigilância sanitária', 'DedetizaRN', 33, 'Agendar nova aplicação (trimestral).', 450, 3],
      ['Certificado de limpeza da caixa d\'água', 'Vigilância sanitária', 'DedetizaRN', 95, 'Semestral.', 350, 3],
      ['Certidão negativa federal (Receita/PGFN)', 'Certidões', 'Receita Federal', 70, 'Emitir no site da Receita.', 0, 1],
      ['Certidão negativa estadual', 'Certidões', 'SEFAZ/RN', 22, 'Emitir no portal da SEFAZ.', 0, 1],
      ['Certidão negativa municipal', 'Certidões', 'Prefeitura de Natal', 41, 'Emitir no portal da prefeitura.', 0, 1],
      ['Certificado de regularidade do FGTS (CRF)', 'Certidões', 'Caixa', 5, 'Emitir no site da Caixa (validade 30 dias).', 0, 1],
      ['Certidão negativa de débitos trabalhistas (CNDT)', 'Certidões', 'TST', 120, 'Emitir no site do TST.', 0, 1],
      ['Certificado digital e-CNPJ A1', 'Certificado digital', 'AC Certisign', 25, 'Agendar validação; sem ele param NF-e, eSocial e envio fiscal.', 260, 2],
      ['Contrato com a distribuidora', 'Contratos', 'Distribuidora Nordeste', 400, 'Verificar metas de volume.', 0, 0],
      ['Apólice de seguro patrimonial e RC ambiental', 'Seguros', 'Seguradora Potiguar', 130, 'Cotar com 3 seguradoras 30 dias antes.', 7800, 10],
      ['Contrato de locação do imóvel', 'Contratos', 'Imobiliária Ponta Negra', 300, 'Reajuste anual pelo IGP-M.', 0, 0],
      ['PGR — Programa de Gerenciamento de Riscos (NR-1)', 'SST', 'SegTrab', 150, 'Revisão anual com o responsável técnico.', 1800, 20],
      ['PCMSO (NR-7)', 'SST', 'SegTrab', 150, 'Revisão anual.', 1200, 20],
      ['LTCAT / laudo de periculosidade', 'SST', 'SegTrab', 500, 'Revisar quando houver mudança no ambiente.', 2500, 30],
      ['Convenção coletiva — Sindicato dos Frentistas', 'Sindicato', 'Sinpospetro/RN', 110, 'Acompanhar negociação do reajuste e novo piso.', 0, 0],
      ['Manual de Boas Práticas e POPs', 'Vigilância sanitária', 'Responsável técnico', -3, 'Revisão anual do manual.', 600, 10],
    ];
    for (const [nome, categoria, orgao, dias, check, custo, prazo] of DOCS) {
      ins('documentos', {
        ...P, nome, categoria, orgao, numero: `${randi(1000, 99999)}/${H.slice(0, 4)}`, emissao: dias != null ? addDays(H, dias - 365) : '2015-06-10',
        validade: dias != null ? addDays(H, dias) : null, responsavel_id: categoria === 'SST' ? U.rh : categoria === 'Vigilância sanitária' ? U.conveniencia : U.gerente,
        em_renovacao: nome.startsWith('AVCB') ? 1 : 0, protocolo: nome.startsWith('AVCB') ? `CBM-${randi(100000, 999999)}` : null,
        checklist_renovacao: check, custo_renovacao: custo, prazo_medio_dias: prazo, fiscalizacao: 1,
      });
    }

    // ------------------------------------------------------------ Agenda de obrigações recorrentes (PRD seção 11)
    const modelos = [
      ['Abertura de turno (checklist da pista)', 'pista', 'diaria', null, null, null, '06:30', 'chefe_pista', 'abertura_turno'],
      ['Leitura de encerrantes e medição dos tanques', 'pista', 'diaria', null, null, null, '07:00', 'chefe_pista', 'medicao_tanques'],
      ['Fechamento de turno', 'pista', 'diaria', null, null, null, '23:00', 'chefe_pista', 'fechamento_turno'],
      ['Fechamento de caixa por frentista', 'pista', 'diaria', null, null, null, '23:00', 'chefe_pista', 'fechamento_caixa'],
      ['LMC do dia', 'combustiveis', 'diaria', null, null, null, '10:00', 'financeiro', 'lmc'],
      ['Conciliação bancária', 'financeiro', 'diaria', null, null, null, '11:00', 'financeiro', 'conciliacao_bancaria'],
      ['Conciliação de cartões', 'financeiro', 'diaria', null, null, null, '11:30', 'financeiro', 'conciliacao_cartoes'],
      ['Baixa de pagamentos e recebimentos', 'financeiro', 'diaria', null, null, null, '16:00', 'financeiro', 'baixas'],
      ['Conferência dos fechamentos de caixa', 'financeiro', 'diaria', null, null, null, '10:30', 'financeiro', 'conferencia_caixas'],
      ['Temperatura de geladeiras e freezers', 'conveniencia', 'diaria', null, null, null, '08:30', 'conveniencia', 'temperatura'],
      ['Pesquisa de preço dos concorrentes', 'precos', 'semanal', 1, null, null, '12:00', 'chefe_pista', 'pesquisa_preco'],
      ['Pesquisa de preço dos concorrentes', 'precos', 'semanal', 3, null, null, '12:00', 'chefe_pista', 'pesquisa_preco'],
      ['Pesquisa de preço dos concorrentes', 'precos', 'semanal', 5, null, null, '12:00', 'chefe_pista', 'pesquisa_preco'],
      ['Contagem cíclica da conveniência', 'conveniencia', 'semanal', 2, null, null, null, 'conveniencia', 'contagem_ciclica'],
      ['Aferição das bombas (20 L)', 'combustiveis', 'semanal', 1, null, null, null, 'chefe_pista', 'afericao'],
      ['Revisão de inadimplência', 'financeiro', 'semanal', 1, null, null, null, 'financeiro', null],
      ['Conferência das escalas da semana seguinte', 'rh', 'semanal', 4, null, null, null, 'rh', null],
      ['Validade de produtos da conveniência', 'conveniencia', 'semanal', 1, null, null, null, 'conveniencia', null],
      ['Fechamento do ponto e do DP', 'rh', 'mensal', null, 3, null, null, 'rh', 'fechamento_dp'],
      ['Comissões do grid', 'rh', 'mensal', null, 3, null, null, 'rh', null],
      ['Faltas de caixa e descontos', 'pista', 'mensal', null, 2, null, null, 'gerente', null],
      ['Envio do pacote fiscal/contábil/RH à contabilidade', 'contabil', 'mensal', null, 5, null, null, 'financeiro', 'pacote_contabil'],
      ['DRE gerencial', 'financeiro', 'mensal', null, 8, null, null, 'gerente', null],
      ['Revisão de EPI e uniformes', 'rh', 'mensal', null, 10, null, null, 'rh', null],
      ['Limpeza da caixa d\'água', 'conveniencia', 'semestral', null, 15, '1,7', null, 'conveniencia', null],
      ['Exames periódicos ligados ao benzeno (PCMSO)', 'rh', 'semestral', null, 10, '3,9', null, 'rh', null],
      ['Revisão das certidões negativas', 'documentos', 'semestral', null, 5, '1,7', null, 'financeiro', null],
      ['Renovação de alvarás e licenças (revisão geral)', 'documentos', 'anual', null, 15, '1', null, 'gerente', null],
      ['Revisão do PGR e PCMSO', 'rh', 'anual', null, 10, '3', null, 'rh', null],
      ['Reciclagem NR-20 e brigada', 'rh', 'anual', null, 10, '4', null, 'rh', null],
      ['Planejamento anual de férias', 'rh', 'anual', null, 5, '11', null, 'rh', null],
      ['13º salário — 1ª parcela (até 30/11)', 'rh', 'anual', null, 25, '11', null, 'rh', null],
      ['13º salário — 2ª parcela (até 20/12)', 'rh', 'anual', null, 15, '12', null, 'rh', null],
      ['Verificação do Inmetro', 'combustiveis', 'anual', null, 10, '12', null, 'gerente', null],
      ['Teste de estanqueidade (conforme licença)', 'combustiveis', 'anual', null, 5, '11', null, 'gerente', null],
    ];
    for (const [titulo, modulo, frequencia, dia_semana, dia_mes, meses, hora_limite, perfil, chave] of modelos) {
      ins('tarefas_modelo', { titulo, modulo, frequencia, dia_semana, dia_mes, meses, hora_limite, perfil, chave, ativo: 1 });
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  // Pós-processamento com as regras do sistema (tarefas, conciliação)
  const core = require('./services/core');
  const fin = require('./services/financeiro');
  core.gerarTarefas(db, addDays(H, -14), addDays(H, 7));
  // tarefas passadas: maioria concluída
  const gerente = db.prepare("SELECT * FROM usuarios WHERE login = 'gerente'").get();
  db.prepare("UPDATE tarefas SET concluida_at = data_prevista || 'T' || COALESCE(hora_limite, '17:00') || ':00', concluida_por = ? WHERE data_prevista < ? AND (id % 11) <> 0").run(gerente.id, H);
  // hoje: rotinas da manhã já feitas, exceto LMC e conciliação (aparecem como pendentes/atrasadas)
  const agora = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
  db.prepare(`UPDATE tarefas SET concluida_at = data_prevista || 'T' || hora_limite || ':00', concluida_por = ? WHERE data_prevista = ? AND hora_limite IS NOT NULL AND hora_limite < ?
    AND modelo_id IN (SELECT id FROM tarefas_modelo WHERE chave IN ('abertura_turno','medicao_tanques','temperatura','conferencia_caixas'))`).run(gerente.id, H, agora);
  const ctx = { db, user: gerente, postoId: null };
  fin.conciliarAutomatico(ctx);
  // deixa os últimos lançamentos sem conciliação para demonstrar a rotina
  db.prepare("UPDATE extrato SET conciliado_tipo = NULL, conciliado_id = NULL WHERE data >= ?").run(addDays(H, -1));
  return true;
}

module.exports = { seed };

if (require.main === module) {
  const { open } = require('./db');
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
  const file = path.join(dataDir, 'posto.db');
  if (process.argv.includes('--reset')) {
    for (const f of [file, file + '-wal', file + '-shm']) if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  const db = open(file);
  if (db.prepare('SELECT 1 FROM usuarios LIMIT 1').get()) {
    console.log('Banco já possui dados. Use `npm run seed` (com --reset) para recriar.');
  } else {
    const t = Date.now();
    seed(db);
    console.log(`Dados de demonstração criados em ${((Date.now() - t) / 1000).toFixed(1)}s → ${file}`);
  }
}
