# Plataforma de Gestão Integrada do Posto

Sistema web (navegador e celular) que reúne **pista, RH/DP, financeiro, conveniência, combustíveis, preços e documentos** de um posto de combustível, com painel do gerente e central de alertas. Ele avisa o gerente antes que algo vença, falte ou dê prejuízo. Foi construído a partir do PRD *Plataforma de Gestão do Posto*.

## Como rodar

Requisito: **Node.js 22.5 ou mais recente**. O sistema não tem dependências externas: usa o SQLite nativo do Node e não exige `npm install`.

```bash
npm start            # http://localhost:3000  (PORT, DATA_DIR e TZ configuráveis)
npm run seed         # recria o banco com ~75 dias de dados de demonstração
npm test             # testes automatizados (regras de negócio + API)
```

Na primeira execução o banco (`data/posto.db`) é criado e preenchido com dados de demonstração. Todos os usuários de exemplo usam a senha `posto123`:

| Usuário | Perfil | O que vê |
|---|---|---|
| `gerente` | Gerente | Tudo; aprova estornos, ajustes e abonos |
| `dono` | Proprietário | Leitura total e relatórios, exceto dados de saúde (LGPD) |
| `chefe` | Chefe de pista | Turno pelo celular, caixas, ocorrências, escalas e pesquisa de preço |
| `joao`, `maria` | Frentista | Autoatendimento: ponto, escala, banco de horas, comissão e assinaturas |
| `financeiro` | Aux. administrativo/financeiro | Financeiro, conciliações, LMC |
| `rh` | RH/DP | Ponto, atestados, férias, EPI, advertências, fechamento do DP |
| `conveniencia` | Conveniência | Notas, contagem, preços, avarias, validade, temperaturas |
| `contador` | Contabilidade (externo) | Só o pacote mensal liberado |

## Módulos

| Módulo | Principais recursos |
|---|---|
| **Painel do gerente** | Vendas do dia e do mês com comparativo, margem por combustível (custo da última compra), caixa, inadimplência, pessoas presentes x escaladas, alertas por cor, checklists do dia e agenda da semana. Cada indicador leva ao módulo de origem. |
| **Pista** | Abertura de turno com presença, encerrantes, medição dos tanques e checklist. Sangrias, ocorrências e recebimento de combustível. Fechamento de caixa por frentista comparado com o sistema, com **assinatura digital** (login do frentista). Ranking de faltas de caixa com alertas. **Desconto em folha só com termo anexado.** |
| **RH / DP** | Cadastro e linha do tempo do funcionário. Importação do relógio (**AFD**, Portarias 1510 e 671) ou ponto por app com geolocalização. Espelho de ponto com HE 50%/100%, adicional noturno (hora reduzida), atrasos, banco de horas e assiduidade. Atestados com alerta de INSS. Escalas 6x1/12x36 com conflitos e escala do GNV. Férias (alerta 60/30 dias e conflitos), 13º, comissão do grid, EPI com CA, advertências, comunicados com confirmação de leitura, SST/eSocial e fechamento do DP. |
| **Financeiro** | Contas a pagar (aprovação acima do limite) e a receber. Inadimplência por faixa com bloqueio automático. Conciliação bancária por **OFX** com casamento automático. Cartões: venda x esperado x recebido. Dinheiro/PIX x depósitos. Fluxo de caixa de 30 dias, indicadores e **DRE gerencial** comparativa. |
| **Conveniência** | Vendas por categoria e por hora, **curva ABC**, produtos parados, entrada de **NF-e (XML)** com conferência, precificação por margem-alvo, contagem com aprovação de ajuste, perdas, validade e temperaturas. |
| **Combustíveis** | **LMC** diário com tolerância configurável, previsão de pedido por tanque, testes de qualidade na descarga (densidade e teor de etanol), com **bloqueio quando reprova**. Aferição de 20 L, lacres, estanqueidade, caixa separadora e GNV. |
| **Preços e margem** | Pesquisa de concorrentes com foto, média ANP, simulador de preço (margem e impacto estimado), histórico de alterações e tarefa para atualizar o painel da pista. |
| **Documentos e licenças** | Validade, arquivo, responsável, status automático, checklist de renovação, avisos em 90/60/30/15/7 dias e **pasta de fiscalização** no celular. |
| **Agenda** | Obrigações diárias, semanais, mensais, semestrais e anuais geradas automaticamente, com responsável e atraso. Várias são concluídas pelo próprio sistema, por exemplo ao abrir o turno ou fechar o LMC. |
| **Contabilidade** | Pacote mensal em ZIP (RH, financeiro, fiscal e anexos), liberado após checklist. |

### Requisitos não funcionais atendidos
- **Perfis de acesso** por recurso, com autoatendimento restrito aos próprios registros.
- **Trilha de auditoria** de todas as alterações, logins, assinaturas e importações.
- **Aprovação do gerente** para estornos, ajustes de estoque, abonos de falta (caixa e ponto), trocas de folga e pagamentos acima do limite.
- **LGPD**: atestados e ASOs são visíveis só para RH e gerente, e o pacote contábil sai sem CID.
- **Offline na pista**: o app fica instalado (PWA/service worker) e abertura e fechamento de turno, caixas, sangrias e ponto feitos sem internet entram numa fila e são sincronizados quando a conexão volta.
- **Backup diário automático** em `data/backups/`, mantendo 30 dias.
- **Exportação**: toda lista sai em CSV para Excel e toda tela pode ser impressa em PDF pelo navegador.
- **Multi-posto**: os registros são separados por posto, com seletor e visão consolidada da rede.
- **Avisos por WhatsApp/e-mail**: configure as URLs de webhook em *Parâmetros*. Sem elas, os envios ficam apenas registrados em *Envios de alertas*.

### Parâmetros configuráveis
Regras legais e municipais mudam, por isso ficam em **Administração → Parâmetros** e podem ser ajustadas: tolerância do LMC, teor de etanol, faixas de densidade, limites de falta de caixa e de horas extras, dias de aviso dos documentos, elasticidade do simulador, entre outras. **Valide os valores com a contabilidade, a empresa de SST e a regra vigente da ANP.**

## Integrações
A API direta com o **Linx/Webposto** depende de liberação da Linx (risco apontado no PRD). Enquanto ela não vem, o sistema importa as vendas por CSV (*Financeiro → Importar vendas*). Extrato bancário entra por OFX, ponto por AFD e notas de entrada por XML da NF-e.

## Estrutura
```
server/            API HTTP sem dependências
  resources.js     catálogo de tabelas, campos e permissões (gera o esquema do banco)
  services/        regras de negócio por módulo (pista, rh, financeiro, …, alertas, painel)
  seed.js          dados de demonstração
public/            interface (SPA em módulos ES, sem build) + service worker
test/              testes com node:test
```
