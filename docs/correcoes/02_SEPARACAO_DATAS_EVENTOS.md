# Correção 02 — Separação entre data da mudança, vistoria, coleta e entrega

Data: 22/09/2026. Escopo: exclusivamente o item **P0.2** do relatório final da bateria canônica (`docs/relatorios/FINAL-REPORT-bateria-canonica-final-full-15a92cc.md`). Esta correção é **posterior** à execução canônica `final-full-15a92cc` e não alterou nenhum artefato, hash, checkpoint, log ou dataset daquela execução.

## Problema identificado

`extractMovingDate` podia confundir a data de **outro evento da conversa** — vistoria, coleta ou entrega — com a data da **mudança em si**, preenchendo `movingDate` com uma data que na verdade respondia a uma pergunta sobre agendamento de vistoria (ou similar).

Isso é diferente do problema já corrigido no item P0.1 (`docs/correcoes/01_DATAS_RELATIVAS_HISTORICAS.md`): P0.1 tratou a **referência temporal** usada para calcular datas relativas ("amanhã", "sexta"); P0.2 trata a **atribuição semântica** de qual evento uma data pertence, independentemente de a referência temporal estar correta.

## Causa raiz

`MOVING_DATE_SIGNALS_SYSTEM_PROMPT` (`whatsapp-bot/src/ai.js`) instruía o modelo a extrair sinais de data "da parte mais recente da conversa sobre quando vai ser a mudança", mas não pedia ao modelo para verificar **a qual evento** a pergunta/resposta mais recente sobre data realmente se referia. Como `extractMovingDate` só recebe as últimas 12 mensagens da conversa (`messages.slice(-12)`, decisão de custo/latência pré-existente, não alterada aqui), quando esse trecho contém uma negociação de vistoria (ex: "a senhora prefere receber nosso vistoriador pela manhã ou à tarde?" → "Amanhã à tarde.") o modelo extraía sinais de data válidos (`relativeDays=1`) sem qualquer sinalização de que pertenciam à vistoria, e o código resolvia e devolvia essa data como se fosse a da mudança.

Não havia, em nenhum ponto do pipeline (prompt, schema de resposta estruturada, ou `resolveMovingDate`), um campo ou verificação que distinguisse os quatro eventos possíveis (mudança, vistoria, coleta, entrega).

## Evidência da reprodução (código anterior à correção, chamada real de API)

Reproduzido com o histórico real de `export/557188435065.json` (hash `sha256:d8d5cbc203e729a17cd6a5e59455cb5c8918d8d178ea45ff7b5fd99ff088479f`, arquivo **não modificado** — usado exclusivamente em modo de leitura), reconstruindo exatamente o turno da bateria canônica (`groupIntoTurns`) em que a cliente responde "Amanhã à tarde." a uma pergunta da Empresa sobre agendamento de **vistoria presencial**:

- turno reproduzido: 10 mensagens consecutivas do cliente, terminando em "Referência: Ao lado do Centro Social Urbano da Liberdade...";
- mensagem imediatamente anterior da Empresa: "Senhora Leila, já conectei você à nossa equipe. Um atendente falará com a senhora em breve para confirmar o endereço e **agendar a sua vistoria**!";
- `referenceDate` usado: `2026-08-13T23:15:55.000Z` (timestamp da última mensagem do cliente no turno — mesmo mecanismo já corrigido pelo P0.1, aqui usado corretamente);
- **código anterior a esta correção, API real (`gpt-4o-mini-2024-07-18`): `extractMovingDate` devolveu `movingDate = "2026-08-14"`.** Resultado incorreto: não existe, nesse trecho, nenhuma data de mudança — a única data mencionada é sobre a vistoria.
- Esse mesmo resultado (`2026-08-14`, correto apenas temporalmente) já havia sido produzido durante a própria validação real da correção P0.1 (ver `docs/correcoes/01_DATAS_RELATIVAS_HISTORICAS.md`, tabela da seção "Evidência da correção" — resultado marcado ali como "correto temporalmente", não como semanticamente correto), confirmando que corrigir só o relógio (P0.1) não resolve esta confusão de evento.
- a chamada foi repetida uma segunda vez, de forma independente, com o mesmo resultado determinístico (`temperature=0`), confirmando que não foi um efeito aleatório de uma única amostragem do modelo.

Isso comprova que o defeito **continuava presente no código atual (pós-P0.1)** antes desta correção — não é apenas uma característica do JSON histórico da bateria original, mas um comportamento reproduzível do extrator com o código e a API reais.

## Arquivos modificados

- `whatsapp-bot/src/ai.js` — `MOVING_DATE_SIGNALS_SYSTEM_PROMPT` reescrito para instruir a distinção explícita entre os quatro eventos (mudança, vistoria, coleta, entrega) e as regras de desambiguação (pergunta/contexto imediatamente anterior, múltiplos eventos na mesma mensagem, ambiguidade genuína); schema JSON da resposta estruturada (`moving_date_signals`) ganhou o campo `event` (enum `"mudança" | "vistoria" | "coleta" | "entrega" | null`, obrigatório); `extractMovingDate` passou a só chamar `resolveMovingDate` quando `!signals.vague && signals.event === "mudança"` — defesa determinística em código, independente de o prompt funcionar perfeitamente.
- `whatsapp-bot/test/historicalRelativeDates.test.js` — mocks de `moving_date_signals` atualizados para incluir `event: "mudança"` (schema mudou; os testes continuam validando exclusivamente a resolução de data já coberta pela correção P0.1, sem alterar seu propósito original).
- `whatsapp-bot/test/handoff.test.js` — idem, dois mocks de `moving_date_signals` que esperam um `movingDate` não nulo precisaram do campo `event: "mudança"` pelo mesmo motivo.
- `whatsapp-bot/test/support/mockOpenAi.js` — resposta padrão do mock de `moving_date_signals` passou a incluir `event: null`, coerente com o novo schema (não altera nenhum comportamento de teste existente, já que a resposta padrão continuava com `vague: true`).
- `whatsapp-bot/test/movingDateEventSeparation.test.js` (novo) — suíte de regressão permanente para esta correção.
- `docs/correcoes/02_SEPARACAO_DATAS_EVENTOS.md` (este arquivo).
- `docs/relatorios/FINAL-REPORT-bateria-canonica-final-full-15a92cc.md` — seções 1, 6.1 e 10 (item P0.2) atualizadas para refletir a correção, preservando integralmente números, hashes e evidências históricas da execução canônica.

Nenhum arquivo de `whatsapp-bot/src/conversationHandler.js`, `whatsapp-bot/src/extractionPolicy.js`, `prisma/schema.prisma` ou dos consumidores de `movingDate` no app do CRM (`src/app/**`, `src/components/**`, `src/lib/dashboard.ts`) precisou ser alterado: `movingDate` continua sendo o único campo persistido para a data da mudança, com o mesmo formato (`YYYY-MM-DD` resolvido em `extractMovingDate`, convertido para `Date` em `conversationHandler.js`) e a mesma política de nunca sobrescrever um valor existente com `null`. A correção age inteiramente **antes** desse ponto, na função que decide se existe ou não uma data de mudança válida para propor.

### Por que não foram criados novos campos (vistoriaDate, coletaDate, entregaDate)

O schema do `Client` (`prisma/schema.prisma`) não tem, e não precisou ganhar, campos de data para vistoria/coleta/entrega:

- a data da **vistoria** já é tratada por um mecanismo próprio e completo, independente de `extractMovingDate` — o modelo `Appointment` (`type: "VISTORIA"`) e o fluxo de proposta/confirmação em `classifyVistoriaResponse`/`handleVistoriaResponse` (`conversationHandler.js`). Esse fluxo nunca consultou nem gravou `movingDate`; o defeito de P0.2 era unidirecional (vistoria contaminando mudança), nunca o contrário.
- não existe hoje, em nenhum lugar do produto (schema, prompt de coleta de itens, UI do CRM), um conceito estruturado de "coleta" ou "entrega" como eventos com data própria — são mencionados no relatório como possibilidades textuais, não como campos ou fluxos existentes.

Introduzir `coletaDate`/`entregaDate` no `Client` sem nenhum consumidor (UI, relatório, fluxo) capaz de usá-los violaria a restrição de não adicionar campos que o resto do sistema não consegue consumir. Em vez disso, o novo campo `event` dos sinais brutos de `extractMovingDate` é **inteiramente interno** a essa função — nunca é persistido nem exposto fora de `src/ai.js` — e já é suficiente para impedir a contaminação de `movingDate`, que era o único sintoma relatado e o único campo afetado. Se um dia o produto precisar de fato representar coleta/entrega como eventos próprios do CRM, esse desenho de schema/consumidor é trabalho novo, não uma extensão natural desta correção pontual.

## Solução implementada

1. O prompt agora define explicitamente os quatro eventos possíveis e como reconhecê-los pelo contexto (a pergunta/assunto imediatamente anterior da Empresa), com regras específicas para:
   - responder um evento não-mudança nunca preenche sinais de mudança, mesmo que a resposta seja só "amanhã";
   - mensagens com mais de um evento: extrair sinais somente da data ligada à mudança, ignorando as demais;
   - ausência de qualquer data de mudança no trecho (só vistoria/coleta/entrega): todos os sinais ficam `null` e `vague=true` — resultado válido, não uma falha;
   - dúvida genuína sobre o evento: nunca associar à mudança por padrão.
2. O schema de resposta estruturada ganhou o campo obrigatório `event`.
3. `extractMovingDate` só chama `resolveMovingDate` (o cálculo determinístico de data, inalterado desde P0.1) quando `event === "mudança"` e `vague === false`. Isso funciona como **defesa em profundidade**: mesmo que o modelo eventualmente preencha campos de data por engano num evento errado, o gate em código barra o resultado antes de chegar em `movingDate`.

Nenhuma parte da correção P0.1 foi tocada: `referenceDate`, o uso do timestamp da mensagem mais recente do cliente, e `resolveMovingDate` permanecem exatamente como estavam.

## Testes de regressão e integração

### Reprodução do defeito (antes/depois)

| | Antes desta correção | Depois desta correção |
|---|---|---|
| `export/557188435065.json`, turno de "Amanhã à tarde." (resposta sobre vistoria) | `movingDate = "2026-08-14"` (API real) | `movingDate = null` (API real) |
| Sinal bruto devolvido pelo modelo para o mesmo trecho | sem campo `event` (schema anterior não tinha) | `event: "vistoria"`, `weekdayName: "sexta-feira"`, `relativeDays: 1` |

### Suíte permanente (mock determinístico, sem API real — `npm test` em `whatsapp-bot/`)

Novo arquivo `test/movingDateEventSeparation.test.js`, cobrindo:

- data explícita de mudança (`event="mudança"`, dia+mês) é extraída normalmente;
- data relativa de mudança (`event="mudança"`, `relativeDays`) é extraída normalmente;
- data de **vistoria**, **coleta** e **entrega** (`event` correspondente) nunca preenchem `movingDate`, mesmo com todos os sinais de data preenchidos como se fossem uma data real;
- `event=null` (nenhum evento identificado) não preenche `movingDate` mesmo com sinais de data presentes — defesa contra ambiguidade;
- mensagem com dois eventos na mesma fala: sinais já isolados para "mudança" pelo modelo são respeitados e resolvidos corretamente;
- mensagem ambígua (`vague=true`) barra o preenchimento mesmo com `event="mudança"`;
- histórico longo (20+ mensagens antigas antes da mensagem relevante): a janela de 12 mensagens continua funcionando e uma data de mudança recente é extraída normalmente;
- teste de integração ponta a ponta via `processConversationTurn`/`createConversationHandler` (sem WhatsApp real, sem banco de produção — `fakeWaClient` e banco SQLite de teste isolado, como o resto da suíte): turno 1 (resposta sobre vistoria) não altera `movingDate`; turno 2 (data real da mudança) preenche `movingDate`; turno 3 (correção da data pelo cliente) substitui pelo novo valor.

Resultado: **10/10 testes novos passaram.**

### Suíte completa do bot

`npm test` em `whatsapp-bot/`: **33/33 testes passaram** (23 pré-existentes, incluindo os 2 de `historicalRelativeDates.test.js` da correção P0.1, + 10 novos desta correção). Nenhum teste pré-existente foi removido ou teve sua asserção de resultado alterada — os 4 mocks ajustados (`historicalRelativeDates.test.js` ×2, `handoff.test.js` ×2) só ganharam o novo campo `event: "mudança"` obrigatório pelo schema, sem mudar o que estava sendo validado.

Nota de ambiente: antes de rodar a suíte pela primeira vez nesta sessão, `npx prisma generate` (raiz do repo) precisou ser executado porque o cliente Prisma gerado localmente estava dessincronizado do `schema.prisma` (faltava `commercialNotes`, campo de uma migração anterior não relacionada a esta correção). É regeneração determinística a partir do schema já commitado — não altera dados, schema, nem é um deploy; sem ela, 13/23 testes pré-existentes já falhavam antes de qualquer mudança desta correção (confirmado revertendo temporariamente as alterações e rodando a suíte na baseline).

### Verificação de sintaxe, lint e build

- `node --check` em todos os arquivos `.js` alterados/criados: sem erro.
- `npm run lint` (raiz): sem avisos ou erros.
- `npm run build` (raiz, Next.js): concluído com sucesso, incluindo checagem de tipos.

### Validação de integração com casos reais dos datasets (leitura apenas)

- `export/557188435065.json`: caso citado no relatório, reproduzido e revalidado com API real (ver tabela acima) — leitura apenas, nenhuma escrita no dataset.
- Confirmado, via `git status` e comparação de timestamp de modificação dos arquivos, que nenhum arquivo de `export/` ou `export-marcia/` foi alterado durante esta correção.

### Amostra pequena e controlada de chamadas reais (API de produção)

Modelo efetivo em todas as chamadas: `gpt-4o-mini-2024-07-18` (`temperature=0`, mesmo `response_format` estruturado usado em produção).

Chamadas realizadas nesta correção, todas fora da bateria canônica, sem executar o bot de produção nem enviar mensagem real:

| Caso | Chamadas | Resultado |
|---|---:|---|
| Reprodução do defeito antes da correção (`557188435065.json`) | 2 | `movingDate = "2026-08-14"` nas duas (determinístico) |
| Confirmação da correção no mesmo caso | 1 | `movingDate = null` |
| Amostra instrumentada pós-correção (3 casos, usage medido) | 3 | ver tabela abaixo |
| **Total** | **6** | |

Amostra instrumentada (usage lido diretamente da resposta da API):

| Caso | `event` devolvido | `movingDate` resolvido | prompt tokens | completion tokens |
|---|---|---|---:|---:|
| `557188435065.json` — vistoria | `"vistoria"` | `null` (correto) | 1.905 | 42 |
| Data de mudança explícita genuína ("dia 20 de outubro") | `"mudança"` | `2026-10-20` (correto — regressão) | 1.697 | 42 |
| Mensagem com dois eventos ("vistoria amanhã, mudança dia 20 de outubro") | `"mudança"` | `2026-10-20` (correto — ignora a data da vistoria) | 1.714 | 42 |
| **Subtotal medido** | | | **5.316** | **126** |

Custo estimado do subtotal medido (mesmo método do relatório canônico e da correção 01 — preço por token de `gpt-4o-mini`, sem desconto de cache): **US$ 0,000873** (5.442 tokens totais).

As outras 3 chamadas (reprodução antes/depois, tabela de cima) usaram o mesmo trecho de conversa do primeiro caso da amostra instrumentada (1.905 prompt + 42 completion tokens cada, ~1.947 tokens); não tiveram o `usage` capturado separadamente, mas por serem exatamente a mesma entrada com `temperature=0`, o consumo é equivalente. Custo estimado dessas 3: ~US$ 0,00093.

**Total estimado desta correção: 6 chamadas reais, ~11.283 tokens, custo estimado ~US$ 0,0018** — nenhuma bateria integral foi executada.

## Regressões verificadas nos consumidores

- `conversationHandler.js`: `movingDate` continua sendo lido de `extractMovingDate` e aplicado com a mesma regra de nunca substituir por `null` — comportamento coberto pelo teste de integração novo (turno de vistoria não apaga nem altera o valor anterior).
- `extractionPolicy.js` (`stabilizeExtraction`): não lê nem escreve `movingDate`; não há regressão possível ali.
- Consumidores de UI do CRM (`src/app/(app)/clientes/**`, `src/app/(app)/mudancas/page.tsx`, `src/components/client/EditableInfo.tsx`, `src/components/funil/KanbanBoard.tsx`, `src/lib/dashboard.ts`): todos leem `Client.movingDate` como `DateTime?` sem mudança de tipo, formato ou semântica — build e lint da raiz (que compilam essas páginas) concluídos sem erro.
- Bateria canônica `final-full-15a92cc` (`whatsapp-bot/test/battery/`): não foi executada nem seus artefatos foram lidos para gravação; hashes e resultados históricos permanecem exatamente como estavam.

## Riscos residuais

- A separação de evento depende do modelo interpretar corretamente o contexto da conversa dentro da janela de 12 mensagens (`messages.slice(-12)`, decisão pré-existente e fora do escopo desta correção). Se a pergunta que originou a data de vistoria/coleta/entrega estiver fora dessa janela (conversa muito longa com muitas mensagens entre a pergunta e a resposta), o modelo pode não ter contexto suficiente — nesse caso o prompt instrui a tratar como ambíguo (`event=null`, sem preencher mudança), o que é seguro (evita contaminação) mas pode custar um falso negativo (uma data de mudança genuína deixar de ser capturada se o contexto que a qualifica como "mudança" ficou fora da janela). Esse é um risco pré-existente da arquitetura de janela fixa, apenas herdado por esta correção, não introduzido por ela.
- A defesa depende, em primeira instância, do modelo classificar `event` corretamente; a defesa em profundidade em código só cobre o caso em que o modelo classifica errado o campo `event` mas mesmo assim preenche os demais sinais — ela não cobre o caso (não observado nos testes) de o modelo classificar `event="mudança"` por engano para uma data que na verdade é de outro evento. Mitigado pelas regras explícitas de desambiguação no prompt e pela amostra real validada, mas não há garantia formal de 100% de acerto do modelo.
- Não foi feita uma auditoria exaustiva de todas as 210+17 conversas dos datasets que mencionam "vistoria", "coleta" ou "entrega" — a amostra real foi pequena e dirigida ao caso citado no relatório mais dois casos sintéticos de regressão, conforme pedido explicitamente ("amostra pequena e controlada", "não execute uma nova bateria integral"). Uma medição de taxa de acerto em escala permanece como trabalho futuro (relacionado ao item P2.10/P2.11 do relatório, fora deste escopo).
- "Coleta" e "entrega" como eventos existem apenas na instrução do prompt (para desambiguação); o produto não tem, hoje, nenhum fluxo que pergunte ativamente sobre esses eventos — a cobertura de teste para eles é baseada em como o modelo deve reagir SE esses eventos aparecerem espontaneamente na conversa, já que não há como validar com uma chamada real um fluxo que o produto não inicia.

## Confirmação de integridade dos datasets e artefatos originais

- `export/` e `export-marcia/`: usados exclusivamente em modo de leitura (`fs.readFileSync`) em todos os scripts de reprodução e validação desta correção; nenhuma escrita, renomeação ou remoção. Verificado por `git status` (datasets não versionados, sem diffs aplicáveis) e por timestamp de modificação dos arquivos (nenhum arquivo de `export/` ou `export-marcia/` foi modificado durante esta sessão de trabalho — a última modificação de `export/557188435065.json` é de 17/09/2026, anterior ao início desta correção).
- Artefatos da bateria canônica `final-full-15a92cc` (checkpoint, logs, resultados, hashes): não lidos nem escritos por nenhum script desta correção; a bateria não foi executada.
- Nenhuma mensagem foi enviada pelo WhatsApp; `fakeWaClient` (usado nos testes) nunca se conecta a uma sessão real.
- Nenhum deploy ou reinício de serviço de produção foi executado. `npm run build` foi executado apenas como verificação de compilação (mesma prática já usada na correção P0.1), nunca `npm run deploy`.

## Status final

**STATUS: CONCLUÍDO E CONFIRMADO POR TESTES.**

Todos os critérios de conclusão foram atendidos:

- o defeito foi reproduzido no código anterior à correção, com chamada real de API, usando uma conversa real do dataset (`export/557188435065.json`) em modo de leitura;
- a causa raiz foi identificada (ausência de classificação de evento na extração de sinais de data);
- a correção foi implementada (`whatsapp-bot/src/ai.js`: prompt + schema + gate determinístico em código);
- o teste de reprodução passou depois da correção (mesmo caso real, `movingDate` passou de `"2026-08-14"` para `null`);
- os testes existentes (33/33, incluindo os 2 de P0.1) e os novos testes relevantes (10/10) passaram;
- houve validação de integração com um caso real do dataset e uma amostra pequena e controlada de chamadas reais adicionais (6 chamadas, ~11.283 tokens, ~US$ 0,0018);
- o relatório final (seções 1, 6.1 e 10/P0.2) e este arquivo de correção foram atualizados;
- nenhuma conversa do WhatsApp, dataset ou artefato histórico da bateria canônica foi alterado.
