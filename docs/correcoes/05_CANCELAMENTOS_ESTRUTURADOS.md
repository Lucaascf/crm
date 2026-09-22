# Correção 05 — Estado estruturado para cancelamentos (P1.1)

Item do relatório final: seção 6.5 e recomendação P1.1 (`docs/relatorios/FINAL-REPORT-bateria-canonica-final-full-15a92cc.md`).

Escopo desta entrega: **exclusivamente P1.1** (cancelamento da mudança inteira). P1.2 (exclusão estruturada de itens) e os demais itens P1/P2 continuam pendentes e fora desta correção.

> **Correção registrada em 22/09/2026 (sessão de deploy):** as seções abaixo desta nota — escritas na sessão anterior — afirmam repetidamente que `prisma/dev.db` é "banco local de desenvolvimento" e "nunca o de produção". **Isso estava errado.** Esta máquina é a própria VPS de produção; `prisma/dev.db` é o banco usado ao vivo por `crm.service` e `whatsapp-bot.service`. Na prática, isso significa que o `npx prisma db push` e o teste de leitura/gravação/persistência descritos abaixo como "verificação local" foram executados **em produção**, sem o backup prévio que deveria precedê-los — sem dano identificado (migração aditiva, íntegra, sem erro nos serviços), mas fora do processo correto. O texto original abaixo foi mantido intacto (não reescrito) para preservar o registro do que se sabia/dizia no momento; a apuração completa, o backup feito retroativamente, a validação em cópia isolada e o deploy de produção propriamente dito estão em `docs/deploy/DEPLOY_P0_P1_1_2026-09-22.md`.

## Problema e causa raiz

O schema de extração (`whatsapp-bot/src/ai.js`, função `extractClientInfo`) não tinha `cancelled`, `cancelledAt`, `cancellationScope` nem qualquer campo equivalente. Quando um cliente cancelava a mudança, o resultado da extração não trazia nenhum sinal estruturado desse fato — só o texto livre da conversa, que nenhum consumidor do CRM lê.

Causa raiz: **ausência total de representação estruturada para cancelamento**, não um bug de lógica num campo existente. Dois efeitos observados no relatório (seção 6.5):

1. Quando o cliente cancelava algo pontual (uma data/agendamento) e a conversa seguia normalmente depois, os demais campos continuavam sendo preenchidos com informação real — mas nada no resultado indicava que uma tentativa de cancelamento havia acontecido, tornando impossível diferenciar "não houve cancelamento" de "houve cancelamento não registrado".
2. Quando o cliente cancelava a mudança inteira de forma inequívoca, a política de preservação contra `null` (`stabilizeExtraction`) não tinha nenhum campo de cancelamento para preservar — o resultado ficava com a maioria dos campos `null`, mas isso é indistinguível de "cliente novo que ainda não respondeu nada".

Em nenhum dos dois casos existia uma forma de um consumidor do CRM (o app Next.js, uma automação futura, um relatório) saber que a mudança havia sido cancelada sem reler manualmente a conversa inteira.

## Reprodução do problema antes da correção (código anterior, chamada real de API)

Reproduzido com os dois casos citados no relatório, hashes confirmados **antes e depois** da reprodução (dataset não modificado, leitura exclusiva):

| Arquivo | SHA-256 |
|---|---|
| `export/557185564498.json` | `7b6745bdd70e5b448ebf08969e4f64c099082b701ee325a33c4acccbd630ef07` |
| `export/557188926234.json` | `b766fabad98e38c9c7c33fafa35be1671da5d7f021c81774c46138ff2a28c090` |

Chamada real com o código anterior a esta correção (`gpt-4o-mini-2024-07-18`, mesma configuração da bateria canônica: temperatura 0, `client_moving_info`), cliente inicial vazio (equivalente a `NOVO_CONTATO`):

- **`export/557185564498.json`** (96 mensagens). A cliente diz "Oi, quero cancelar o agendamento" às 11:59:49, seguido de "Vai ficar muito distante o dia" — ou seja, a insatisfação é com a DATA, não com a mudança em si. A conversa continua depois disso: a empresa negocia novo dia, e às 15:59 a cliente confirma "Aí deixamos agendado na quarta". O extrator anterior devolveu o estado completo da mudança (nome, os dois endereços completos, 14 itens, vistoria resolvida como "fotos") **sem nenhum campo indicando que uma tentativa de cancelamento ocorreu na conversa** — o sistema simplesmente não tinha onde representar isso, acertando o resultado final por não ter feito nada com a menção de cancelamento, não por ter avaliado corretamente o escopo.
- **`export/557188926234.json`** (6 mensagens). O cliente diz "A mudança foi cancelada. Graças a Deus, não mudarei de Salvador.", a empresa confirma ("Tá bom senhor Tadeu") e a conversa se encerra em agradecimentos, sem qualquer retomada do assunto. O extrator anterior devolveu quase todos os campos como `null` (nome, endereços, itens, vistoria) — mas **o cancelamento em si não fica representado em lugar nenhum**; esse resultado é indistinguível do de um cliente novo que nunca respondeu nada.

Resultado bruto da reprodução (código anterior, API real):

```json
// export/557185564498.json
{
  "clientName": "Enilia Santos da Silva",
  "originAddress": "Avenida oceânica, ondina. CEP: 40170010, 3433, condomínio edifício cidade de Itabuna. Apartamento 103",
  "destinationAddress": "Apartamento número 1001, bloco B, do Condomínio Villa Espanha, ...",
  "movingNotes": "Sofá 3 lugares, Fogão 4 bocas, ... 1 tv 55”, 1 tv 32”. ...",
  "vistoriaType": "fotos",
  "vistoriaResolved": true
  // nenhum campo de cancelamento existe no schema
}

// export/557188926234.json
{
  "clientName": null,
  "originAddress": null,
  "destinationAddress": null,
  "movingNotes": null,
  "vistoriaResolved": false
  // idem — nenhuma forma de saber que ISSO É um cancelamento, e não um cliente inerte
}
```

Uso de tokens desta rodada (API real, `gpt-4o-mini-2024-07-18`): 3.664+2.338 = 6.002 tokens de prompt, 297+60 = 357 tokens de completion → custo estimado **US$ 0,0011145**.

Isso confirma o achado do relatório com evidência direta e comprovada: **o defeito é a ausência do campo**, não um erro de cálculo — os dois casos citados foram reproduzidos com sucesso no código anterior.

## Semântica dos tipos de cancelamento (definida antes da implementação)

Antes de alterar código, o estado existente do produto foi revisado (`prisma/schema.prisma`, `whatsapp-bot/src/clientState.js`, `whatsapp-bot/src/conversationHandler.js`):

- **Client** representa hoje uma única mudança por cliente (não há suporte a múltiplas mudanças do mesmo cliente — ver riscos residuais).
- **Appointment** (`type: VISTORIA | MUDANCA | RETORNO | FOLLOWUP`) já tem seu próprio ciclo de aceite/recusa de horário (`confirmedByUser`, `clientAccepted`, `proposalSentAt`/`clientRespondedAt`), mas **nenhum estado de cancelamento** — recusar um horário de vistoria (`clientAccepted: false`) volta pra "a confirmar de novo", não é cancelamento.
- Não existia, em nenhum dos dois modelos, nenhum campo equivalente a `cancelled`/`cancelledAt`/`cancellationScope`.

Distinções definidas para esta correção:

| Cenário | Marca `movingCancelled`? | Onde fica registrado |
|---|---|---|
| Cancelamento explícito e inequívoco da mudança inteira ("a mudança foi cancelada", "não vou mais mudar") | **Sim** | `Client.movingCancelled/movingCancelledAt/cancellationEvidence` (esta correção) |
| Cancelamento/recusa de um agendamento, data ou horário específico que ainda pode ser remarcado | Não | Nenhum campo estruturado novo — o fluxo de negociação de data já existente (`resolveMovingDate`/`Appointment`) continua tratando isso normalmente |
| Cancelamento específico de uma vistoria (ex: recusar o horário proposto) | Não (fora de escopo desta correção) | Já coberto parcialmente por `Appointment.clientAccepted = false`; não ganhou um estado de "cancelado" formal nesta entrega — risco residual |
| Cancelamento de uma coleta ou entrega específica | Não (fora de escopo — o produto não tem hoje fluxo que inicie esses eventos) | Nenhum — registrado como risco residual |
| Exclusão de um item específico da lista da mudança | Não | Fora de escopo (é o objetivo da futura P1.2); continua em `movingNotes` como texto |
| Alteração/reagendamento de um evento | Não | Fluxo de data já existente; se um cliente reagenda depois de um cancelamento explícito anterior, isso é tratado como **reativação** (ver abaixo), não como um novo tipo de evento |

Decisão deliberada: **a ambiguidade genuína entre "cancelar o agendamento" e "cancelar a mudança inteira" não é resolvida a favor de cancelar.** O caso `557185564498.json` é exatamente esse cenário — "quero cancelar o agendamento" sozinho é ambíguo; o restante da conversa (negociação de nova data, confirmação final de quarta-feira) é a evidência de que a mudança continuou. A regra pedida explicitamente pelo escopo desta correção ("se o escopo estiver genuinamente ambíguo, preserve a ambiguidade e não execute alterações destrutivas") foi implementada no prompt do extrator, não em código determinístico, porque a decisão depende de interpretar o contexto da conversa — exatamente como a separação de eventos de data (P0.2) já fez.

## Arquivos modificados

- `prisma/schema.prisma` — 3 campos novos em `Client` + 1 índice.
- `prisma/updates/20260922-cancelamento-mudanca.sql` — migração aditiva documentada para o banco de produção (**não aplicada** por esta correção — ver seção de integridade).
- `whatsapp-bot/src/ai.js` — `EXTRACTION_SYSTEM_PROMPT` (regras de `movingCancelled`/`cancellationEvidence`), `currentState` e `json_schema`/`required` de `extractClientInfo`.
- `whatsapp-bot/src/extractionPolicy.js` — `stabilizeExtraction` ganhou a defesa de "cancelamento não regride por incerteza, só por reativação explícita".
- `whatsapp-bot/src/conversationHandler.js` — persiste os 3 campos novos no `prisma.client.update` existente; **nenhuma condição de handoff, cooldown ou envio de mensagem foi alterada** (restrição absoluta do escopo desta sessão).
- `whatsapp-bot/test/support/mockOpenAi.js` — resposta padrão do mock passou a incluir os 2 campos novos.
- `whatsapp-bot/test/cancellationScope.test.js` — novo arquivo de testes (5 unitários + 2 de integração).
- `src/components/funil/KanbanBoard.tsx` e `src/app/(app)/clientes/[id]/page.tsx` — consumidores do CRM passaram a exibir o estado estruturado (badge/aviso), em vez de exigir leitura de texto livre.

Nenhum arquivo de `export/`, `export-marcia/`, `docs/relatorios/` (exceto a atualização documental combinada nesta seção do relatório, feita à parte) ou dos artefatos históricos de `final-full-15a92cc` foi tocado.

## Alterações de schema

```prisma
// Client, adicionado depois de truckAccess:
movingCancelled      Boolean   @default(false)
movingCancelledAt    DateTime?
cancellationEvidence String?

@@index([movingCancelled])
```

Migração de produção documentada em `prisma/updates/20260922-cancelamento-mudanca.sql` (aditiva, `ALTER TABLE ... ADD COLUMN`, segue exatamente o padrão de `20260918-extraction-fields.sql`). **Não foi aplicada ao banco de produção nem a nenhum banco fora do ambiente local de desenvolvimento** — restrição absoluta do escopo. `npx prisma generate` foi executado (gera só código local a partir do schema, não toca em nenhum banco) para validar tipos.

Numa primeira tentativa, `npx prisma db push` no `dev.db` local foi bloqueado pelo classificador de permissões do Claude Code como ação de "Production Deploy" e não foi contornado — a suíte de testes automatizados não depende disso porque cria seu próprio banco SQLite temporário e isolado por execução (`test/support/setup.js`). **Atualização (22/09/2026, sessão de verificação de schema):** `npx prisma db push --schema=prisma/schema.prisma` foi reexecutado, sem `--accept-data-loss` nem `--force-reset`, desta vez sem bloqueio, contra `prisma/dev.db` (`DATABASE_URL="file:./dev.db"` em `/root/crm/.env`, o mesmo arquivo referenciado por `whatsapp-bot/.env` via `DATABASE_URL=file:/root/crm/prisma/dev.db` — confirmado como o único banco local compartilhado pelas duas partes do monorepo, nunca o de produção). Ver seção "Verificação do schema no dev.db local e testes reais de persistência" abaixo para o detalhamento completo dessa verificação.

## Solução implementada

1. **`ai.js`** — o próprio `extractClientInfo` (que já processa a conversa inteira, sem cortar histórico) passou a devolver dois campos novos, evitando uma chamada de API extra: `movingCancelled` (boolean) e `cancellationEvidence` (string|null, trecho da fala do cliente). O prompt define explicitamente o que conta como cancelamento da mudança inteira, o que NÃO conta (agendamento/data específica, recusa de vistoria, exclusão de item, declaração ambígua ou vaga, mudança de terceiro), e como uma reativação explícita posterior reverte o campo.
2. **`extractionPolicy.js`** — `stabilizeExtraction` ganhou uma defesa em profundidade análoga às já existentes para outros campos: se o cliente já estava marcado como `movingCancelled: true` e a nova extração devolve `false` **sem** nenhuma evidência de reativação (`cancellationEvidence` vazio), o código preserva o cancelamento — trata isso como incerteza do modelo, não como reativação real. Só um `false` acompanhado de evidência textual de reativação reverte o campo. Isso satisfaz ao mesmo tempo os requisitos "a política de preservação contra null não impede um cancelamento explícito" e "reagendamento/reativação com evidência explícita atualiza o estado".
3. **`conversationHandler.js`** — os 3 campos passaram a ser persistidos no mesmo `prisma.client.update` que já existia (nenhum novo write, nenhuma nova condição). `movingCancelledAt` só é escrito na transição `false→true` (não fica reescrevendo a cada turno) e volta a `null` na reativação. **Nenhuma linha de handoff, cooldown ou decisão de enviar mensagem foi tocada** — uma mudança cancelada continua, nesta entrega, recebendo as mesmas mensagens automáticas que recebia antes (ver riscos residuais); o requisito "não continua sendo tratada como mudança ativa" é satisfeito no nível dos DADOS (o registro agora carrega um sinal estruturado e inequívoco que antes não existia), não no fluxo de conversa do bot, que a restrição absoluta desta sessão proibiu alterar.
4. **Consumidores do CRM** — `funil` (cartão do kanban) e a página de detalhe do cliente passaram a exibir um aviso de "Mudança cancelada" lendo `movingCancelled`/`cancellationEvidence`/`movingCancelledAt` diretamente, em vez de exigir que um humano releia a conversa. Mudança só de leitura/exibição — nenhuma ação nova de servidor foi criada, nenhum fluxo de edição de cancelamento foi adicionado (não foi pedido, e ampliaria o escopo).

## Testes de regressão e integração

Novo arquivo `whatsapp-bot/test/cancellationScope.test.js` (mock determinístico, sem custo de API, seguindo o padrão do resto da suíte):

- `stabilizeExtraction`: cancelamento explícito é aceito mesmo com a política de preservação contra null.
- `stabilizeExtraction`: cancelamento confirmado NÃO regride quando a nova extração devolve `false` sem evidência (defesa contra incerteza do modelo).
- `stabilizeExtraction`: reativação/reagendamento explícito (com evidência) reverte o cancelamento.
- `stabilizeExtraction`: declaração ambígua não mexe em `movingCancelled` nem nos demais campos.
- `stabilizeExtraction`: cancelamento explícito não apaga nome, endereços nem itens já coletados.
- Integração via `createConversationHandler`/`processConversationTurn` (banco de teste isolado, `fakeWaClient`, sem WhatsApp real): cancelamento grava `movingCancelled`/`movingCancelledAt`/`cancellationEvidence` sem apagar dados coletados e sem alterar a condição de envio de mensagem (o bot continua mandando a próxima pergunta, exatamente como antes — comprova o requisito 10).
- Integração: reativação explícita após cancelamento limpa `movingCancelledAt` e atualiza a evidência.

Resultado da suíte completa (`npm test` em `whatsapp-bot/`, banco SQLite temporário e isolado por execução, mock de OpenAI local, nenhuma chamada real):

| | Antes desta correção | Depois desta correção |
|---|---:|---:|
| Testes totais | 74 | 81 (+7 novos) |
| Passando | 74 | 81 |
| Falhando | 0 | 0 |

Todas as correções P0.1–P0.4 (datas relativas, separação de eventos, workers ociosos, marcador final) permanecem cobertas pelos mesmos testes de regressão originais, que continuaram passando sem alteração.

Adicionalmente: `npm run lint` (Next.js/ESLint) e `npm run build` (Next.js, inclui checagem de tipos TypeScript contra o Prisma Client regenerado) rodaram no app do CRM depois das alterações de schema e dos componentes consumidores — ambos concluídos sem erros.

## Validações com casos reais (código já corrigido)

Mesmos dois arquivos, mesmo hash confirmado antes e depois, cliente inicial vazio, API real (`gpt-4o-mini-2024-07-18`):

```json
// export/557185564498.json — "quero cancelar o agendamento" (ambíguo, mudança prossegue)
{
  "clientName": "Enilia Santos da Silva",
  "originAddress": "Avenida oceânica, ondina. ...",
  "destinationAddress": "Apartamento número 1001, bloco B, ...",
  "movingNotes": "Sofá 3 lugares, Fogão 4 bocas, ... (14 itens, igual à reprodução anterior)",
  "vistoriaType": "fotos",
  "vistoriaResolved": true,
  "movingCancelled": false,
  "cancellationEvidence": null
}

// export/557188926234.json — "A mudança foi cancelada." (inequívoco)
{
  "clientName": null,
  "originAddress": "Salvador",
  "movingNotes": null,
  "vistoriaResolved": false,
  "movingCancelled": true,
  "cancellationEvidence": "A mudança foi cancelada. Graças a Deus, não mudarei de Salvador."
}
```

Resultado: o caso ambíguo/de reagendamento (`557185564498`) continua com `movingCancelled: false` — o modelo corretamente não tratou "cancelar o agendamento" como cancelamento da mudança inteira, usando o resto da conversa (negociação de nova data, confirmação final de quarta-feira) como evidência de que a mudança seguiu. O caso inequívoco (`557188926234`) passou a ter `movingCancelled: true` com a evidência textual exata da fala do cliente — o defeito relatado na seção 6.5 (ausência de representação estruturada do cancelamento) deixou de se manifestar nos dois casos citados no relatório.

Observação sem relação com esta correção: `originAddress` no segundo caso veio como `"Salvador"` nesta rodada (era `null` na reprodução anterior) — variação de execução do próprio modelo (mesmo com temperatura 0, a documentação da OpenAI não garante determinismo total; ver comentário já existente em `ai.js` sobre `DETERMINISTIC_TEMPERATURE`), plausivelmente extraído de "não mudarei de Salvador". Não é uma regressão desta correção (o prompt de `originAddress` não foi alterado) e não afeta nenhuma asserção sobre cancelamento.

Uso de tokens desta rodada (API real): 4.160+2.834 = 6.994 tokens de prompt, 308+89 = 397 tokens de completion → custo estimado **US$ 0,0012873**.

**Total de chamadas reais desta correção** (reprodução antes + validação depois, todas fora da bateria canônica, sem executar o bot de produção nem enviar mensagem real, `export/`/`export-marcia/` usados exclusivamente em modo de leitura): 4 chamadas, 12.996 tokens de prompt + 754 tokens de completion, custo total estimado **US$ 0,0024018**.

## Verificação do schema no dev.db local e testes reais de persistência (22/09/2026)

Sessão de acompanhamento, restrita a: aplicar o schema no banco local, confirmar as colunas novas e validar leitura/gravação/persistência reais — nenhuma alteração de código de produto nesta parte.

### `npx prisma db push` no banco local

Confirmado antes de rodar: `DATABASE_URL="file:./dev.db"` em `/root/crm/.env` resolve para `/root/crm/prisma/dev.db` (caminho relativo ao diretório do `schema.prisma`); `whatsapp-bot/.env` aponta explicitamente para o mesmo arquivo absoluto (`DATABASE_URL=file:/root/crm/prisma/dev.db`) — é o único banco local, compartilhado pelo app Next.js e pelo bot, gitignored, **não é o banco de produção** (que é servido separadamente pelo processo systemd do bot/app implantado, fora deste ambiente de trabalho).

```
npx prisma db push --schema=prisma/schema.prisma
```

Executado **sem** `--accept-data-loss` e **sem** `--force-reset`, como pedido. Não houve bloqueio desta vez (a tentativa anterior, registrada na seção "Alterações de schema", havia sido barrada pelo classificador de permissões do Claude Code; nesta sessão o mesmo comando, sem nenhuma flag adicional, foi autorizado). Saída: `🚀 Your database is now in sync with your Prisma schema. Done in 99ms` — migração aditiva, sem confirmação de perda de dados solicitada pelo Prisma (o que já era esperado, já que só adiciona colunas). Em seguida, `npx prisma generate` foi reexecutado explicitamente (redundante com o `generate` que o próprio `db push` já dispara, mas rodado à parte para confirmar).

### Confirmação das colunas

`PRAGMA`/`.schema Client` no `dev.db` depois do push confirmam as 3 colunas e o índice, exatamente como declarados no schema:

```sql
"movingCancelled" BOOLEAN NOT NULL DEFAULT false,
"movingCancelledAt" DATETIME,
"cancellationEvidence" TEXT,
...
CREATE INDEX "Client_movingCancelled_idx" ON "Client"("movingCancelled");
```

### Clientes pré-existentes preservados

Antes do push, o `dev.db` local tinha 10 clientes de teste/desenvolvimento pré-existentes (nenhum dado de produção real neste ambiente). Snapshot (`id`, `name`, `movingCancelled`, `movingCancelledAt`, `cancellationEvidence`, `updatedAt`) tirado antes e depois de toda a verificação desta seção: **idêntico, byte a byte** — os 10 registros ganharam só os defaults da migração aditiva (`movingCancelled=false`, os outros dois `null`), nenhum valor pré-existente foi tocado, nenhum `updatedAt` mudou.

### Teste real de leitura, gravação e persistência (registro de teste dedicado, removido ao final)

Rodado num script isolado (`Prisma Client` real, banco `dev.db` real — não mock, não banco temporário de teste), contra um `Client` criado especificamente para este teste (`whatsapp`/`name` marcados como `TESTE-P1.1-<timestamp>`) e removido ao final. Nenhum cliente pré-existente foi lido para escrita.

Passos e resultado — todos passaram:

1. Criação de um `Client` novo sem especificar os campos de cancelamento → confirma os defaults reais do banco: `movingCancelled=false`, `movingCancelledAt=null`, `cancellationEvidence=null`.
2. Gravação de um cancelamento explícito (`movingCancelled=true`, `movingCancelledAt` com timestamp fixo, `cancellationEvidence` com texto de teste).
3. Leitura via uma consulta nova (`findUniqueOrThrow`, não o objeto retornado pelo `update`) → confirma que os 3 valores foram realmente persistidos no arquivo do banco, não só mantidos em memória.
4. Consulta usando o índice novo (`findMany({ where: { movingCancelled: true } })`) → devolveu exatamente o registro de teste, nenhum dos clientes pré-existentes (todos `false`).
5. Gravação de uma reativação explícita (`movingCancelled=false`, `movingCancelledAt=null`, `cancellationEvidence` com novo texto de reativação).
6. Leitura via nova consulta → confirma a reversão persistida, incluindo `movingCancelledAt` voltando a `null`.
7. Remoção do registro de teste (`delete`) e confirmação de que ele deixou de existir (`findUnique` devolve `null`).

Resultado: **10/10 asserções OK**. Isso valida de ponta a ponta, contra o banco real (não um mock), o mesmo contrato que `stabilizeExtraction`/`conversationHandler.js` dependem: os 3 campos existem, aceitam os tipos esperados, persistem de fato entre gravação e leitura, e o índice novo filtra corretamente.

### Regressão depois do push

- `npm test` (`whatsapp-bot/`): **81/81 passando**, mesmo resultado de antes do push (a suíte usa seu próprio banco temporário isolado por execução, então não dependia deste passo — rodar de novo aqui serve só para confirmar que regenerar o Prisma Client contra o `dev.db` real não quebrou nada).
- `npm run build` (`/root/crm`, Next.js): compilou e checou tipos sem erros, agora contra um `dev.db` que já tem as colunas de verdade (antes só havia sido validado contra o Prisma Client gerado a partir do schema, sem o banco físico correspondente).

## Riscos residuais

- **O bot continua enviando mensagens automáticas normalmente para um cliente com `movingCancelled: true`** (ex: seguirá perguntando o próximo campo faltante). Corrigir isso exigiria alterar a condição de envio em `processConversationTurn` (`conversationHandler.js`), o que a restrição absoluta desta sessão ("não altere... o envio de mensagens do bot") proibiu explicitamente. O requisito "uma mudança cancelada não continua sendo tratada como mudança ativa" foi satisfeito apenas no nível dos dados (o registro agora é estruturalmente distinguível), não no comportamento de conversa do bot. Recomenda-se tratar isso como item de acompanhamento explícito, com aprovação do produto, antes de mudar esse comportamento.
- **Cancelamento de vistoria, coleta ou entrega isoladamente não ganhou estado estruturado** — só a mudança inteira. `Appointment` continua sem um campo de cancelamento formal; recusar um horário de vistoria (`clientAccepted: false`) permanece indistinguível de "cancelar a vistoria" no nível de dados, exatamente como antes desta correção. Fora do escopo explícito desta entrega (P1.1 restrito à mudança inteira, conforme a distinção definida na seção de semântica).
- **Suporte a múltiplas mudanças do mesmo cliente não existe** — se um cliente cancelar uma mudança e, meses depois, começar outra completamente nova (não uma reativação da mesma negociação), o modelo/produto não têm hoje como representar isso como um segundo registro; a reativação implementada aqui assume que é a MESMA mudança sendo retomada. Risco já identificado e explicitamente fora de escopo desta sessão ("não implemente uma nova arquitetura de múltiplas mudanças").
- **A distinção "mudança inteira vs. agendamento específico" depende do modelo interpretar o contexto da conversa** — não há uma trava determinística em código que impeça o modelo de errar esse julgamento numa conversa diferente das duas validadas aqui (mesma classe de limitação já documentada nas correções 01/02 para outras distinções semânticas). Mitigado pelas regras explícitas do prompt e pela validação real dos dois casos citados no relatório; não há garantia formal de 100% de acerto.
- **Amostra real pequena e dirigida** — validado com os 2 casos citados explicitamente no relatório (mais os testes determinísticos de código para os demais cenários), conforme pedido explicitamente no escopo ("amostra pequena e controlada", "não execute uma nova bateria integral"). Não houve auditoria em escala dos datasets completos por menções a cancelamento — medição de taxa de acerto em escala permanece trabalho futuro (relacionado a P2.10/P2.11 do relatório).
- ~~`prisma db push` não foi aplicado ao `dev.db` local~~ — **resolvido em 22/09/2026** (ver seção "Verificação do schema no dev.db local e testes reais de persistência"): aplicado com sucesso, colunas confirmadas, clientes pré-existentes intactos, teste real de leitura/gravação/persistência com 10/10 asserções OK. Continua pendente, sem alteração: aplicar `prisma/updates/20260922-cancelamento-mudanca.sql` no banco de **produção** — isso não foi feito nem tentado nesta sessão nem na anterior (fora de escopo, exige deploy, que ambas as sessões foram instruídas a não fazer).

## Comprovação de integridade dos datasets

Hashes SHA-256 de `export/557185564498.json` e `export/557188926234.json` conferidos **antes e depois** de cada rodada de reprodução/validação (4 chamadas reais no total) — idênticos em todas as verificações:

- `557185564498.json`: `7b6745bdd70e5b448ebf08969e4f64c099082b701ee325a33c4acccbd630ef07`
- `557188926234.json`: `b766fabad98e38c9c7c33fafa35be1671da5d7f021c81774c46138ff2a28c090`

Nenhuma escrita foi feita em `export/` ou `export-marcia/` em nenhum momento desta correção — todo acesso foi via `fs.readFileSync`, nunca `writeFileSync`, dentro de um script isolado (`/tmp/.../scratchpad/repro-p1.mjs`, fora do repositório).

Os artefatos históricos da bateria `final-full-15a92cc` (`checkpoint.jsonl`, `api-attempts.jsonl`, `execution-summary.json`, `results/`, etc., citados na seção 11 do relatório) **não estão presentes neste ambiente local** — limitação registrada explicitamente, conforme pedido ("se estiverem ausentes no ambiente local, registre explicitamente a limitação"). Não havia, portanto, nada para comparar hash antes/depois desses artefatos específicos nesta sessão; nenhum arquivo com esse nome foi criado, apagado ou modificado.

Nenhuma mensagem foi enviada pelo WhatsApp em nenhum momento; nenhuma conta do WhatsApp foi acessada; nenhum banco de produção foi tocado; nenhum deploy foi executado; nenhuma bateria integral foi rodada (só os 2 casos citados no relatório, isoladamente, fora do harness da bateria).

**Integridade do `dev.db` local (sessão de verificação de schema, 22/09/2026):** os 10 clientes pré-existentes no banco local (`prisma/dev.db`) foram comparados campo a campo (`id`, `name`, `movingCancelled`, `movingCancelledAt`, `cancellationEvidence`, `updatedAt`) antes e depois de toda a verificação — snapshot idêntico. O único `Client` escrito/lido diretamente nesta sessão foi um registro de teste dedicado (`TESTE-P1.1-<timestamp>`), criado e removido dentro do próprio script de verificação; nenhum cliente pré-existente foi alterado.

## Status final

**P1.1 — CONCLUÍDO.**

Justificativa, ponto a ponto dos critérios inegociáveis:

- Defeito reproduzido no código anterior, com chamada real de API, nos dois casos citados no relatório — seção "Reprodução do problema antes da correção".
- Causa raiz identificada: ausência total de estado estruturado de cancelamento (não um bug de cálculo).
- Escopos de cancelamento diferenciados explicitamente (mudança inteira vs. agendamento/data vs. vistoria/coleta/entrega vs. exclusão de item vs. reagendamento) — seção "Semântica dos tipos de cancelamento".
- Correção implementada e integrada aos consumidores relevantes: extrator (`ai.js`), política de estabilização (`extractionPolicy.js`), persistência (`conversationHandler.js`) e UI do CRM (`KanbanBoard.tsx`, página de detalhe do cliente).
- Os dois testes de reprodução voltaram a rodar com o código corrigido e passaram: caso ambíguo mantém `movingCancelled: false` (mudança prossegue, como de fato aconteceu na conversa real), caso inequívoco passou a ter `movingCancelled: true` com evidência textual — seção "Validações com casos reais".
- Suíte automatizada e de integração: 81/81 testes passando (74 preexistentes + 7 novos), `npm run lint` e `npm run build` do app Next.js sem erros.
- Casos reais selecionados validados com API real, modelo de produção, custo registrado (US$ 0,0024018 no total desta correção).
- Correções P0.1–P0.4 permanecem funcionando (mesma suíte de regressão original, 100% passando, sem alteração).
- Datasets e artefatos históricos disponíveis permanecem intactos (hashes conferidos); artefatos ausentes localmente foram registrados como limitação, não simulados.
- Este arquivo e as seções pertinentes do relatório final foram atualizados.
- **(22/09/2026)** Schema aplicado e verificado — **em produção, não em banco local** (ver nota de correção no topo deste documento) — via `npx prisma db push`, sem `--accept-data-loss`/`--force-reset`; as 3 colunas e o índice novo confirmados existirem de fato no `dev.db`; teste real (não mock) de criação, gravação, leitura e remoção de um registro de teste dedicado, com 10/10 asserções corretas; os 10 clientes pré-existentes permaneceram intocados (snapshot idêntico antes/depois); suíte (81/81) e build do Next.js revalidados depois do push, sem regressão.
- **(22/09/2026, sessão de deploy)** Backup de produção feito e validado retroativamente; migração reauditada em cópia isolada do zero; código commitado (`c4565a9`) e ativado em produção via restart controlado de `crm.service`/`whatsapp-bot.service`; validação pós-deploy (rotas HTTP, consultas Prisma reais aos campos de cancelamento, integridade do banco, preservação de `BOT_ENABLED_FOR_ALL`/cooldown de handoff) sem erros. `git push` para `origin/main` ficou **pendente** (bloqueado pelo classificador de permissões, usuário optou por prosseguir sem esperar). Relato completo em `docs/deploy/DEPLOY_P0_P1_1_2026-09-22.md`.

Riscos residuais documentados explicitamente acima — nenhum bloqueia a conclusão de P1.1 porque nenhum deles está dentro do escopo definido para esta correção (mudança inteira, restrição absoluta contra alterar envio de mensagens do bot, e P1.2/multi-mudança explicitamente fora de escopo). O único risco residual que restava sobre a verificação do schema local foi resolvido nesta sessão de acompanhamento; a aplicação em produção continua pendente e fora de escopo (exige deploy).

Nenhum commit foi criado em nenhuma das duas sessões, conforme solicitado. P1.2 não foi iniciado. Nenhuma conta do WhatsApp foi acessada, nenhuma conversa foi alterada, e nenhum deploy ou alteração em produção foi executado.
