'use strict';
// Catálogo de recursos (tabelas) da plataforma. Cada recurso descreve seus campos,
// quem pode ler/escrever e como aparece nas telas genéricas de cadastro.
// O esquema do banco é gerado a partir daqui (ver db.js).

const ROLES = {
  proprietario: 'Proprietário',
  gerente: 'Gerente',
  chefe_pista: 'Chefe de pista',
  frentista: 'Frentista / caixa',
  financeiro: 'Auxiliar administrativo / financeiro',
  rh: 'Responsável RH/DP',
  conveniencia: 'Responsável conveniência',
  contabilidade: 'Contabilidade (externo)',
};

// Grupos de acesso usados abaixo
const G = 'gerente';
const P = 'proprietario';
const ALL_INTERNAL = [P, G, 'chefe_pista', 'financeiro', 'rh', 'conveniencia'];

const MODULES = {
  painel: { label: 'Painel do gerente', roles: [P, G] },
  pista: { label: 'Pista', roles: [P, G, 'chefe_pista'] },
  rh: { label: 'RH / DP', roles: [P, G, 'rh'] },
  financeiro: { label: 'Financeiro', roles: [P, G, 'financeiro'] },
  conveniencia: { label: 'Conveniência', roles: [P, G, 'conveniencia'] },
  combustiveis: { label: 'Combustíveis', roles: [P, G, 'financeiro', 'chefe_pista'] },
  precos: { label: 'Preços e margem', roles: [P, G, 'chefe_pista', 'financeiro'] },
  documentos: { label: 'Documentos e licenças', roles: [P, G, 'rh', 'financeiro', 'conveniencia'] },
  agenda: { label: 'Agenda e checklists', roles: ALL_INTERNAL },
  cadastros: { label: 'Cadastros', roles: [P, G, 'rh', 'financeiro', 'conveniencia', 'chefe_pista'] },
  admin: { label: 'Administração', roles: [P, G] },
  contabil: { label: 'Pacote contábil', roles: [P, G, 'rh', 'financeiro', 'contabilidade'] },
  meu: { label: 'Minha área', roles: ['frentista', 'chefe_pista', 'rh', 'financeiro', 'conveniencia'] },
};

const opt = (...vals) => vals.map((v) => (Array.isArray(v) ? { value: v[0], label: v[1] } : { value: v, label: v }));

const TURNOS = opt(['manha', 'Manhã'], ['tarde', 'Tarde'], ['noite', 'Noite']);

const R = [];
function def(r) {
  r.fields = r.fields.map((f) => ({ list: false, ...f }));
  R.push(r);
  return r;
}

// ---------------------------------------------------------------- Cadastros
def({
  name: 'postos', label: 'Postos', module: 'cadastros', display: 'nome', posto: false,
  read: ALL_INTERNAL.concat('contabilidade', 'frentista'), write: [G],
  fields: [
    { name: 'nome', label: 'Nome', type: 'text', required: true, list: true },
    { name: 'cnpj', label: 'CNPJ', type: 'text', list: true },
    { name: 'endereco', label: 'Endereço', type: 'text' },
    { name: 'cidade', label: 'Cidade', type: 'text', list: true },
    { name: 'uf', label: 'UF', type: 'text', list: true },
    { name: 'bandeira', label: 'Bandeira', type: 'text', list: true },
  ],
});

def({
  name: 'funcionarios', label: 'Funcionários', module: 'rh', display: 'nome', order: 'nome',
  read: [P, G, 'rh', 'chefe_pista', 'financeiro'], write: [G, 'rh'],
  fields: [
    { name: 'nome', label: 'Nome', type: 'text', required: true, list: true },
    { name: 'cpf', label: 'CPF', type: 'text', list: true },
    { name: 'pis', label: 'PIS', type: 'text' },
    { name: 'nascimento', label: 'Nascimento', type: 'date' },
    { name: 'funcao', label: 'Função', type: 'select', list: true, options: opt('Frentista', 'Frentista caixa', 'Chefe de pista', 'Operador GNV', 'Atendente conveniência', 'Auxiliar administrativo', 'Gerente', 'Lavador', 'Trocador de óleo') },
    { name: 'admissao', label: 'Admissão', type: 'date', required: true, list: true },
    { name: 'demissao', label: 'Demissão', type: 'date' },
    { name: 'salario', label: 'Salário base', type: 'money', list: true },
    { name: 'periculosidade', label: 'Adicional de periculosidade (30%)', type: 'bool' },
    { name: 'dependentes', label: 'Dependentes', type: 'int' },
    { name: 'escala_tipo', label: 'Escala', type: 'select', options: opt('6x1', '12x36', '5x2', 'revezamento'), list: true },
    { name: 'horario_entrada', label: 'Horário de entrada', type: 'time' },
    { name: 'jornada_min', label: 'Jornada diária (minutos)', type: 'int', help: 'Ex.: 440 = 7h20 (6x1); 660 = 11h (12x36)' },
    { name: 'gnv_habilitado', label: 'Operador GNV habilitado', type: 'bool' },
    { name: 'meta_grid', label: 'Meta mensal do grid (R$)', type: 'money' },
    { name: 'tamanho_uniforme', label: 'Tamanho uniforme', type: 'select', options: opt('P', 'M', 'G', 'GG', 'XG') },
    { name: 'calcado', label: 'Nº calçado', type: 'int' },
    { name: 'telefone', label: 'Telefone/WhatsApp', type: 'text' },
    { name: 'email', label: 'E-mail', type: 'text' },
    { name: 'banco_conta', label: 'Conta para pagamento', type: 'text' },
    { name: 'endereco', label: 'Endereço', type: 'text' },
    { name: 'consentimento_lgpd', label: 'Consentimento LGPD assinado', type: 'bool' },
    { name: 'docs', label: 'Documentos (contrato, ficha de registro, termos)', type: 'files' },
    { name: 'ativo', label: 'Ativo', type: 'bool', default: 1, list: true },
  ],
});

def({
  name: 'fornecedores', label: 'Fornecedores', module: 'cadastros', display: 'nome', order: 'nome', posto: false,
  read: ALL_INTERNAL, write: [G, 'financeiro', 'conveniencia'],
  fields: [
    { name: 'nome', label: 'Nome', type: 'text', required: true, list: true },
    { name: 'cnpj', label: 'CNPJ', type: 'text', list: true },
    { name: 'categoria', label: 'Categoria', type: 'select', list: true, options: opt('Distribuidora', 'Conveniência', 'Serviços', 'Manutenção', 'Energia/Água', 'Impostos', 'Folha', 'Aluguel', 'SST', 'Outros') },
    { name: 'contato', label: 'Contato', type: 'text' },
    { name: 'telefone', label: 'Telefone', type: 'text', list: true },
    { name: 'email', label: 'E-mail', type: 'text' },
  ],
});

def({
  name: 'clientes', label: 'Clientes a prazo / frotistas', module: 'financeiro', display: 'nome', order: 'nome',
  read: [P, G, 'financeiro', 'chefe_pista'], write: [G, 'financeiro'],
  fields: [
    { name: 'nome', label: 'Nome', type: 'text', required: true, list: true },
    { name: 'documento', label: 'CPF/CNPJ', type: 'text', list: true },
    { name: 'tipo', label: 'Tipo', type: 'select', list: true, options: opt(['prazo', 'A prazo'], ['frotista', 'Frotista']) },
    { name: 'limite_credito', label: 'Limite de crédito', type: 'money', list: true },
    { name: 'faturamento', label: 'Faturamento', type: 'select', options: opt(['quinzenal', 'Quinzenal'], ['mensal', 'Mensal']), list: true },
    { name: 'bloqueado', label: 'Bloqueado', type: 'bool', list: true },
    { name: 'contato', label: 'Contato', type: 'text' },
    { name: 'telefone', label: 'Telefone', type: 'text' },
  ],
});

def({
  name: 'combustiveis', label: 'Combustíveis', module: 'combustiveis', display: 'nome', order: 'id', posto: false,
  read: ALL_INTERNAL.concat('frentista'), write: [G],
  fields: [
    { name: 'nome', label: 'Produto', type: 'text', required: true, list: true },
    { name: 'codigo_anp', label: 'Código ANP', type: 'text' },
    { name: 'unidade', label: 'Unidade', type: 'select', options: opt('L', 'm³'), default: 'L', list: true },
    { name: 'preco_bomba', label: 'Preço de bomba', type: 'money3', list: true, help: 'Para alterar com histórico use Preços e margem' },
    { name: 'custo_medio', label: 'Custo última compra (R$/un)', type: 'money3', list: true },
    { name: 'tipo_teste', label: 'Testes de qualidade', type: 'select', options: opt(['gasolina', 'Gasolina (teor de etanol)'], ['etanol', 'Etanol hidratado'], ['diesel', 'Diesel'], ['gnv', 'GNV (sem teste)']) },
  ],
});

def({
  name: 'tanques', label: 'Tanques', module: 'combustiveis', display: 'nome', order: 'nome',
  read: [P, G, 'financeiro', 'chefe_pista'], write: [G],
  fields: [
    { name: 'nome', label: 'Tanque', type: 'text', required: true, list: true },
    { name: 'combustivel_id', label: 'Combustível', type: 'ref', ref: 'combustiveis', required: true, list: true },
    { name: 'capacidade', label: 'Capacidade (L)', type: 'number', list: true },
    { name: 'estoque_minimo', label: 'Estoque de segurança (L)', type: 'number', list: true },
  ],
});

def({
  name: 'bicos', label: 'Bicos / bombas', module: 'combustiveis', display: 'nome', order: 'nome',
  read: [P, G, 'financeiro', 'chefe_pista'], write: [G],
  fields: [
    { name: 'nome', label: 'Bico', type: 'text', required: true, list: true },
    { name: 'bomba', label: 'Bomba', type: 'text', list: true },
    { name: 'combustivel_id', label: 'Combustível', type: 'ref', ref: 'combustiveis', required: true, list: true },
    { name: 'tanque_id', label: 'Tanque', type: 'ref', ref: 'tanques', list: true },
    { name: 'lacre', label: 'Lacre atual', type: 'text', list: true },
    { name: 'encerrante_atual', label: 'Último encerrante', type: 'number', list: true },
  ],
});

def({
  name: 'categorias_conv', label: 'Categorias da conveniência', module: 'conveniencia', display: 'nome', order: 'nome', posto: false,
  read: [P, G, 'conveniencia', 'financeiro'], write: [G, 'conveniencia'],
  fields: [
    { name: 'nome', label: 'Categoria', type: 'text', required: true, list: true },
    { name: 'margem_alvo', label: 'Margem-alvo (%)', type: 'number', list: true },
  ],
});

def({
  name: 'produtos', label: 'Produtos (conveniência e grid)', module: 'conveniencia', display: 'nome', order: 'nome',
  read: [P, G, 'conveniencia', 'financeiro', 'rh', 'chefe_pista'], write: [G, 'conveniencia'],
  fields: [
    { name: 'codigo', label: 'Código', type: 'text', list: true },
    { name: 'ean', label: 'EAN', type: 'text' },
    { name: 'nome', label: 'Produto', type: 'text', required: true, list: true },
    { name: 'categoria_id', label: 'Categoria', type: 'ref', ref: 'categorias_conv', list: true },
    { name: 'local', label: 'Local', type: 'select', options: opt(['conveniencia', 'Conveniência'], ['grid', 'Grid da pista']), default: 'conveniencia', list: true },
    { name: 'custo', label: 'Custo', type: 'money', list: true },
    { name: 'preco', label: 'Preço de venda', type: 'money', list: true },
    { name: 'estoque', label: 'Estoque', type: 'number', list: true },
    { name: 'estoque_minimo', label: 'Estoque mínimo', type: 'number' },
    { name: 'comissao_pct', label: 'Comissão grid (%)', type: 'number' },
    { name: 'ativo', label: 'Ativo', type: 'bool', default: 1 },
  ],
});

// ---------------------------------------------------------------- Pista
def({
  name: 'turnos', label: 'Turnos', module: 'pista', display: 'data', order: 'data DESC, id DESC',
  read: [P, G, 'chefe_pista', 'financeiro'], write: [G, 'chefe_pista'],
  fields: [
    { name: 'data', label: 'Data', type: 'date', required: true, list: true },
    { name: 'periodo', label: 'Turno', type: 'select', options: TURNOS, required: true, list: true },
    { name: 'chefe_id', label: 'Chefe de pista', type: 'ref', ref: 'funcionarios', list: true },
    { name: 'status', label: 'Status', type: 'select', options: opt(['aberto', 'Aberto'], ['fechado', 'Fechado']), default: 'aberto', list: true },
    { name: 'abertura_at', label: 'Abertura', type: 'datetime', list: true },
    { name: 'fechamento_at', label: 'Fechamento', type: 'datetime', list: true },
    { name: 'presencas', label: 'Presenças', type: 'json', hidden: true },
    { name: 'checklist_abertura', label: 'Checklist abertura', type: 'json', hidden: true },
    { name: 'checklist_fechamento', label: 'Checklist fechamento', type: 'json', hidden: true },
    { name: 'obs', label: 'Observações', type: 'textarea' },
  ],
});

def({
  name: 'encerrantes', label: 'Encerrantes', module: 'pista', display: 'id', order: 'id',
  read: [P, G, 'chefe_pista', 'financeiro'], write: [G, 'chefe_pista'],
  fields: [
    { name: 'turno_id', label: 'Turno', type: 'ref', ref: 'turnos', required: true, list: true },
    { name: 'bico_id', label: 'Bico', type: 'ref', ref: 'bicos', required: true, list: true },
    { name: 'inicial', label: 'Encerrante inicial', type: 'number', list: true },
    { name: 'final', label: 'Encerrante final', type: 'number', list: true },
    { name: 'afericao_litros', label: 'Litros de aferição (retornados ao tanque)', type: 'number' },
  ],
});

def({
  name: 'medicoes_tanque', label: 'Medições de tanque', module: 'combustiveis', display: 'data', order: 'data DESC, id DESC',
  read: [P, G, 'chefe_pista', 'financeiro'], write: [G, 'chefe_pista', 'financeiro'],
  fields: [
    { name: 'data', label: 'Data', type: 'date', required: true, list: true },
    { name: 'turno_id', label: 'Turno', type: 'ref', ref: 'turnos' },
    { name: 'tanque_id', label: 'Tanque', type: 'ref', ref: 'tanques', required: true, list: true },
    { name: 'momento', label: 'Momento', type: 'select', options: opt(['abertura', 'Abertura'], ['fechamento', 'Fechamento']), required: true, list: true },
    { name: 'metodo', label: 'Método', type: 'select', options: opt(['regua', 'Régua'], ['sonda', 'Sonda']), default: 'regua', list: true },
    { name: 'regua_cm', label: 'Régua (cm)', type: 'number' },
    { name: 'volume', label: 'Volume (L)', type: 'number', required: true, list: true },
  ],
});

def({
  name: 'ocorrencias', label: 'Ocorrências da pista', module: 'pista', display: 'tipo', order: 'data DESC, id DESC',
  read: [P, G, 'chefe_pista'], write: [G, 'chefe_pista'],
  fields: [
    { name: 'data', label: 'Data/hora', type: 'datetime', required: true, list: true },
    { name: 'turno_id', label: 'Turno', type: 'ref', ref: 'turnos' },
    { name: 'tipo', label: 'Tipo', type: 'select', required: true, list: true, options: opt('Cliente', 'Acidente', 'Quebra de equipamento', 'Falta de produto', 'Abastecimento errado', 'Vazamento', 'Outros') },
    { name: 'funcionario_id', label: 'Funcionário envolvido', type: 'ref', ref: 'funcionarios', list: true },
    { name: 'descricao', label: 'Descrição', type: 'textarea', required: true, list: true },
    { name: 'providencia', label: 'Providência', type: 'textarea' },
    { name: 'fotos', label: 'Fotos', type: 'files' },
  ],
});

def({
  name: 'sangrias', label: 'Sangrias e trocos', module: 'pista', display: 'id', order: 'id DESC',
  read: [P, G, 'chefe_pista', 'financeiro'], write: [G, 'chefe_pista'],
  fields: [
    { name: 'turno_id', label: 'Turno', type: 'ref', ref: 'turnos', required: true, list: true },
    { name: 'tipo', label: 'Tipo', type: 'select', options: opt(['sangria', 'Sangria'], ['troco', 'Troco']), required: true, list: true },
    { name: 'horario', label: 'Horário', type: 'time', required: true, list: true },
    { name: 'valor', label: 'Valor', type: 'money', required: true, list: true },
    { name: 'entregue_por', label: 'Entregue por', type: 'ref', ref: 'funcionarios', list: true },
    { name: 'recebido_por', label: 'Recebido por', type: 'ref', ref: 'funcionarios', list: true },
  ],
});

def({
  name: 'caixas', label: 'Fechamentos de caixa', module: 'pista', display: 'id', order: 'id DESC',
  read: [P, G, 'chefe_pista', 'financeiro'], write: [G, 'chefe_pista'], selfRead: ['frentista'], selfField: 'funcionario_id',
  fields: [
    { name: 'turno_id', label: 'Turno', type: 'ref', ref: 'turnos', required: true, list: true },
    { name: 'funcionario_id', label: 'Frentista', type: 'ref', ref: 'funcionarios', required: true, list: true },
    { name: 'dinheiro', label: 'Dinheiro', type: 'money', list: true },
    { name: 'debito', label: 'Cartão débito', type: 'money' },
    { name: 'credito', label: 'Cartão crédito', type: 'money' },
    { name: 'pix', label: 'PIX', type: 'money' },
    { name: 'a_prazo', label: 'Notas a prazo', type: 'money' },
    { name: 'vales', label: 'Vales', type: 'money' },
    { name: 'total_informado', label: 'Total informado', type: 'money', readonly: true, list: true },
    { name: 'sistema_total', label: 'Total no sistema (Linx)', type: 'money', required: true, list: true },
    { name: 'diferenca', label: 'Diferença', type: 'money', readonly: true, list: true },
    { name: 'justificativa', label: 'Justificativa', type: 'textarea' },
    { name: 'assinado_at', label: 'Assinado pelo frentista em', type: 'datetime', readonly: true, list: true },
  ],
});

def({
  name: 'faltas_caixa', label: 'Faltas de caixa', module: 'pista', display: 'id', order: 'data DESC, id DESC',
  read: [P, G, 'chefe_pista', 'financeiro', 'rh'], write: [G, 'chefe_pista', 'rh'], selfRead: ['frentista'], selfField: 'funcionario_id',
  fields: [
    { name: 'data', label: 'Data', type: 'date', required: true, list: true },
    { name: 'turno_id', label: 'Turno', type: 'ref', ref: 'turnos' },
    { name: 'caixa_id', label: 'Fechamento de caixa', type: 'ref', ref: 'caixas', hidden: true },
    { name: 'funcionario_id', label: 'Frentista', type: 'ref', ref: 'funcionarios', required: true, list: true },
    { name: 'valor', label: 'Valor', type: 'money', required: true, list: true },
    { name: 'forma_pagamento', label: 'Forma de pagamento', type: 'select', list: true, options: opt('Dinheiro', 'Cartão', 'PIX', 'A prazo', 'Vale', 'Não identificada') },
    { name: 'justificativa', label: 'Justificativa', type: 'textarea' },
    { name: 'tratamento', label: 'Tratamento', type: 'select', list: true, default: 'pendente', options: opt(['pendente', 'Pendente'], ['desconto', 'Desconto em folha'], ['abono_solicitado', 'Abono solicitado'], ['abonado', 'Abonado pelo gerente'], ['investigacao', 'Em investigação']) },
    { name: 'autorizacao', label: 'Termo de autorização de desconto', type: 'files' },
    { name: 'assinado_at', label: 'Ciência do frentista em', type: 'datetime', readonly: true },
  ],
});

// ---------------------------------------------------------------- RH / DP
def({
  name: 'ponto', label: 'Ponto (marcações)', module: 'rh', display: 'data', order: 'data DESC',
  read: [P, G, 'rh'], write: [G, 'rh'], selfRead: ['frentista', 'chefe_pista', 'financeiro', 'conveniencia'], selfField: 'funcionario_id',
  fields: [
    { name: 'funcionario_id', label: 'Funcionário', type: 'ref', ref: 'funcionarios', required: true, list: true },
    { name: 'data', label: 'Data', type: 'date', required: true, list: true },
    { name: 'entrada', label: 'Entrada', type: 'time', list: true },
    { name: 'saida_intervalo', label: 'Saída intervalo', type: 'time', list: true },
    { name: 'retorno_intervalo', label: 'Retorno intervalo', type: 'time', list: true },
    { name: 'saida', label: 'Saída', type: 'time', list: true },
    { name: 'ocorrencia', label: 'Ocorrência', type: 'select', list: true, default: 'normal', options: opt(['normal', 'Normal'], ['folga', 'Folga'], ['falta_injustificada', 'Falta injustificada'], ['falta_justificada', 'Falta justificada'], ['atestado', 'Atestado'], ['ferias', 'Férias']) },
    { name: 'feriado', label: 'Domingo/feriado trabalhado (100%)', type: 'bool' },
    { name: 'he_aprovada', label: 'Hora extra aprovada', type: 'bool' },
    { name: 'origem', label: 'Origem', type: 'select', options: opt(['manual', 'Manual'], ['afd', 'Relógio (AFD)'], ['app', 'Aplicativo']), default: 'manual' },
    { name: 'geo', label: 'Geolocalização (app)', type: 'text', hidden: true },
    { name: 'obs', label: 'Observação', type: 'text' },
  ],
});

def({
  name: 'atestados', label: 'Atestados', module: 'rh', display: 'data_inicio', order: 'data_inicio DESC', sensitive: true,
  read: [G, 'rh'], write: [G, 'rh'],
  fields: [
    { name: 'funcionario_id', label: 'Funcionário', type: 'ref', ref: 'funcionarios', required: true, list: true },
    { name: 'data_inicio', label: 'Início', type: 'date', required: true, list: true },
    { name: 'dias', label: 'Dias', type: 'int', required: true, list: true },
    { name: 'cid', label: 'CID (se informado)', type: 'text', list: true },
    { name: 'medico', label: 'Médico / CRM', type: 'text' },
    { name: 'anexo', label: 'Atestado digitalizado', type: 'files' },
  ],
});

def({
  name: 'asos', label: 'ASOs (PCMSO / NR-7)', module: 'rh', display: 'tipo', order: 'validade', sensitive: true,
  read: [G, 'rh'], write: [G, 'rh'],
  fields: [
    { name: 'funcionario_id', label: 'Funcionário', type: 'ref', ref: 'funcionarios', required: true, list: true },
    { name: 'tipo', label: 'Tipo', type: 'select', required: true, list: true, options: opt('Admissional', 'Periódico', 'Retorno ao trabalho', 'Mudança de função', 'Demissional') },
    { name: 'data', label: 'Data do exame', type: 'date', required: true, list: true },
    { name: 'validade', label: 'Validade', type: 'date', list: true },
    { name: 'benzeno', label: 'Inclui exames do benzeno (NR-9 Anexo 2)', type: 'bool', list: true },
    { name: 'resultado', label: 'Resultado', type: 'select', options: opt('Apto', 'Inapto', 'Apto com restrição'), list: true },
    { name: 'anexo', label: 'ASO digitalizado', type: 'files' },
  ],
});

def({
  name: 'treinamentos', label: 'Treinamentos e certificados', module: 'rh', display: 'tipo', order: 'validade',
  read: [P, G, 'rh'], write: [G, 'rh'], selfRead: ['frentista', 'chefe_pista'], selfField: 'funcionario_id',
  fields: [
    { name: 'funcionario_id', label: 'Funcionário', type: 'ref', ref: 'funcionarios', required: true, list: true },
    { name: 'tipo', label: 'Treinamento', type: 'select', required: true, list: true, options: opt('NR-20 Inflamáveis e combustíveis', 'Benzeno (NR-9 Anexo 2)', 'Brigada de incêndio (NR-23)', 'CIPA / designado (NR-5)', 'Boas práticas (manipulação de alimentos)', 'Operação GNV', 'Integração', 'Outros') },
    { name: 'data', label: 'Data', type: 'date', required: true, list: true },
    { name: 'validade', label: 'Validade', type: 'date', list: true },
    { name: 'carga_horaria', label: 'Carga horária (h)', type: 'number' },
    { name: 'certificado', label: 'Certificado', type: 'files' },
  ],
});

def({
  name: 'escalas', label: 'Escalas', module: 'rh', display: 'data', order: 'data, funcionario_id',
  read: [P, G, 'rh', 'chefe_pista'], write: [G, 'rh'], selfRead: ['frentista', 'financeiro', 'conveniencia'], selfField: 'funcionario_id',
  fields: [
    { name: 'funcionario_id', label: 'Funcionário', type: 'ref', ref: 'funcionarios', required: true, list: true },
    { name: 'data', label: 'Data', type: 'date', required: true, list: true },
    { name: 'turno', label: 'Turno', type: 'select', required: true, list: true, options: TURNOS.concat(opt(['folga', 'Folga'])) },
    { name: 'gnv', label: 'Escala do GNV', type: 'bool', list: true },
  ],
});

def({
  name: 'trocas_folga', label: 'Trocas de folga', module: 'rh', display: 'id', order: 'id DESC',
  read: [P, G, 'rh', 'chefe_pista'], write: [G, 'rh', 'chefe_pista', 'frentista', 'financeiro', 'conveniencia'], selfRead: ['frentista', 'financeiro', 'conveniencia'], selfField: 'funcionario_id',
  fields: [
    { name: 'funcionario_id', label: 'Funcionário', type: 'ref', ref: 'funcionarios', required: true, list: true },
    { name: 'data_folga', label: 'Folga atual', type: 'date', required: true, list: true },
    { name: 'data_nova', label: 'Nova folga', type: 'date', required: true, list: true },
    { name: 'motivo', label: 'Motivo', type: 'text', list: true },
    { name: 'status', label: 'Status', type: 'select', default: 'solicitada', list: true, options: opt(['solicitada', 'Solicitada'], ['aprovada', 'Aprovada'], ['recusada', 'Recusada']) },
  ],
});

def({
  name: 'ferias', label: 'Férias', module: 'rh', display: 'inicio', order: 'inicio DESC',
  read: [P, G, 'rh'], write: [G, 'rh'], selfRead: ['frentista', 'chefe_pista', 'financeiro', 'conveniencia'], selfField: 'funcionario_id',
  fields: [
    { name: 'funcionario_id', label: 'Funcionário', type: 'ref', ref: 'funcionarios', required: true, list: true },
    { name: 'aquisitivo_inicio', label: 'Início do período aquisitivo', type: 'date', required: true, list: true },
    { name: 'inicio', label: 'Início do gozo', type: 'date', required: true, list: true },
    { name: 'dias', label: 'Dias', type: 'int', default: 30, list: true },
    { name: 'abono_pecuniario', label: 'Abono pecuniário (dias vendidos)', type: 'int' },
    { name: 'status', label: 'Status', type: 'select', default: 'programada', list: true, options: opt(['programada', 'Programada'], ['gozada', 'Gozada'], ['cancelada', 'Cancelada']) },
  ],
});

def({
  name: 'epi_itens', label: 'Uniformes e EPI (estoque)', module: 'rh', display: 'nome', order: 'nome',
  read: [P, G, 'rh', 'chefe_pista'], write: [G, 'rh'],
  fields: [
    { name: 'nome', label: 'Item', type: 'text', required: true, list: true },
    { name: 'tipo', label: 'Tipo', type: 'select', options: opt(['epi', 'EPI'], ['uniforme', 'Uniforme']), list: true },
    { name: 'tamanho', label: 'Tamanho', type: 'text', list: true },
    { name: 'ca', label: 'CA (Certificado de Aprovação)', type: 'text', list: true },
    { name: 'ca_validade', label: 'Validade do CA', type: 'date', list: true },
    { name: 'estoque', label: 'Estoque', type: 'int', list: true },
    { name: 'ponto_reposicao', label: 'Ponto de reposição', type: 'int', list: true },
    { name: 'troca_dias', label: 'Troca periódica (dias)', type: 'int' },
  ],
});

def({
  name: 'epi_entregas', label: 'Fichas de entrega de EPI', module: 'rh', display: 'id', order: 'data DESC',
  read: [P, G, 'rh', 'chefe_pista'], write: [G, 'rh'], selfRead: ['frentista', 'financeiro', 'conveniencia'], selfField: 'funcionario_id',
  fields: [
    { name: 'funcionario_id', label: 'Funcionário', type: 'ref', ref: 'funcionarios', required: true, list: true },
    { name: 'item_id', label: 'Item', type: 'ref', ref: 'epi_itens', required: true, list: true },
    { name: 'quantidade', label: 'Quantidade', type: 'int', default: 1, list: true },
    { name: 'data', label: 'Data da entrega', type: 'date', required: true, list: true },
    { name: 'ca', label: 'CA na entrega', type: 'text', list: true },
    { name: 'assinado_at', label: 'Assinado em', type: 'datetime', readonly: true, list: true },
  ],
});

def({
  name: 'advertencias', label: 'Advertências e suspensões', module: 'rh', display: 'tipo', order: 'data DESC',
  read: [P, G, 'rh'], write: [G, 'rh'], selfRead: ['frentista', 'chefe_pista', 'financeiro', 'conveniencia'], selfField: 'funcionario_id',
  fields: [
    { name: 'funcionario_id', label: 'Funcionário', type: 'ref', ref: 'funcionarios', required: true, list: true },
    { name: 'tipo', label: 'Tipo', type: 'select', required: true, list: true, options: opt(['verbal', 'Advertência verbal'], ['escrita', 'Advertência escrita'], ['suspensao', 'Suspensão']) },
    { name: 'data', label: 'Data', type: 'date', required: true, list: true },
    { name: 'dias_suspensao', label: 'Dias de suspensão', type: 'int' },
    { name: 'motivo', label: 'Motivo', type: 'textarea', required: true, list: true },
    { name: 'testemunhas', label: 'Testemunhas', type: 'text' },
    { name: 'assinado_at', label: 'Assinado em', type: 'datetime', readonly: true, list: true },
  ],
});

def({
  name: 'comunicados', label: 'Comunicados internos', module: 'rh', display: 'titulo', order: 'data DESC',
  read: ALL_INTERNAL.concat('frentista'), write: [G, 'rh'],
  fields: [
    { name: 'titulo', label: 'Título', type: 'text', required: true, list: true },
    { name: 'data', label: 'Data', type: 'date', required: true, list: true },
    { name: 'texto', label: 'Texto', type: 'textarea', required: true },
    { name: 'exige_assinatura', label: 'Exige confirmação de leitura', type: 'bool', default: 1, list: true },
  ],
});

def({
  name: 'comunicados_leitura', label: 'Confirmações de leitura', module: 'rh', display: 'id', order: 'id DESC',
  read: [P, G, 'rh'], write: [G, 'rh'], selfRead: ['frentista', 'chefe_pista', 'financeiro', 'conveniencia'], selfField: 'funcionario_id',
  fields: [
    { name: 'comunicado_id', label: 'Comunicado', type: 'ref', ref: 'comunicados', required: true, list: true },
    { name: 'funcionario_id', label: 'Funcionário', type: 'ref', ref: 'funcionarios', required: true, list: true },
    { name: 'lido_at', label: 'Lido em', type: 'datetime', list: true },
  ],
});

def({
  name: 'vendas_grid', label: 'Vendas do grid (comissão)', module: 'rh', display: 'id', order: 'data DESC',
  read: [P, G, 'rh', 'chefe_pista'], write: [G, 'rh'], selfRead: ['frentista'], selfField: 'funcionario_id',
  fields: [
    { name: 'data', label: 'Data', type: 'date', required: true, list: true },
    { name: 'funcionario_id', label: 'Frentista', type: 'ref', ref: 'funcionarios', required: true, list: true },
    { name: 'produto_id', label: 'Produto', type: 'ref', ref: 'produtos', required: true, list: true },
    { name: 'quantidade', label: 'Quantidade', type: 'number', list: true },
    { name: 'valor', label: 'Valor', type: 'money', required: true, list: true },
  ],
});

def({
  name: 'esocial_sst', label: 'Eventos SST no eSocial', module: 'rh', display: 'evento', order: 'competencia DESC',
  read: [P, G, 'rh', 'contabilidade'], write: [G, 'rh'],
  fields: [
    { name: 'competencia', label: 'Competência (AAAA-MM)', type: 'text', required: true, list: true },
    { name: 'evento', label: 'Evento', type: 'select', required: true, list: true, options: opt(['S-2210', 'S-2210 Comunicação de acidente (CAT)'], ['S-2220', 'S-2220 Monitoramento da saúde (ASO)'], ['S-2240', 'S-2240 Condições ambientais (agentes nocivos)']) },
    { name: 'quantidade', label: 'Qtd. de eventos', type: 'int', list: true },
    { name: 'enviado', label: 'Enviado', type: 'bool', list: true },
    { name: 'recibo', label: 'Recibo', type: 'text' },
  ],
});

// ---------------------------------------------------------------- Financeiro
def({
  name: 'plano_contas', label: 'Plano de contas', module: 'financeiro', display: 'nome', order: 'codigo', posto: false,
  read: [P, G, 'financeiro', 'contabilidade'], write: [G, 'financeiro'],
  fields: [
    { name: 'codigo', label: 'Código', type: 'text', required: true, list: true },
    { name: 'nome', label: 'Conta', type: 'text', required: true, list: true },
    { name: 'tipo', label: 'Tipo', type: 'select', list: true, options: opt(['receita', 'Receita'], ['cmv', 'Custo de mercadoria (CMV)'], ['despesa', 'Despesa operacional'], ['financeira', 'Despesa financeira'], ['investimento', 'Investimento']) },
  ],
});

def({
  name: 'contas_pagar', label: 'Contas a pagar', module: 'financeiro', display: 'descricao', order: 'vencimento',
  read: [P, G, 'financeiro'], write: [G, 'financeiro'],
  fields: [
    { name: 'fornecedor_id', label: 'Fornecedor', type: 'ref', ref: 'fornecedores', list: true },
    { name: 'descricao', label: 'Descrição', type: 'text', required: true, list: true },
    { name: 'conta_id', label: 'Plano de contas', type: 'ref', ref: 'plano_contas', list: true },
    { name: 'documento', label: 'Nº documento / NF', type: 'text' },
    { name: 'valor', label: 'Valor', type: 'money', required: true, list: true },
    { name: 'vencimento', label: 'Vencimento', type: 'date', required: true, list: true },
    { name: 'pagamento_data', label: 'Pago em', type: 'date', list: true },
    { name: 'valor_pago', label: 'Valor pago', type: 'money' },
    { name: 'juros_multa', label: 'Juros e multa', type: 'money' },
    { name: 'status', label: 'Status', type: 'select', default: 'aberta', list: true, options: opt(['aberta', 'Aberta'], ['aguardando_aprovacao', 'Aguardando aprovação'], ['paga', 'Paga'], ['cancelada', 'Cancelada'], ['estornada', 'Estornada']) },
    { name: 'aprovado_por', label: 'Aprovado por', type: 'ref', ref: 'usuarios', readonly: true },
    { name: 'anexo', label: 'Boleto / nota', type: 'files' },
  ],
});

def({
  name: 'contas_receber', label: 'Contas a receber', module: 'financeiro', display: 'descricao', order: 'vencimento',
  read: [P, G, 'financeiro'], write: [G, 'financeiro'],
  fields: [
    { name: 'cliente_id', label: 'Cliente', type: 'ref', ref: 'clientes', required: true, list: true },
    { name: 'descricao', label: 'Descrição / fatura', type: 'text', required: true, list: true },
    { name: 'emissao', label: 'Emissão', type: 'date', list: true },
    { name: 'valor', label: 'Valor', type: 'money', required: true, list: true },
    { name: 'vencimento', label: 'Vencimento', type: 'date', required: true, list: true },
    { name: 'recebimento_data', label: 'Recebido em', type: 'date', list: true },
    { name: 'valor_recebido', label: 'Valor recebido', type: 'money' },
    { name: 'status', label: 'Status', type: 'select', default: 'aberta', list: true, options: opt(['aberta', 'Aberta'], ['recebida', 'Recebida'], ['cancelada', 'Cancelada'], ['estornada', 'Estornada']) },
  ],
});

def({
  name: 'cobrancas', label: 'Histórico de cobrança', module: 'financeiro', display: 'id', order: 'data DESC',
  read: [P, G, 'financeiro'], write: [G, 'financeiro'],
  fields: [
    { name: 'cliente_id', label: 'Cliente', type: 'ref', ref: 'clientes', required: true, list: true },
    { name: 'data', label: 'Data', type: 'date', required: true, list: true },
    { name: 'meio', label: 'Meio', type: 'select', options: opt('Telefone', 'WhatsApp', 'E-mail', 'Visita', 'Carta'), list: true },
    { name: 'resultado', label: 'Resultado / promessa', type: 'textarea', list: true },
  ],
});

def({
  name: 'contas_bancarias', label: 'Contas bancárias', module: 'financeiro', display: 'nome',
  read: [P, G, 'financeiro'], write: [G],
  fields: [
    { name: 'nome', label: 'Conta', type: 'text', required: true, list: true },
    { name: 'banco', label: 'Banco', type: 'text', list: true },
    { name: 'agencia', label: 'Agência', type: 'text', list: true },
    { name: 'conta', label: 'Conta', type: 'text', list: true },
    { name: 'saldo_inicial', label: 'Saldo inicial', type: 'money' },
    { name: 'saldo_data', label: 'Data do saldo inicial', type: 'date' },
  ],
});

def({
  name: 'extrato', label: 'Extrato bancário', module: 'financeiro', display: 'descricao', order: 'data DESC, id DESC',
  read: [P, G, 'financeiro'], write: [G, 'financeiro'],
  fields: [
    { name: 'conta_bancaria_id', label: 'Conta', type: 'ref', ref: 'contas_bancarias', required: true, list: true },
    { name: 'data', label: 'Data', type: 'date', required: true, list: true },
    { name: 'descricao', label: 'Histórico', type: 'text', list: true },
    { name: 'valor', label: 'Valor', type: 'money', required: true, list: true },
    { name: 'fitid', label: 'ID OFX', type: 'text', hidden: true },
    { name: 'conciliado_tipo', label: 'Conciliado com', type: 'text', readonly: true, list: true },
    { name: 'conciliado_id', label: 'ID conciliado', type: 'int', hidden: true },
  ],
});

def({
  name: 'taxas_cartao', label: 'Taxas contratadas de cartão', module: 'financeiro', display: 'adquirente',
  read: [P, G, 'financeiro'], write: [G, 'financeiro'],
  fields: [
    { name: 'adquirente', label: 'Adquirente', type: 'text', required: true, list: true },
    { name: 'bandeira', label: 'Bandeira', type: 'text', required: true, list: true },
    { name: 'modalidade', label: 'Modalidade', type: 'select', required: true, list: true, options: opt(['debito', 'Débito'], ['credito', 'Crédito'], ['voucher', 'Voucher/frota']) },
    { name: 'taxa_pct', label: 'Taxa (%)', type: 'number', list: true },
    { name: 'prazo_dias', label: 'Prazo de crédito (dias)', type: 'int', list: true },
  ],
});

def({
  name: 'recebiveis_cartao', label: 'Recebíveis de cartão', module: 'financeiro', display: 'id', order: 'data_prevista DESC',
  read: [P, G, 'financeiro'], write: [G, 'financeiro'],
  fields: [
    { name: 'data_venda', label: 'Data da venda', type: 'date', required: true, list: true },
    { name: 'adquirente', label: 'Adquirente', type: 'text', required: true, list: true },
    { name: 'bandeira', label: 'Bandeira', type: 'text', required: true, list: true },
    { name: 'modalidade', label: 'Modalidade', type: 'select', required: true, list: true, options: opt(['debito', 'Débito'], ['credito', 'Crédito'], ['voucher', 'Voucher/frota']) },
    { name: 'valor_bruto', label: 'Valor bruto', type: 'money', required: true, list: true },
    { name: 'valor_esperado', label: 'Líquido esperado', type: 'money', readonly: true, list: true },
    { name: 'data_prevista', label: 'Crédito previsto', type: 'date', readonly: true, list: true },
    { name: 'valor_recebido', label: 'Valor recebido', type: 'money', list: true },
    { name: 'data_recebida', label: 'Recebido em', type: 'date', list: true },
    { name: 'antecipado', label: 'Antecipado', type: 'bool' },
  ],
});

def({
  name: 'vendas', label: 'Vendas (importadas do Linx/Webposto)', module: 'financeiro', display: 'id', order: 'data DESC, id DESC',
  read: [P, G, 'financeiro', 'conveniencia'], write: [G, 'financeiro'],
  fields: [
    { name: 'data', label: 'Data', type: 'date', required: true, list: true },
    { name: 'hora', label: 'Hora', type: 'time', list: true },
    { name: 'origem', label: 'Origem', type: 'select', required: true, list: true, options: opt(['pista', 'Pista'], ['conveniencia', 'Conveniência']) },
    { name: 'cupom', label: 'Cupom', type: 'text' },
    { name: 'turno_id', label: 'Turno', type: 'ref', ref: 'turnos' },
    { name: 'bico_id', label: 'Bico', type: 'ref', ref: 'bicos' },
    { name: 'combustivel_id', label: 'Combustível', type: 'ref', ref: 'combustiveis', list: true },
    { name: 'produto_id', label: 'Produto', type: 'ref', ref: 'produtos', list: true },
    { name: 'funcionario_id', label: 'Frentista/atendente', type: 'ref', ref: 'funcionarios', list: true },
    { name: 'quantidade', label: 'Quantidade', type: 'number', list: true },
    { name: 'valor', label: 'Valor', type: 'money', required: true, list: true },
    { name: 'custo', label: 'Custo', type: 'money' },
    { name: 'forma_pagamento', label: 'Pagamento', type: 'select', list: true, options: opt(['dinheiro', 'Dinheiro'], ['debito', 'Débito'], ['credito', 'Crédito'], ['pix', 'PIX'], ['prazo', 'A prazo'], ['frota', 'Frota']) },
  ],
});

// ---------------------------------------------------------------- Conveniência
def({
  name: 'notas_entrada', label: 'Notas de entrada', module: 'conveniencia', display: 'numero', order: 'data DESC',
  read: [P, G, 'conveniencia', 'financeiro'], write: [G, 'conveniencia'],
  fields: [
    { name: 'fornecedor_id', label: 'Fornecedor', type: 'ref', ref: 'fornecedores', list: true },
    { name: 'numero', label: 'Número NF', type: 'text', required: true, list: true },
    { name: 'chave', label: 'Chave de acesso', type: 'text' },
    { name: 'data', label: 'Emissão', type: 'date', required: true, list: true },
    { name: 'valor', label: 'Valor total', type: 'money', list: true },
    { name: 'pedido_ref', label: 'Pedido de compra', type: 'text' },
    { name: 'itens', label: 'Itens', type: 'json', hidden: true },
    { name: 'status', label: 'Status', type: 'select', default: 'pendente', list: true, options: opt(['pendente', 'Pendente de conferência'], ['conferida', 'Conferida'], ['divergente', 'Conferida com divergência']) },
  ],
});

def({
  name: 'contagens', label: 'Contagens de estoque', module: 'conveniencia', display: 'id', order: 'data DESC, id DESC',
  read: [P, G, 'conveniencia'], write: [G, 'conveniencia'],
  fields: [
    { name: 'data', label: 'Data', type: 'date', required: true, list: true },
    { name: 'tipo', label: 'Tipo', type: 'select', list: true, options: opt(['ciclica', 'Cíclica'], ['geral', 'Inventário geral']) },
    { name: 'produto_id', label: 'Produto', type: 'ref', ref: 'produtos', required: true, list: true },
    { name: 'sistema', label: 'Qtd. sistema', type: 'number', list: true },
    { name: 'contado', label: 'Qtd. contada', type: 'number', list: true },
    { name: 'diferenca', label: 'Diferença', type: 'number', readonly: true, list: true },
    { name: 'valor_diferenca', label: 'Diferença (R$)', type: 'money', readonly: true, list: true },
    { name: 'status', label: 'Ajuste', type: 'select', default: 'pendente', list: true, options: opt(['pendente', 'Aguardando aprovação'], ['ajustado', 'Ajustado'], ['recusado', 'Recusado'], ['sem_divergencia', 'Sem divergência']) },
  ],
});

def({
  name: 'perdas', label: 'Avarias, perdas e consumo interno', module: 'conveniencia', display: 'tipo', order: 'data DESC',
  read: [P, G, 'conveniencia'], write: [G, 'conveniencia'],
  fields: [
    { name: 'data', label: 'Data', type: 'date', required: true, list: true },
    { name: 'produto_id', label: 'Produto', type: 'ref', ref: 'produtos', required: true, list: true },
    { name: 'tipo', label: 'Tipo', type: 'select', required: true, list: true, options: opt(['avaria', 'Avaria'], ['vencimento', 'Vencimento'], ['quebra', 'Quebra'], ['consumo_interno', 'Consumo interno'], ['furto', 'Furto/desvio']) },
    { name: 'quantidade', label: 'Quantidade', type: 'number', required: true, list: true },
    { name: 'valor', label: 'Valor (custo)', type: 'money', readonly: true, list: true },
    { name: 'responsavel_id', label: 'Responsável', type: 'ref', ref: 'funcionarios', list: true },
    { name: 'foto', label: 'Foto', type: 'files' },
    { name: 'obs', label: 'Observação', type: 'text' },
  ],
});

def({
  name: 'lotes_validade', label: 'Validade de produtos (lotes)', module: 'conveniencia', display: 'lote', order: 'validade',
  read: [P, G, 'conveniencia'], write: [G, 'conveniencia'],
  fields: [
    { name: 'produto_id', label: 'Produto', type: 'ref', ref: 'produtos', required: true, list: true },
    { name: 'lote', label: 'Lote', type: 'text', list: true },
    { name: 'validade', label: 'Validade', type: 'date', required: true, list: true },
    { name: 'quantidade', label: 'Quantidade', type: 'number', list: true },
    { name: 'baixado', label: 'Baixado/retirado', type: 'bool', list: true },
  ],
});

def({
  name: 'temperaturas', label: 'Temperatura de geladeiras e freezers', module: 'conveniencia', display: 'equipamento', order: 'data DESC, id DESC',
  read: [P, G, 'conveniencia'], write: [G, 'conveniencia'],
  fields: [
    { name: 'data', label: 'Data', type: 'date', required: true, list: true },
    { name: 'hora', label: 'Hora', type: 'time', list: true },
    { name: 'equipamento', label: 'Equipamento', type: 'select', required: true, list: true, options: opt('Geladeira bebidas 1', 'Geladeira bebidas 2', 'Geladeira laticínios', 'Freezer sorvetes', 'Freezer gelo') },
    { name: 'temperatura', label: 'Temperatura (°C)', type: 'number', required: true, list: true },
    { name: 'responsavel_id', label: 'Responsável', type: 'ref', ref: 'funcionarios', list: true },
  ],
});

// ---------------------------------------------------------------- Combustíveis
def({
  name: 'descargas', label: 'Recebimento de combustível (descargas)', module: 'combustiveis', display: 'nota', order: 'data DESC, id DESC',
  read: [P, G, 'financeiro', 'chefe_pista'], write: [G, 'financeiro', 'chefe_pista'],
  fields: [
    { name: 'data', label: 'Data', type: 'date', required: true, list: true },
    { name: 'hora', label: 'Hora', type: 'time' },
    { name: 'turno_id', label: 'Turno', type: 'ref', ref: 'turnos' },
    { name: 'combustivel_id', label: 'Combustível', type: 'ref', ref: 'combustiveis', required: true, list: true },
    { name: 'tanque_id', label: 'Tanque', type: 'ref', ref: 'tanques', required: true, list: true },
    { name: 'fornecedor_id', label: 'Distribuidora', type: 'ref', ref: 'fornecedores', list: true },
    { name: 'nota', label: 'Nota fiscal', type: 'text', required: true, list: true },
    { name: 'volume_nf', label: 'Volume NF (L)', type: 'number', required: true, list: true },
    { name: 'custo_unitario', label: 'Custo (R$/L)', type: 'money3', required: true, list: true },
    { name: 'placa', label: 'Placa do caminhão', type: 'text' },
    { name: 'motorista', label: 'Motorista', type: 'text' },
    { name: 'medicao_antes', label: 'Medição antes (L)', type: 'number' },
    { name: 'medicao_depois', label: 'Medição depois (L)', type: 'number' },
    { name: 'aspecto', label: 'Aspecto (límpido e isento de impurezas)', type: 'select', options: opt(['ok', 'Conforme'], ['reprovado', 'Não conforme']) },
    { name: 'cor', label: 'Cor', type: 'select', options: opt(['ok', 'Conforme'], ['reprovado', 'Não conforme']) },
    { name: 'densidade', label: 'Massa específica a 20 °C (kg/m³)', type: 'number' },
    { name: 'temperatura', label: 'Temperatura (°C)', type: 'number' },
    { name: 'teor_etanol', label: 'Teor de etanol na gasolina (%)', type: 'number' },
    { name: 'amostra_numero', label: 'Nº lacre da amostra-testemunha', type: 'text' },
    { name: 'amostra_descarte', label: 'Descarte da amostra em', type: 'date', list: true },
    { name: 'status', label: 'Resultado', type: 'select', readonly: true, list: true, options: opt(['aprovada', 'Aprovada'], ['recusada', 'Recusada — não descarregar']) },
    { name: 'reprovacoes', label: 'Motivos da reprovação', type: 'text', readonly: true },
  ],
});

def({
  name: 'equipamentos', label: 'Equipamentos e meio ambiente', module: 'combustiveis', display: 'item', order: 'proxima_data',
  read: [P, G, 'financeiro', 'chefe_pista'], write: [G, 'financeiro', 'chefe_pista'],
  fields: [
    { name: 'tipo', label: 'Controle', type: 'select', required: true, list: true, options: opt('Aferição de bomba (20 L)', 'Verificação Inmetro/IPEM', 'Lacre de bomba', 'Teste de estanqueidade', 'Monitoramento intersticial / poços', 'Caixa separadora água e óleo', 'Troca de filtro de diesel', 'Troca de bicos/mangueiras', 'Manutenção compressor GNV', 'Inspeção vaso de pressão (NR-13)', 'Manutenção dispenser GNV', 'Extintores') },
    { name: 'item', label: 'Item (bico, tanque, equipamento)', type: 'text', list: true },
    { name: 'bico_id', label: 'Bico', type: 'ref', ref: 'bicos' },
    { name: 'data', label: 'Data', type: 'date', required: true, list: true },
    { name: 'volume_medido', label: 'Aferição: volume medido (L)', type: 'number' },
    { name: 'resultado', label: 'Resultado', type: 'text', list: true },
    { name: 'lacre_numero', label: 'Nº do lacre', type: 'text' },
    { name: 'mtr', label: 'MTR (destinação de resíduo)', type: 'text' },
    { name: 'horas_operacao', label: 'Horas de operação (GNV)', type: 'number' },
    { name: 'proxima_data', label: 'Próxima data', type: 'date', list: true },
    { name: 'responsavel', label: 'Responsável / empresa', type: 'text', list: true },
    { name: 'laudo', label: 'Laudo / certificado', type: 'files' },
  ],
});

// ---------------------------------------------------------------- Preços
def({
  name: 'concorrentes', label: 'Concorrentes', module: 'precos', display: 'nome', order: 'distancia_km',
  read: [P, G, 'chefe_pista', 'financeiro'], write: [G],
  fields: [
    { name: 'nome', label: 'Posto', type: 'text', required: true, list: true },
    { name: 'endereco', label: 'Endereço', type: 'text', list: true },
    { name: 'bandeira', label: 'Bandeira', type: 'text', list: true },
    { name: 'distancia_km', label: 'Distância (km)', type: 'number', list: true },
  ],
});

def({
  name: 'pesquisas_preco', label: 'Pesquisas de preço', module: 'precos', display: 'id', order: 'data DESC, id DESC',
  read: [P, G, 'chefe_pista', 'financeiro'], write: [G, 'chefe_pista'],
  fields: [
    { name: 'data', label: 'Data', type: 'date', required: true, list: true },
    { name: 'hora', label: 'Hora', type: 'time', list: true },
    { name: 'concorrente_id', label: 'Concorrente', type: 'ref', ref: 'concorrentes', required: true, list: true },
    { name: 'combustivel_id', label: 'Combustível', type: 'ref', ref: 'combustiveis', required: true, list: true },
    { name: 'preco', label: 'Preço', type: 'money3', required: true, list: true },
    { name: 'foto', label: 'Foto da placa', type: 'files' },
  ],
});

def({
  name: 'precos_anp', label: 'Preço médio ANP (município)', module: 'precos', display: 'data', order: 'data DESC', posto: false,
  read: [P, G, 'chefe_pista', 'financeiro'], write: [G, 'financeiro'],
  fields: [
    { name: 'data', label: 'Semana (data final)', type: 'date', required: true, list: true },
    { name: 'combustivel_id', label: 'Combustível', type: 'ref', ref: 'combustiveis', required: true, list: true },
    { name: 'preco_medio', label: 'Preço médio', type: 'money3', required: true, list: true },
    { name: 'preco_min', label: 'Mínimo', type: 'money3', list: true },
    { name: 'preco_max', label: 'Máximo', type: 'money3', list: true },
  ],
});

def({
  name: 'historico_precos', label: 'Histórico de alterações de preço', module: 'precos', display: 'id', order: 'data DESC, id DESC',
  read: [P, G, 'chefe_pista', 'financeiro'], write: [], // somente via /api/precos/alterar
  fields: [
    { name: 'data', label: 'Data/hora', type: 'datetime', list: true },
    { name: 'combustivel_id', label: 'Combustível', type: 'ref', ref: 'combustiveis', list: true },
    { name: 'preco_anterior', label: 'Preço anterior', type: 'money3', list: true },
    { name: 'preco_novo', label: 'Preço novo', type: 'money3', list: true },
    { name: 'motivo', label: 'Motivo', type: 'text', list: true },
    { name: 'usuario_id', label: 'Alterado por', type: 'ref', ref: 'usuarios', list: true },
    { name: 'painel_atualizado', label: 'Painel da pista atualizado', type: 'bool', list: true },
  ],
});

// ---------------------------------------------------------------- Documentos
def({
  name: 'documentos', label: 'Documentos, licenças e alvarás', module: 'documentos', display: 'nome', order: 'validade',
  read: [P, G, 'rh', 'financeiro', 'conveniencia', 'contabilidade'], write: [G, 'rh', 'financeiro', 'conveniencia'],
  fields: [
    { name: 'nome', label: 'Documento', type: 'text', required: true, list: true },
    { name: 'categoria', label: 'Categoria', type: 'select', list: true, options: opt('Regulatório (ANP)', 'Ambiental', 'Bombeiros', 'Prefeitura', 'Vigilância sanitária', 'Inmetro/IPEM', 'Certidões', 'Certificado digital', 'Contratos', 'Seguros', 'SST', 'Sindicato', 'Outros') },
    { name: 'orgao', label: 'Órgão / emissor', type: 'text', list: true },
    { name: 'numero', label: 'Número', type: 'text' },
    { name: 'emissao', label: 'Emissão', type: 'date' },
    { name: 'validade', label: 'Validade', type: 'date', list: true },
    { name: 'responsavel_id', label: 'Responsável pela renovação', type: 'ref', ref: 'usuarios', list: true },
    { name: 'em_renovacao', label: 'Em renovação', type: 'bool' },
    { name: 'protocolo', label: 'Nº do protocolo de renovação', type: 'text' },
    { name: 'checklist_renovacao', label: 'Checklist de renovação (o que pedir, onde protocolar)', type: 'textarea' },
    { name: 'custo_renovacao', label: 'Custo médio da renovação', type: 'money' },
    { name: 'prazo_medio_dias', label: 'Prazo médio do órgão (dias)', type: 'int' },
    { name: 'fiscalizacao', label: 'Incluir na pasta de fiscalização', type: 'bool', default: 1 },
    { name: 'obs', label: 'Observações / condicionantes', type: 'textarea' },
    { name: 'arquivo', label: 'Arquivo (PDF/foto)', type: 'files' },
  ],
});

// ---------------------------------------------------------------- Agenda / tarefas
def({
  name: 'tarefas_modelo', label: 'Obrigações recorrentes', module: 'agenda', display: 'titulo', order: 'frequencia, titulo',
  read: ALL_INTERNAL, write: [G],
  fields: [
    { name: 'titulo', label: 'Tarefa', type: 'text', required: true, list: true },
    { name: 'modulo', label: 'Módulo', type: 'select', list: true, options: Object.entries(MODULES).map(([value, m]) => ({ value, label: m.label })) },
    { name: 'frequencia', label: 'Frequência', type: 'select', required: true, list: true, options: opt(['diaria', 'Diária'], ['semanal', 'Semanal'], ['mensal', 'Mensal'], ['semestral', 'Semestral'], ['anual', 'Anual']) },
    { name: 'dia_semana', label: 'Dia da semana (0=dom … 6=sáb)', type: 'int' },
    { name: 'dia_mes', label: 'Dia do mês', type: 'int' },
    { name: 'meses', label: 'Meses (ex.: 1,7)', type: 'text' },
    { name: 'hora_limite', label: 'Hora limite', type: 'time', list: true },
    { name: 'perfil', label: 'Perfil responsável', type: 'select', list: true, options: Object.entries(ROLES).map(([value, label]) => ({ value, label })) },
    { name: 'responsavel_id', label: 'Responsável (usuário)', type: 'ref', ref: 'usuarios' },
    { name: 'chave', label: 'Chave de automação', type: 'text', hidden: true },
    { name: 'ativo', label: 'Ativa', type: 'bool', default: 1, list: true },
  ],
});

def({
  name: 'tarefas', label: 'Tarefas e checklists', module: 'agenda', display: 'titulo', order: 'data_prevista DESC, id',
  read: ALL_INTERNAL, write: ALL_INTERNAL,
  fields: [
    { name: 'titulo', label: 'Tarefa', type: 'text', required: true, list: true },
    { name: 'modelo_id', label: 'Obrigação', type: 'ref', ref: 'tarefas_modelo', hidden: true },
    { name: 'modulo', label: 'Módulo', type: 'select', list: true, options: Object.entries(MODULES).map(([value, m]) => ({ value, label: m.label })) },
    { name: 'data_prevista', label: 'Data', type: 'date', required: true, list: true },
    { name: 'hora_limite', label: 'Hora limite', type: 'time' },
    { name: 'perfil', label: 'Perfil responsável', type: 'select', list: true, options: Object.entries(ROLES).map(([value, label]) => ({ value, label })) },
    { name: 'responsavel_id', label: 'Responsável', type: 'ref', ref: 'usuarios', list: true },
    { name: 'concluida_at', label: 'Concluída em', type: 'datetime', list: true },
    { name: 'concluida_por', label: 'Concluída por', type: 'ref', ref: 'usuarios', readonly: true },
    { name: 'obs', label: 'Observação', type: 'text' },
  ],
});

// ---------------------------------------------------------------- Administração
def({
  name: 'usuarios', label: 'Usuários', module: 'admin', display: 'nome', order: 'nome', posto: false,
  read: [P, G, 'rh', 'financeiro', 'chefe_pista', 'conveniencia'], write: [G],
  fields: [
    { name: 'nome', label: 'Nome', type: 'text', required: true, list: true },
    { name: 'login', label: 'Login', type: 'text', required: true, list: true },
    { name: 'senha', label: 'Senha (deixe em branco para manter)', type: 'password' },
    { name: 'perfil', label: 'Perfil', type: 'select', required: true, list: true, options: Object.entries(ROLES).map(([value, label]) => ({ value, label })) },
    { name: 'funcionario_id', label: 'Funcionário vinculado', type: 'ref', ref: 'funcionarios', list: true },
    { name: 'posto_id', label: 'Posto (vazio = todos)', type: 'ref', ref: 'postos', list: true },
    { name: 'telefone', label: 'WhatsApp para alertas', type: 'text' },
    { name: 'email', label: 'E-mail para alertas', type: 'text' },
    { name: 'trocar_senha', label: 'Pedir nova senha no próximo acesso', type: 'bool', default: 1 },
    { name: 'ativo', label: 'Ativo', type: 'bool', default: 1, list: true },
  ],
});

def({
  name: 'parametros', label: 'Parâmetros', module: 'admin', display: 'chave', order: 'grupo, chave', posto: false,
  read: [P, G], write: [G],
  fields: [
    { name: 'grupo', label: 'Grupo', type: 'text', list: true },
    { name: 'chave', label: 'Chave', type: 'text', required: true, list: true, readonly: true },
    { name: 'descricao', label: 'Descrição', type: 'text', list: true, readonly: true },
    { name: 'valor', label: 'Valor', type: 'text', required: true, list: true },
  ],
});

def({
  name: 'aprovacoes', label: 'Aprovações', module: 'admin', display: 'descricao', order: 'id DESC',
  read: [P, G, 'chefe_pista', 'financeiro', 'rh', 'conveniencia'], write: [],
  fields: [
    { name: 'tipo', label: 'Tipo', type: 'select', list: true, options: opt(['abono_falta_caixa', 'Abono de falta de caixa'], ['abono_ponto', 'Abono de falta (ponto)'], ['ajuste_estoque', 'Ajuste de estoque'], ['conta_pagar', 'Pagamento acima do limite'], ['estorno', 'Estorno'], ['troca_folga', 'Troca de folga'], ['hora_extra', 'Hora extra']) },
    { name: 'descricao', label: 'Descrição', type: 'text', list: true },
    { name: 'ref_tabela', label: 'Tabela', type: 'text', hidden: true },
    { name: 'ref_id', label: 'Registro', type: 'int', hidden: true },
    { name: 'valor', label: 'Valor', type: 'money', list: true },
    { name: 'solicitado_por', label: 'Solicitado por', type: 'ref', ref: 'usuarios', list: true },
    { name: 'status', label: 'Status', type: 'select', list: true, options: opt(['pendente', 'Pendente'], ['aprovado', 'Aprovado'], ['recusado', 'Recusado']) },
    { name: 'decidido_por', label: 'Decidido por', type: 'ref', ref: 'usuarios', list: true },
    { name: 'decidido_at', label: 'Decidido em', type: 'datetime', list: true },
    { name: 'motivo', label: 'Motivo', type: 'text' },
  ],
});

def({
  name: 'auditoria', label: 'Trilha de auditoria', module: 'admin', display: 'id', order: 'id DESC', posto: false,
  read: [P, G], write: [],
  fields: [
    { name: 'at', label: 'Data/hora', type: 'datetime', list: true },
    { name: 'usuario_id', label: 'Usuário', type: 'ref', ref: 'usuarios', list: true },
    { name: 'acao', label: 'Ação', type: 'text', list: true },
    { name: 'tabela', label: 'Tabela', type: 'text', list: true },
    { name: 'registro_id', label: 'Registro', type: 'int', list: true },
    { name: 'antes', label: 'Antes', type: 'textarea' },
    { name: 'depois', label: 'Depois', type: 'textarea' },
  ],
});

def({
  name: 'notificacoes', label: 'Envios de alertas (WhatsApp/e-mail)', module: 'admin', display: 'id', order: 'id DESC', posto: false,
  read: [P, G], write: [],
  fields: [
    { name: 'at', label: 'Data/hora', type: 'datetime', list: true },
    { name: 'canal', label: 'Canal', type: 'text', list: true },
    { name: 'destino', label: 'Destino', type: 'text', list: true },
    { name: 'mensagem', label: 'Mensagem', type: 'textarea', list: true },
    { name: 'status', label: 'Status', type: 'text', list: true },
    { name: 'chave', label: 'Chave', type: 'text', hidden: true },
  ],
});

def({
  name: 'fechamentos', label: 'Fechamentos mensais', module: 'contabil', display: 'competencia', order: 'competencia DESC',
  read: [P, G, 'rh', 'financeiro', 'contabilidade'], write: [G, 'rh', 'financeiro'],
  fields: [
    { name: 'competencia', label: 'Competência', type: 'text', required: true, list: true },
    { name: 'tipo', label: 'Tipo', type: 'select', list: true, options: opt(['dp', 'Fechamento do DP'], ['contabil', 'Pacote contábil']) },
    { name: 'itens', label: 'Checklist', type: 'json', hidden: true },
    { name: 'concluido_at', label: 'Concluído em', type: 'datetime', list: true },
    { name: 'enviado_at', label: 'Liberado à contabilidade em', type: 'datetime', list: true },
  ],
});

const BY_NAME = Object.fromEntries(R.map((r) => [r.name, r]));
for (const r of R) {
  if (r.posto === undefined) r.posto = true;
  if (!r.order) r.order = 'id DESC';
}

module.exports = { ROLES, MODULES, RESOURCES: R, BY_NAME, opt };
