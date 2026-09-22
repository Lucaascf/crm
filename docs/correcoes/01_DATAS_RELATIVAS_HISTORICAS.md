# Correção 01 — Datas relativas históricas

## Problema identificado

`extractMovingDate` resolvia expressões relativas usando o relógio da execução. Em replay, palavras como “hoje”, “amanhã” e dias da semana eram deslocadas da data original da conversa para a data da bateria.

## Como o bug foi reproduzido

Foi criado um teste permanente com a mensagem `amanhã à tarde` e a referência fixa `2020-12-31T15:00:00-03:00`. O resultado correto é `2021-01-01`, independentemente da data da máquina.

## Evidência antes da correção

Antes da alteração, o teste falhou com:

- data-base: `2020-12-31T15:00:00-03:00`;
- texto: `amanhã à tarde`;
- resultado produzido: `2026-09-20`;
- resultado esperado: `2021-01-01`.

O resultado produzido correspondia ao dia seguinte ao relógio da execução, comprovando que o segundo argumento ainda era ignorado pelo código antigo.

## Causa raiz

`resolveMovingDate(signals)` criava internamente `today = new Date()`. `extractMovingDate(messages)` não aceitava referência temporal e chamava o resolvedor sem contexto. O loader da bateria preservava os timestamps reais, mas o harness os removia ao criar o histórico passado à extração.

Isso costuma parecer correto numa conversa ao vivo porque o instante de processamento é próximo ao da mensagem. No replay histórico, os dois instantes são diferentes.

## Solução implementada

- `extractMovingDate(messages, referenceDate = new Date())` agora aceita uma referência explícita, mantendo fallback compatível para chamadas correntes.
- `resolveMovingDate(signals, referenceDate)` calcula exclusivamente sobre a referência recebida.
- O handler de produção fornece o `createdAt` da mensagem mais recente do histórico.
- O replay canônico preserva os timestamps e fornece o timestamp da mensagem de entrada mais recente, com fallback para a mensagem mais recente quando não há entrada do cliente.
- O prompt temporal foi reforçado para considerar sinais fornecidos pelo cliente, priorizar a decisão mais recente e não converter `semana que vem` em `relativeWeeks=1`. Esse ajuste foi necessário após uma divergência observada na validação real.

## Fluxo temporal antes

`replay/produção -> extractMovingDate(messages) -> resolveMovingDate(signals) -> new Date()`

## Fluxo temporal depois

`timestamp da mensagem -> extractMovingDate(messages, referenceDate) -> resolveMovingDate(signals, referenceDate) -> data determinística`

## Arquivos modificados

- `whatsapp-bot/src/ai.js`
- `whatsapp-bot/src/conversationHandler.js`
- `whatsapp-bot/test/battery/runFinalHybridBattery.js`
- `whatsapp-bot/test/historicalRelativeDates.test.js`
- `docs/correcoes/01_DATAS_RELATIVAS_HISTORICAS.md`

## Testes adicionados

O novo arquivo de regressão cobre:

- `hoje`;
- `amanhã`;
- `depois de amanhã`;
- `sexta`;
- `próxima sexta`;
- `semana que vem`, preservando a semântica atual de período vago (`null` sem um dia específico);
- data explícita (`dia 15 de janeiro`);
- virada de mês;
- virada de ano;
- independência entre a data-base fixa e o relógio real da máquina.

## Testes executados

- Regressão isolada antes da correção.
- Regressão isolada depois da correção.
- `npm test` em `whatsapp-bot`.
- `node --check` nos arquivos JavaScript alterados.
- `npm run lint` na raiz.
- `npm run build` na raiz.
- Validação dirigida com API real em dois casos citados no relatório canônico, sem executar a bateria completa.

## Resultados dos testes

- Regressão antes: falhou pelo motivo esperado (`2026-09-20` contra `2021-01-01`).
- Regressão depois: 2/2 testes passaram.
- Suíte do bot: 23/23 testes passaram.
- Sintaxe: passou.
- Lint: passou sem avisos ou erros.
- Build: concluído com sucesso, incluindo verificação de tipos do Next.js.

## Evidência da correção

Validação final com o modelo real `gpt-4o-mini-2024-07-18`:

| Conversa | Enunciado | Timestamp de referência | Antes (artefato canônico) | Depois | Resultado |
|---|---|---|---|---|---|
| `export/5511956059062.json` | `Deixemos para quinta-feira` | `2026-08-25T21:29:53.000Z` (`18:29:53 -03:00`) | datas ancoradas em setembro de 2026, incluindo `2026-09-25` | `2026-08-27` | correto |
| `export/557188435065.json` | `Amanhã à tarde.` | `2026-08-13T23:15:09.000Z` (`20:15:09 -03:00`) | `2026-09-19` | `2026-08-14` | correto temporalmente |

Foram feitas 5 chamadas reais no total: 2 na primeira validação, 1 para diagnosticar a divergência do primeiro caso e 2 validações finais contra o código definitivo. Consumo total: 5.242 tokens de prompt e 183 tokens de conclusão (5.425 tokens). Custo estimado pelo medidor existente: US$ 0,0008961. Nenhum segredo foi registrado.

Na primeira passagem, `5511956059062.json` produziu `2026-09-01`: o modelo havia retornado simultaneamente `weekdayName=quinta-feira` e o sinal indevido `relativeWeeks=1`. O reforço dirigido do prompt removeu a contradição; na execução final, retornou `weekdayName=quinta-feira`, `relativeWeeks=null` e a data correta `2026-08-27`.

## Casos limites verificados

- Mudança de mês e de ano por soma de dias.
- Dia da semana sem período e dia da semana na semana seguinte.
- Data absoluta sem regressão.
- Período vago continua sem virar data específica.
- Fallback de execução normal continua disponível.

## Riscos residuais

- A referência de produção é o `createdAt` persistido pelo CRM, não um timestamp original separado do WhatsApp. Para processamento ao vivo, os valores normalmente coincidem; reprocessamentos tardios de mensagens exigiriam persistir o timestamp original em outra tarefa.
- O modelo real do segundo caso final também retornou `weekdayName=sábado`, um sinal secundário sem suporte. `relativeDays=1` tem precedência determinística e gerou a data correta, mas sinais contraditórios do modelo continuam sendo um risco geral.
- O harness usa a mensagem de entrada mais recente como referência do turno. Identificar semanticamente a mensagem exata de origem quando o histórico mistura várias declarações temporais continua dependendo da extração dos sinais.

## Itens deliberadamente fora do escopo

- Separar data de mudança, vistoria, coleta e entrega.
- Gate de relevância para promoções e conversas fora do domínio.
- Travamento/finalização de workers, retries, métricas e demais recomendações da bateria.
- Alteração dos datasets ou dos artefatos originais da execução canônica.

## Conclusão

A resolução de datas relativas deixou de depender silenciosamente do relógio global, os testes determinísticos passaram e os dois casos reais dirigidos produziram as datas históricas esperadas com o modelo real.

STATUS: CORREÇÃO CONFIRMADA POR TESTES
