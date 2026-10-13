# Guia de implantação — Gestão do Posto

Este guia leva o sistema da demonstração para o uso real no posto. Ele tem quatro partes: onde instalar, como instalar, o que cadastrar e como colocar a equipe para usar.

---

## 1. Onde instalar: escolha um dos dois caminhos

| | **A. Computador do posto** | **B. Servidor na internet (nuvem)** |
|---|---|---|
| Custo | Zero (usa um PC que já existe) | Cerca de US$ 7 a 25 por mês |
| Acesso | No PC e nos celulares conectados ao **Wi-Fi do posto** | De qualquer lugar: casa, celular no 4G, contador |
| Exige | Um PC (Windows) que fique **ligado o dia todo** | Cartão de crédito e uma conta no serviço |
| Backup | Diário no próprio PC. Copie a pasta `data` para um pendrive ou nuvem toda semana | Diário no servidor, mais o backup do próprio serviço |
| Indicado para | Começar já e testar com a equipe | Uso definitivo, com gerente e dono acompanhando de fora |

**Recomendação:** comece pelo **caminho A** para testar com a equipe por algumas semanas. Depois, se quiser acessar de fora do posto, mude para o caminho B levando a pasta `data` (os dados vão junto).

---

## 2A. Instalação no computador do posto (Windows)

1. **Instale o Node.js:** acesse https://nodejs.org, baixe a versão **LTS** e instale clicando em "Avançar" até o fim.
2. **Baixe o sistema:** em https://github.com/Cellen-Camila/Posto-Natal, escolha o branch do sistema, clique em **Code → Download ZIP** e descompacte numa pasta fixa, por exemplo `C:\GestaoPosto`.
3. **Inicie:** dê dois cliques em **`iniciar-posto.bat`**. Uma janela preta se abre e o navegador abre o sistema sozinho.
   - **Não feche a janela preta.** Ela é o sistema funcionando. Pode minimizar.
4. **Primeiro acesso:** a janela preta mostra o usuário `gerente` e uma **senha provisória**. A mesma senha fica salva em `data\ACESSO-INICIAL.txt`. Entre com ela, crie a sua senha pessoal e depois **apague esse arquivo**.
5. **Celulares da equipe:** a janela preta mostra também um endereço do tipo `http://192.168.0.15:3000`. Com o celular **no Wi-Fi do posto**, abra esse endereço no navegador.
   - Para virar um aplicativo: no Chrome do Android, menu ⋮ → **Adicionar à tela inicial**. No iPhone, botão Compartilhar → **Adicionar à Tela de Início**.
   - Se o Windows perguntar sobre o Firewall, clique em **Permitir acesso** (marque "Redes privadas").

**Para o sistema iniciar sozinho quando o PC ligar:** aperte `Win + R`, digite `shell:startup`, aperte Enter e coloque ali um **atalho** para o `iniciar-posto.bat`.

**Dicas do caminho A:**
- Configure o PC para **não hibernar** (Configurações → Energia → Suspensão: Nunca).
- Peça ao técnico de informática para fixar o IP do PC no roteador. Assim o endereço dos celulares não muda.
- Os dados ficam todos na pasta `data`. **Copie essa pasta para um pendrive ou Google Drive toda semana.**

**Quer mostrar o sistema para alguém sem misturar com os dados reais?** Use `iniciar-demonstracao.bat`. Ele abre a versão com dados fictícios, numa pasta separada (`data-demo`).

---

## 2B. Instalação em servidor na internet

Funciona em qualquer serviço que rode **Docker com disco persistente**: Render, Railway, Fly.io ou uma VPS (Hostinger, DigitalOcean, Locaweb). Exemplo no **Render**:

1. Crie uma conta em https://render.com e ligue a sua conta do GitHub.
2. **New → Web Service** → escolha o repositório `Posto-Natal` e o branch do sistema. O Render detecta o `Dockerfile` sozinho.
3. Plano: **Starter** (o gratuito apaga os dados quando o serviço reinicia).
4. Em **Disks**, adicione um disco: *Mount path* `/app/data`, 1 GB.
5. Em **Environment**, adicione `POSTO_NOME` (o nome do posto) e `SENHA_GERENTE` (uma senha provisória forte, só sua).
6. Clique em **Deploy**. Em alguns minutos você recebe um endereço `https://...onrender.com`, já com cadeado (HTTPS). Esse endereço abre no celular de qualquer lugar.
7. Entre com `gerente` e a senha que você definiu em `SENHA_GERENTE`. O sistema pede que você crie a sua senha pessoal.

> Se preferir, o Claude pode fazer esses passos com você, um de cada vez.

---

## 3. Primeiros cadastros (o painel mostra esta lista e marca o que já foi feito)

Faça nesta ordem. Os nomes entre parênteses são os do menu do sistema.

1. **Dados do posto:** CNPJ, endereço e bandeira (Administração → Postos).
2. **Combustíveis:** confira a lista e preencha o **preço de bomba** e o custo da última compra (Combustíveis → Combustíveis).
3. **Tanques:** um por tanque físico, com capacidade e estoque de segurança (Combustíveis → Tanques).
4. **Bicos:** um por bico, ligado ao tanque, com o **encerrante atual** lido na bomba (Combustíveis → Bicos e bombas).
5. **Funcionários:** nome, CPF, PIS, função, admissão, salário, escala, horário de entrada e jornada (RH/DP → Funcionários).
6. **Escalas:** monte as duas próximas semanas (RH/DP → Escalas).
7. **Acessos (usuários):** crie um para cada pessoa que vai usar, ligado ao funcionário (Administração → Usuários).
   - Defina uma senha provisória: no primeiro acesso a pessoa cria a própria.
   - Perfis: *Chefe de pista*, *Frentista / caixa*, *Responsável RH/DP*, *Auxiliar financeiro*, *Responsável conveniência*, *Proprietário*, *Contabilidade*.
8. **Documentos e licenças:** cadastre todos, com validade e o PDF ou foto (Documentos e licenças). A partir daí os avisos de 90, 60, 30, 15 e 7 dias começam a funcionar.
9. **Contas bancárias, fornecedores, clientes a prazo e concorrentes** (menus Financeiro, Administração e Preços).
10. **Parâmetros:** confira os limites com a contabilidade e a empresa de segurança do trabalho (Administração → Parâmetros).
    - Exemplos: tolerância do LMC, teor de etanol, limite de falta de caixa, limite de horas extras.

**Produtos da conveniência:** cadastre aos poucos, ou importe as notas de entrada em XML (Conveniência → Entrada de notas). O produto é reconhecido pelo código.

---

## 4. Colocando a equipe para usar

| Quem | Primeira semana | Onde |
|---|---|---|
| **Chefe de pista** | Abrir e fechar o turno pelo celular, conferir o caixa de cada frentista e colher a assinatura | Pista → Turno atual |
| **Frentistas** | Entrar no celular, ver a escala, assinar EPI e comunicados | Minha área |
| **Financeiro** | Cadastrar contas a pagar e a receber, importar o extrato OFX do banco | Financeiro |
| **RH/DP** | Importar o arquivo AFD do relógio de ponto, lançar atestados, ASOs e entregas de EPI | RH / DP |
| **Conveniência** | Importar os XML das notas, fazer a primeira contagem de estoque | Conveniência |
| **Gerente** | Olhar o painel todo dia e responder às aprovações | Painel e Aprovações |

**Dica:** comece só com **Pista + Documentos + RH básico** (é a fase 1 do PRD). Depois de duas ou três semanas, ligue o financeiro e a conveniência.

---

## Segurança e cuidados

- Cada pessoa tem o próprio login. **Não compartilhe senhas.** Tudo o que cada um faz fica registrado na trilha de auditoria.
- Depois de 5 senhas erradas seguidas, o usuário fica bloqueado por 15 minutos.
- Esqueceu a senha? O gerente define uma nova em Administração → Usuários. No próximo acesso a pessoa cria a própria.
- **Funcionário desligado:** desmarque "Ativo" no usuário dele no mesmo dia.
- **Backup:** o sistema faz um backup por dia em `data/backups` e guarda os últimos 30. Mesmo assim, guarde uma cópia **fora** do computador.
- **LGPD:** atestados e ASOs só aparecem para RH e gerente. Peça aos funcionários a assinatura do termo de consentimento e marque isso no cadastro de cada um.

## Ainda não automático (próximas etapas)

- **Linx/Webposto:** as vendas entram por importação de arquivo CSV (Financeiro → Importar vendas) até a Linx liberar o acesso à integração.
- **WhatsApp e e-mail:** os avisos ficam registrados no sistema. Para chegarem ao celular, é preciso contratar um serviço de envio (por exemplo Z-API ou Twilio) e colar o endereço em Parâmetros.
