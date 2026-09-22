# Relatório final — bateria canônica completa de extração CRM

Data de encerramento: 19/09/2026  
Execução: `final-full-15a92cc`  
Commit avaliado: `15a92cc5478a61204f6066ca2294b9d26cd1976c`  
Fingerprint: `4d2035ce37fb00dde744ffd0ff06c0dd80b460837ac079d79620f1f6f0d5ea89`

## 1. Resumo executivo

A bateria canônica terminou funcionalmente: foram consolidados **6.847/6.847 turnos**, correspondentes a **13.694/13.694 chamadas canônicas**, em **885/885 conversas com conteúdo**. Os 885 arquivos de resultado estão completos e todos os 13.694 `cacheKey` referenciados por eles apontam para registros de sucesso no checkpoint. As 379 conversas vazias foram registradas separadamente e não geraram chamadas.

O custo acumulado oficial, incluindo a execução anterior incorporada pelo harness, foi **US$ 3,9394467**, abaixo do teto de US$ 7,50. A execução atual registrou 13.395 tentativas HTTP: 12.197 respostas 200 e 1.198 respostas 429. Somados os logs incorporados da execução anterior, foram 16.875 tentativas preservadas, com 14.267 respostas 200 e 2.608 respostas 429.

Não há evidência de chamada em voo ou resultado pendente. A última tentativa terminou em HTTP 200 às `2026-09-19T16:59:30.879Z`; os artefatos ficaram sem alteração por aproximadamente uma hora antes da verificação final. O processo continuava vivo apenas por um defeito no laço de workers ociosos do harness. Após confirmar a completude dos resultados e a ausência de atividade, ele foi encerrado com `Ctrl-C`. Nenhum artefato foi perdido ou reescrito. **Nota adicionada em 22/09/2026:** esse defeito de encerramento (item P0.3) foi corrigido posteriormente a esta execução — ver seção 7.1 e `docs/correcoes/03_TRAVAMENTO_WORKERS_OCIOSOS.md`. A correção é posterior à execução canônica `final-full-15a92cc`; nada nesta seção foi reescrito para sugerir que o processo original encerrou normalmente — ele precisou de `Ctrl-C`, exatamente como descrito acima. **Nota adicionada em 22/09/2026 (item P0.4):** a conclusão desta execução foi estabelecida por confirmação manual (completude dos resultados + ausência de atividade por cerca de uma hora), precisamente porque não existia, na época, nenhum marcador final atômico e verificável. Esse marcador foi implementado posteriormente — ver seção 3.3 e `docs/correcoes/04_MARCADOR_FINAL_ATOMICO.md`. Ele não gera, e não poderia gerar retroativamente, um atestado de conclusão para `final-full-15a92cc`; a conclusão desta execução continua sendo a confirmação manual descrita acima.

O resultado estrutural é forte, mas **não equivale a acurácia semântica**. A leitura dirigida dos artefatos encontrou problemas reais: datas relativas históricas resolvidas contra o relógio da reprodução (já corrigido — ver seção 6.1), campos preenchidos sem suporte textual suficiente, confusão entre data de vistoria/coleta/entrega e data da mudança (já corrigido — ver seção 6.1 e `docs/correcoes/02_SEPARACAO_DATAS_EVENTOS.md`), e cancelamentos sem representação estruturada (**cancelamento da mudança inteira já corrigido — ver seção 6.5 e `docs/correcoes/05_CANCELAMENTOS_ESTRUTURADOS.md`**). A política de estabilização eliminou perda sintática de valores conhecidos — houve zero transição de valor não nulo para `null` —, mas isso também pode conservar informação obsoleta quando há exclusão ou cancelamento (**a preservação contra `null` foi revisada para não bloquear um cancelamento explícito — ver `docs/correcoes/05_CANCELAMENTOS_ESTRUTURADOS.md`; exclusão de item continua pendente, item P1.2**). **Nota adicionada em 22/09/2026 (item P1.1):** a correção de cancelamentos é posterior à execução canônica `final-full-15a92cc`; nada nesta seção foi reescrito para sugerir que os artefatos ou resultados originais daquela execução mudaram — eles permanecem exatamente como consolidados, hashes intactos.

Nenhuma correção foi aplicada ao produto, ao harness, aos datasets ou aos artefatos da execução durante esta consolidação.

## 2. Escopo e metodologia

O harness reproduziu o histórico completo de cada conversa em ordem estrita de turnos. Em cada turno, `extractClientInfo` e `extractMovingDate` receberam o mesmo snapshot e foram iniciados em paralelo; o estado só foi consolidado após ambas terminarem. Não houve geração de resposta do bot, acesso ao banco de produção, envio de WhatsApp ou deploy.

Configuração preservada em `execution-config.json`:

- modelo lógico: `gpt-4o-mini`;
- modelo observado nas respostas: `gpt-4o-mini-2024-07-18`;
- temperatura: `0`;
- teto de custo: US$ 7,50;
- datasets: `export/` e `export-marcia/`;
- código relevante: `src/ai.js`, `src/apiRetry.js` e `src/extractionPolicy.js`.

Dimensão final:

| Dataset | Arquivos | Conversas com conteúdo | Vazias | Mensagens | Turnos |
|---|---:|---:|---:|---:|---:|
| `export` | 383 | 356 | 27 | 12.587 | 6.305 |
| `export-marcia` | 881 | 529 | 352 | 553 | 542 |
| **Total** | **1.264** | **885** | **379** | **13.140** | **6.847** |

O dataset `export-marcia` é dominado por conversas de uma mensagem e inclui mensagens avulsas que não são necessariamente atendimento de mudança. Isso limita comparações de qualidade conversacional e aumenta a importância de detectar conteúdo fora de escopo.

## 3. Integridade e completude final

### 3.1 Resultados

- 885 arquivos JSON válidos em `results/`;
- 885 com `complete: true`;
- 6.847 turnos de origem;
- 6.847 turnos processados;
- zero conversa parcial;
- 13.694 referências canônicas (`extractionCacheKey` + `dateCacheKey`);
- zero referência ausente no estado efetivo do checkpoint;
- 379 conversas vazias válidas em `empty-conversations.json`.

Distribuição:

| Dataset | Resultados completos | Turnos processados |
|---|---:|---:|
| `export` | 356/356 | 6.305/6.305 |
| `export-marcia` | 529/529 | 542/542 |
| **Total** | **885/885** | **6.847/6.847** |

### 3.2 Checkpoint

O `checkpoint.jsonl` contém:

- 13.855 linhas JSON válidas;
- zero linha malformada;
- 13.759 chaves únicas no estado mais recente;
- 13.736 sucessos efetivos;
- 23 erros históricos efetivos, todos fora das 13.694 referências canônicas finais;
- 96 linhas duplicadas por regravação/retry da mesma chave;
- 13.694 sucessos canônicos + 42 sucessos intermediários adicionais preservados;
- 1.539 sucessos importados/reutilizados por chave compatível;
- 6.912 chaves de `extractClientInfo` e 6.847 de `extractMovingDate`. A diferença de 65 em extração inclui os 42 sucessos adicionais e 23 erros históricos não canônicos.

Fisicamente existem 119 registros de erro no JSONL; 96 foram depois substituídos por sucesso para a mesma chave. Por isso, 119 não deve ser interpretado como falhas pendentes.

### 3.3 Logs e summary

O `api-attempts.jsonl` final contém 13.395 linhas JSON válidas e zero linha malformada:

| Status | Quantidade |
|---|---:|
| HTTP 200 | 12.197 |
| HTTP 429 | 1.198 |
| Outros | 0 |

As últimas 200 tentativas foram todas HTTP 200. A última tentativa registrada tem resposta completa, e não houve escrita posterior.

O `execution-summary.json` é JSON válido e seus totais batem com a agregação do log final. Ele não contém `completedConversations`, `scheduledConversations` e `stoppedByCost`, porque o processo ficou preso antes do `finally` que acrescentaria esses campos. A ausência desses campos é um defeito de encerramento do harness, não evidência de trabalho faltante: completude e referencialidade foram comprovadas diretamente pelos 885 resultados e pelo checkpoint.

**Nota adicionada em 22/09/2026 (item P0.4):** a limitação descrita acima — depender de confirmação manual porque o summary não recebeu os campos finais e não existia nenhum artefato de conclusão verificada — foi corrigida posteriormente a esta execução com a introdução de um marcador final atômico (`completion-marker.json`), publicado por `whatsapp-bot/test/battery/finalizationMarker.js` somente depois que workers, resultados, checkpoint, summary e proxy são todos validados de forma cruzada nessa mesma execução. Essa correção é posterior à execução canônica `final-full-15a92cc` e não gera, retroativamente, um marcador para ela: os artefatos originais desta execução não foram alterados, e a ausência de `completedConversations`/`scheduledConversations`/`stoppedByCost` no `execution-summary.json` desta execução permanece registrada como está, sem edição. Detalhes, evidências e riscos residuais em `docs/correcoes/04_MARCADOR_FINAL_ATOMICO.md`.

### 3.4 Ausência de chamadas em voo

A conclusão de que não restou chamada em voo se apoia em quatro evidências combinadas:

1. todos os 13.694 `cacheKey` canônicos possuem sucesso efetivo;
2. todos os 885 resultados estão completos;
3. o último evento HTTP é uma resposta 200, não um request parcialmente registrado;
4. checkpoint, log e summary permaneceram inalterados por cerca de uma hora antes da interrupção segura.

Depois da interrupção, a sessão do processo terminou com saída causada pelo `Ctrl-C`. Nenhuma chamada nova foi feita e nenhum arquivo da execução foi alterado manualmente.

## 4. Métricas finais

### 4.1 Execução `final-full`

| Métrica | Valor |
|---|---:|
| Prompt tokens | 27.857.396 |
| Prompt tokens em cache | 20.144.640 |
| Prompt tokens sem cache | 7.712.756 |
| Completion tokens | 1.288.882 |
| Tentativas HTTP | 13.395 |
| HTTP 200 | 12.197 |
| HTTP 429 | 1.198 |
| `logicalCalls` de sucesso | 13.736 |
| Erros lógicos efetivos históricos | 23 |
| Sucessos importados | 1.539 |
| `retries` do summary | 1.175 |
| Custo incremental desta execução | US$ 3,4410906 |

O campo `retries` não mede retries puros da API. O harness o calcula como `httpAttempts - registros locais tentados`, o que mistura retries, retomadas, importações e registros históricos. Deve ser usado apenas como métrica operacional do harness.

### 4.2 Execução anterior incorporada

O custo incorporado oficialmente pelo `final-full` é:

| Métrica | Valor incorporado |
|---|---:|
| Prompt tokens | 3.970.202 |
| Prompt tokens em cache | 2.615.680 |
| Prompt tokens sem cache | 1.354.522 |
| Completion tokens | 165.003 |
| Tentativas HTTP preservadas | 3.480 |
| HTTP 200 | 2.070 |
| HTTP 429 | 1.410 |
| Custo | US$ 0,4983561 |

Há uma inconsistência histórica: o `execution-summary.json` do diretório anterior registra 3.543 tentativas, 1.407 erros API e custo de US$ 0,51258345, enquanto o log atualmente preservado contém 3.480 linhas, das quais 1.410 são 429. O `final-full` recalculou e incorporou o custo a partir do log preservado, resultando em US$ 0,4983561. O relatório usa o valor efetivamente incorporado pela execução canônica e registra a divergência como incidente de rastreabilidade do harness.

### 4.3 Total acumulado oficial

| Métrica | Total |
|---|---:|
| Prompt tokens | 31.827.598 |
| Prompt tokens em cache | 22.760.320 |
| Prompt tokens sem cache | 9.067.278 |
| Completion tokens | 1.453.885 |
| Tentativas HTTP preservadas | 16.875 |
| HTTP 200 | 14.267 |
| HTTP 429 | 2.608 |
| Custo total | **US$ 3,9394467** |
| Teto | US$ 7,50 |
| Margem restante | US$ 3,5605533 |

O custo é uma estimativa determinística baseada nos tokens registrados e nos preços salvos em `execution-config.json`; não é uma consulta à fatura.

### 4.4 Limiter e concorrência na retomada final

- concorrência inicial e final: 1 conversa;
- máximo configurável: 10;
- máximo observado em voo: 2 requests, correspondentes às duas extrações paralelas do mesmo turno;
- TPM máximo observado: 123.026;
- RPM máximo observado: 47;
- alvo TPM: 140.000;
- alvo RPM: 350;
- nenhum 429 nas últimas 200 tentativas.

## 5. Cobertura dos estados finais

Preenchimento não é sinônimo de acurácia, mas ajuda a caracterizar o resultado:

| Campo | `export` (356) | `export-marcia` (529) |
|---|---:|---:|
| Nome | 92 | 3 |
| Apelido | 54 | 1 |
| Origem | 260 | 29 |
| Destino | 260 | 25 |
| Tipo de imóvel | 76 | 3 |
| Observações da mudança | 239 | 35 |
| Condições comerciais | 128 | 27 |
| Vistoria escolhida | 100 | 9 |
| Data da mudança | 130 | 35 |

`stairsOrElevator` e `truckAccess` aparecem nos 885 estados finais porque a política normaliza ausência para textos como “ainda não informado”; isso não significa que os dados tenham sido realmente fornecidos.

## 6. Achados da IA e do produto

### 6.1 Datas relativas históricas eram resolvidas contra o dia da reprodução — correção concluída

Na execução original, `extractMovingDate` usava `new Date()` no momento do replay. Como as mensagens eram históricas, expressões como “hoje”, “amanhã”, “sexta” ou “semana que vem” foram reinterpretadas em relação a 18–19/09/2026, não à data da mensagem original.

Evidências:

- 317 transições alteraram uma data já não nula ao longo dos turnos;
- em `results/export/5511956059062.json`, a data muda repetidamente entre `2026-09-19`, `2026-09-27`, `2026-09-24`, `2026-09-18`, `2026-09-23` e `2026-09-25`, inclusive em turnos compostos apenas por fotos;
- em `results/export/557188435065.json`, “amanhã à tarde” se referia ao agendamento da vistoria, mas o estado final recebeu `movingDate: 2026-09-19` — **nota adicionada em 22/09/2026:** este exemplo específico combinava os dois defeitos ao mesmo tempo (relógio errado E confusão de evento); corrigir só o relógio (ver validação da correção logo abaixo, que já reproduzia a mesma confusão de evento com data temporalmente correta) não bastava para este caso. A causa da confusão de evento em si é tratada à parte no item P0.2 e em `docs/correcoes/02_SEPARACAO_DATAS_EVENTOS.md`;
- em `results/export-marcia/137267859439796.json`, uma mensagem promocional alheia a mudança, com prazo “hoje”, produziu `movingDate: 2026-09-18`.

Esse problema combinava uma limitação do produto — dependência direta do relógio sem relógio injetável/contexto temporal da mensagem — com uma limitação do harness — replay histórico sem fornecer a data-base de cada fala. As datas do artefato original continuam sendo evidência histórica do defeito e não devem ser reinterpretadas como resultados corrigidos.

**Correção concluída em 19/09/2026.** `extractMovingDate(messages, referenceDate)` passou a aceitar uma data-base explícita, e `resolveMovingDate(signals, referenceDate)` deixou de consultar diretamente o relógio global. O handler de produção fornece o `createdAt` da mensagem mais recente; o replay canônico preserva os timestamps históricos e fornece o timestamp da mensagem de entrada mais recente, com fallback para a mensagem mais recente. O fallback de `extractMovingDate` preserva compatibilidade para chamadas correntes. O prompt temporal também foi restringido às falas do cliente, à decisão temporal mais recente e à distinção entre `period="semana que vem"` e `relativeWeeks`.

O bug foi reproduzido antes da mudança com data-base `2020-12-31T15:00:00-03:00` e texto “amanhã à tarde”: o código produziu `2026-09-20`, baseado no relógio da execução, em vez de `2021-01-01`. Depois da correção, o mesmo teste passou. A regressão permanente cobre hoje, amanhã, depois de amanhã, dia da semana, próxima sexta, semana que vem como período vago, data explícita e viradas de mês e ano.

Validações executadas:

- regressão específica: 2/2 testes passaram;
- suíte do bot: 23/23 testes passaram;
- verificação de sintaxe, lint e build: concluídos sem erro;
- API real, modelo `gpt-4o-mini-2024-07-18`: `export/5511956059062.json`, com referência `2026-08-25T21:29:53.000Z`, resolveu “Deixemos para quinta-feira” como `2026-08-27`; `export/557188435065.json`, com referência `2026-08-13T23:15:09.000Z`, resolveu “Amanhã à tarde” como `2026-08-14`;
- foram feitas 5 chamadas reais durante validação e diagnóstico, totalizando 5.425 tokens e custo estimado de US$ 0,0008961.

A correção trata exclusivamente a referência temporal. A separação entre data de mudança, vistoria, coleta e entrega permanece fora deste escopo, assim como o gate de relevância para mensagens promocionais. A própria validação desta correção (linha da tabela acima para `export/557188435065.json`) já reproduzia esse segundo defeito, independente do relógio: com a referência temporal correta (`2026-08-13T23:15:09.000Z`), “Amanhã à tarde” — resposta a uma pergunta de agendamento de **vistoria**, não de mudança — ainda resolvia para `2026-08-14` e teria preenchido `movingDate`. Esse defeito de confusão de evento foi corrigido separadamente; ver seção 6.1 acima e `docs/correcoes/02_SEPARACAO_DATAS_EVENTOS.md`.

**STATUS: CORREÇÃO CONFIRMADA POR TESTES.** O item deixa de ser pendência crítica de relógio; os riscos semânticos de evento e relevância continuam registrados separadamente.

### 6.2 Alucinações ou inferências sem suporte suficiente — prioridade alta

Casos confirmáveis pelos próprios artefatos:

- `results/export/5522998172204.json`, turno 2: `truckAccess` muda de “ainda não informado” para **“Sim, nos dois.”** após uma mensagem que apenas informa uma pequena mudança no sábado. Não há evidência de acesso do caminhão nesse trecho. O mesmo turno também infere escada/elevador sem suporte no texto mostrado;
- `results/export/557188435065.json`: o estado final confirma `name: "Leila"`, mas “Leila” aparece nas mensagens da empresa ao se dirigir à cliente; a cliente não declara o próprio nome. Isso viola a regra do prompt de não inferir nome a partir da fala da empresa;
- mudanças de campos ocorreram em turnos compostos somente por mídia sem transcrição. Exemplos incluem complementos de nome/endereço e alterações de data em `5511956059062.json`. Como o modelo recebe o histórico completo, a mudança pode decorrer de releitura tardia, mas não existe nova evidência textual no turno que justifique a alteração.

Não foi feita anotação humana independente das 885 conversas. Portanto, estes exemplos comprovam existência de falhas, mas não permitem estimar uma taxa global de alucinação.

### 6.3 Preservação de estado funcionou estruturalmente

Houve **zero** transição de valor não nulo para `null` nos 6.847 turnos consolidados. Contagens de turnos que preservaram valores exatamente iguais incluem:

- nome: 2.110;
- apelido: 1.080;
- origem: 4.563;
- destino: 4.259;
- observações: 4.085;
- condições comerciais: 2.201;
- data: 3.081.

Também houve atualizações úteis e plausíveis:

- nomes abreviados foram completados com nome completo;
- endereços por cidade/bairro foram enriquecidos com rua, número e complemento;
- listas de itens acumularam novos volumes;
- condições comerciais acompanharam contrapropostas e novos valores;
- opções de vistoria mudaram quando o histórico passou a indicar outra preferência.

Exemplos auditáveis estão em `5511956059062.json`, `557183077227.json`, `557182315510.json` e `557191880718.json`.

### 6.4 Correções legítimas e mudanças espúrias compartilham o mesmo mecanismo

Foram observadas alterações não nulas em:

| Campo | Alterações |
|---|---:|
| Nome | 7 |
| Origem | 107 |
| Destino | 81 |
| Tipo de imóvel | 2 |
| Observações da mudança | 268 |
| Condições comerciais | 24 |
| Escada/elevador | 64 |
| Acesso do caminhão | 14 |
| Tipo de vistoria | 5 |
| Data | 317 |

Muitas são correções ou complementos desejáveis. Porém, o harness não possui ground truth para separar automaticamente correção de alucinação. O caso de datas mostra que “mudança de valor” sozinha não é evidência de melhora.

### 6.5 Cancelamentos e exclusões não possuem estado estruturado — prioridade alta

O schema de extração não tem `cancelled`, `cancelledAt`, `cancellationScope` ou operação explícita de remoção. Consequências observadas:

- `results/export/557185564498.json`: a cliente diz “quero cancelar o agendamento”, mas o estado final mantém dados completos e `movingDate: 2026-09-23`; não existe campo que indique o cancelamento do agendamento;
- `results/export/557188926234.json`: “A mudança foi cancelada” resulta em campos majoritariamente nulos, mas o cancelamento em si não fica representado;
- `results/export/557184475858.json`: itens que não serão levados permanecem em `movingNotes` como frase negativa. Isso preserva contexto, mas pode ser interpretado por consumidores simples como item da mudança;
- em `results/export/556981698277.json`, “Armário de roupas não vai” foi tratado adequadamente e o armário não aparece na lista final, mostrando que exclusões podem funcionar, mas sem garantia uniforme.

A preservação contra `null` reduz perda acidental, porém também impede que um `null` ambíguo represente remoção intencional. Cancelamento precisa de semântica explícita, não de inferência por ausência.

**Nota adicionada em 22/09/2026 (item P1.1):** o cancelamento da mudança inteira foi corrigido posteriormente a esta execução — ver `docs/correcoes/05_CANCELAMENTOS_ESTRUTURADOS.md`. `Client` ganhou `movingCancelled`/`movingCancelledAt`/`cancellationEvidence`, preenchidos pelo mesmo `extractClientInfo` (sem chamada de API extra), com defesa em `stabilizeExtraction` para a política de preservação contra `null` nunca bloquear um cancelamento explícito nem "esquecer" um já confirmado por incerteza do modelo. Os dois casos citados acima foram revalidados com API real, com o código corrigido: `557185564498.json` ("quero cancelar o agendamento", ambíguo — a conversa segue e o cliente confirma a data em seguida) manteve `movingCancelled: false`, como esperado, já que o exame do restante da conversa mostra que era a data que estava em negociação, não a mudança inteira; `557188926234.json` ("A mudança foi cancelada...", inequívoco) passou a ter `movingCancelled: true` com a evidência textual da fala do cliente. Os arquivos `results/export/557185564498.json` e `results/export/557188926234.json` referenciados acima são os resultados **daquela execução histórica** (`final-full-15a92cc`) e não foram alterados — não existem mais em `results/` neste ambiente local (artefato ausente, registrado como limitação em `docs/correcoes/05_CANCELAMENTOS_ESTRUTURADOS.md`); a revalidação desta correção rodou os arquivos-fonte de `export/` diretamente contra o extrator atual, fora do harness da bateria. Exclusão de item (`results/export/557184475858.json`, `results/export/556981698277.json`) e cancelamento específico de vistoria/coleta/entrega **continuam pendentes** — ver P1.2 e os riscos residuais do documento de correção.

### 6.6 Nomes, apelidos e autoria da informação

O prompt distingue informação fornecida pelo cliente de texto da empresa, mas o caso “Leila” demonstra que essa separação ainda falha. Em conversas longas, a empresa frequentemente repete nomes, datas e interpretações; o modelo pode promovê-los a fatos confirmados. Recomenda-se avaliar a proveniência por campo e não apenas seu valor final.

### 6.7 Conteúdo fora do domínio

O dataset contém mensagens sem relação com mudanças. O caso promocional de `export-marcia/137267859439796.json` gerando data de mudança demonstra que o extrator não possui um gate forte de relevância antes de interpretar sinais temporais. Isso é especialmente importante em caixas de entrada compartilhadas ou datasets exportados sem filtragem de domínio.

## 7. Problemas do harness

### 7.1 Travamento após concluir a fila

Com `HYBRID_INITIAL_CONCURRENCY=1`, o worker 0 consumiu toda a fila e retornou. Os workers 1–9 permaneceram indefinidamente no laço:

```js
while (!stopRequested && workerId >= desiredConcurrency) {
  await new Promise((resolve) => setTimeout(resolve, 250))
}
```

Eles não verificam `nextIndex >= limitedWork.length` enquanto estão desativados. Por isso, `Promise.all` nunca resolveu e o bloco `finally` não foi executado. O processo não estava consolidando artefatos; estava ocioso. O encerramento seguro ocorreu somente após confirmar 885/885 resultados completos, ausência de atividade por cerca de uma hora e último HTTP 200.

Impactos observados nesta execução histórica (não alterados retroativamente por esta nota):

- processo não saiu sozinho;
- summary não recebeu os campos finais de encerramento;
- `proxy.close()` não foi alcançado pelo fluxo normal;
- foi necessário `Ctrl-C`, com exit code não zero, apesar do trabalho funcional completo.

**Correção concluída em 22/09/2026 (posterior a esta execução).** O laço de workers foi extraído para `whatsapp-bot/test/battery/workerPool.js` e corrigido: um worker desativado (`workerId >= desiredConcurrency`) passou a verificar, a cada ciclo de espera, se a fila já foi totalmente distribuída e, nesse caso, retorna normalmente em vez de aguardar indefinidamente por um aumento de concorrência que pode não vir. `runFinalHybridBattery.js` passou a delegar o pool de workers a esse módulo, preservando integralmente o checkpoint, o limiter de TPM/RPM, o custo, a retomada e o escalonamento adaptativo.

O defeito foi reproduzido antes da correção com uma fila sintética pequena (5 itens), concorrência inicial 1 e 10 workers, copiando literalmente o laço então vigente: a fila foi 100% consumida, mas o processo precisou ser morto por timeout externo (`exit code 137`), sem sair sozinho. Depois da correção, o mesmo cenário termina sozinho com `exit code 0`. Um teste de integração adicional, com o pool real rodando em processo separado (sem mock no controle dos workers), fila sintética e respostas de API simuladas, confirma encerramento automático com `exit code 0`, todas as tarefas persistidas exatamente uma vez e o bloco `finally` (summary final + fechamento do proxy) alcançado normalmente. Validação: 11 testes unitários + 3 testes de integração, todos passando; suíte completa do bot (47/47), incluindo as correções P0.1 e P0.2, sem regressão. Detalhes completos, evidências e riscos residuais em `docs/correcoes/03_TRAVAMENTO_WORKERS_OCIOSOS.md`.

**Esta execução histórica (`final-full-15a92cc`) não foi re-executada nem teve seu encerramento retroativamente reescrito: ela precisou de `Ctrl-C`, exatamente como descrito acima; a correção vale apenas para execuções futuras do harness.**

**Nota adicionada em 22/09/2026 (item P0.4):** a correção acima resolveu o travamento, mas por si só não produzia uma prova verificável de conclusão — o `execution-summary.json` escrito no `finally` continuava sem um campo de conclusão validada, identificação única da execução ou hashes dos artefatos (essa limitação estava explicitamente registrada como risco residual em `docs/correcoes/03_TRAVAMENTO_WORKERS_OCIOSOS.md`). Um marcador final atômico (`completion-marker.json`), publicado somente depois de validar resultados, checkpoint, summary e fechamento do proxy, foi implementado separadamente — ver `docs/correcoes/04_MARCADOR_FINAL_ATOMICO.md` e o item P0.4 na seção 10. Essa correção depende do encerramento automático que P0.3 já garante, mas não altera nenhuma linha do pool de workers.

### 7.2 Rastreabilidade incompleta de tentativas antigas

No log final, 2.860 tentativas não têm `logicalCallId` — 2.376 respostas 200 e 484 respostas 429. Isso reduz a capacidade de atribuir cada tentativa antiga a uma chamada lógica e explica por que a soma dos arrays `attempts` do checkpoint não iguala o total físico do log.

### 7.3 Métrica de retries é derivada, não pura

Os 1.175 “retries” do summary são calculados por diferença entre tentativas HTTP e registros locais tentados. A métrica mistura efeitos de retomada e histórico. Não deve ser usada como contagem exata de “segunda ou terceira tentativa da mesma chamada”.

### 7.4 Divergência entre summary e log da execução anterior

O summary anterior e o log anterior divergem em tentativas, erros e custo. A execução canônica usou o log preservado para calcular o valor incorporado. O problema não afeta os 13.694 resultados atuais, mas reduz a confiabilidade das métricas históricas daquele diretório.

### 7.5 Incidentes anteriores documentados

O `RESUME.md` registra, sem alteração de produção:

1. a primeira versão híbrida não cobria replay completo;
2. o proxy caiu por erro de escopo em `requestHash`/`parsed`;
3. o limiter inicialmente envolvia `globalThis.fetch`, mas o SDK não passava por ele;
4. checkpoint por chamada, summary/resultados atômicos e controle de TPM/RPM foram acrescentados ao harness;
5. uma retomada reiniciou indevidamente com concorrência 5;
6. a retomada final foi fixada em concorrência 1;
7. a finalização ficou presa no laço de workers ociosos descrito acima.

Os sucessos compatíveis foram preservados por chave; nenhum sucesso válido foi repetido intencionalmente.

## 8. Infraestrutura e rate limits

O incidente que motivou a pausa foi exclusivamente de infraestrutura da API: limite de **10.000 requests por janela móvel de 24 horas** para `gpt-4o-mini`. A execução reduziu concorrência progressivamente, mas o header chegou a `remainingRequests: 0`; os 429 persistiram até a pausa controlada.

Evidências estão em `PAUSE-AUDIT.json`, `RESUME.md` e nas linhas 429 de `api-attempts.jsonl`. Após mais de 24 horas, a retomada ocorreu com concorrência 1. Ela terminou sem novos 429: o contador permaneceu em 1.198 e as últimas 200 tentativas foram 200.

Os 429 não registraram tokens cobrados. Não houve 400, 401, 403, 404, 408, 409, 5xx ou erro de rede no log final; apenas 200 e 429.

## 9. Limitações da avaliação

1. **Sem ground truth humano integral.** Completude estrutural não mede fidelidade campo a campo.
2. **Relógio histórico incorreto.** Datas relativas não são avaliáveis sem usar o timestamp de cada mensagem como data-base.
3. **Mídia sem conteúdo.** `[mídia: foto]`, `[mídia: áudio]` e `[mídia: vídeo]` não trazem transcrição ou visão; o extrator só vê marcadores.
4. **Histórico completo repetido.** O modelo reinterpreta falas antigas a cada turno, podendo mudar estado sem evidência nova.
5. **Mensagens da empresa e do cliente coexistem.** Embora marcadas por direção, a autoria ainda pode ser confundida.
6. **Dataset heterogêneo.** Há spam, cobranças, promoções e contatos fora do domínio de mudanças.
7. **Temperatura zero não garante determinismo.** A execução não repetiu todas as chaves do zero; sucessos válidos foram reutilizados conforme a regra de checkpoint.
8. **Custo é estimado por tokens.** Não foi conciliado com fatura.
9. **Cancelamento não é modelado.** Não é possível medir taxa de acerto de cancelamento apenas pelos campos atuais.

## 10. Recomendações priorizadas

As recomendações P0.1, P0.2, P0.3, P0.4 e P1.1 (cancelamento da mudança inteira, dentro do item 5 abaixo) foram implementadas, validadas localmente e, em 22/09/2026, **publicadas em produção** (ver `docs/deploy/DEPLOY_P0_P1_1_2026-09-22.md`). As demais recomendações continuam pendentes.

### P0 — antes de confiar em datas históricas ou executar nova bateria

1. **Concluído e confirmado por testes:** tornar o relógio injetável em `extractMovingDate`/`resolveMovingDate` e fornecer o timestamp histórico no replay. Evidências e riscos residuais estão registrados na seção 6.1 e em `docs/correcoes/01_DATAS_RELATIVAS_HISTORICAS.md`.
2. **Concluído e confirmado por testes (22/09/2026):** separar explicitamente data da mudança, data da vistoria, data da coleta e data da entrega — o modelo podia confundir eventos e preencher `movingDate` com a data de outro evento. Evidências, causa raiz, correção e riscos residuais estão registrados em `docs/correcoes/02_SEPARACAO_DATAS_EVENTOS.md`. Esta correção é posterior à execução canônica `final-full-15a92cc`; os artefatos e hashes daquela execução não foram alterados.
3. **Concluído e confirmado por testes (22/09/2026):** corrigir o laço de workers para que workers desativados terminem quando a fila acabar, e adicionar teste de regressão com concorrência inicial 1 e fila completa. Evidências, causa raiz, correção, testes e riscos residuais estão registrados na seção 7.1 e em `docs/correcoes/03_TRAVAMENTO_WORKERS_OCIOSOS.md`. Esta correção é posterior à execução canônica `final-full-15a92cc`; os artefatos e hashes daquela execução não foram alterados, e seu encerramento histórico via `Ctrl-C` permanece registrado como tal.
4. **Concluído e confirmado por testes (22/09/2026):** escrever um marcador final atômico (`completed: true`, contagens, hashes e timestamp) somente após validar resultados e fechar o proxy. Evidências, causa raiz, formato do marcador, condições de publicação, comportamento de retomada/marcador obsoleto, testes e riscos residuais estão registrados em `docs/correcoes/04_MARCADOR_FINAL_ATOMICO.md`. Esta correção é posterior à execução canônica `final-full-15a92cc`; os artefatos e hashes daquela execução não foram alterados, e ela não recebeu — nem poderia receber retroativamente — um `completion-marker.json` próprio: sua conclusão continua registrada como confirmação manual (seção 1).

### P1 — segurança semântica do CRM

5. **Parcialmente concluído, confirmado por testes e publicado em produção (22/09/2026) — escopo `mudança` apenas:** adicionar estado estruturado de cancelamento com escopo (`mudança`, `vistoria`, `coleta`, `item`) e evidência textual. `Client.movingCancelled`/`movingCancelledAt`/`cancellationEvidence` cobrem o cancelamento explícito e inequívoco da MUDANÇA INTEIRA, com evidência textual, validado com os dois casos reais citados na seção 6.5. Evidências, causa raiz, semântica dos escopos, correção, testes e riscos residuais estão registrados em `docs/correcoes/05_CANCELAMENTOS_ESTRUTURADOS.md`. Esta correção é posterior à execução canônica `final-full-15a92cc`; os artefatos e hashes daquela execução não foram alterados. **Continuam pendentes** (registrados como risco residual, não implementados nesta correção, escopo P1.1 restrito deliberadamente): cancelamento estruturado de vistoria/coleta/entrega isoladamente, e o bot não deixa de tratar automaticamente uma mudança cancelada como ativa (continua enviando as mensagens automáticas de coleta de dados) — alterar isso tocaria o envio de mensagens do bot, fora do escopo autorizado desta correção.

   **Validação local vs. produção (22/09/2026, sessão de deploy):** a correção acima foi implementada e validada por testes automatizados (81/81, mock de API, banco temporário isolado por execução — nunca toca produção) e por chamadas reais de API contra os dois casos citados na seção 6.5, lidos diretamente de `export/` fora de qualquer banco. Isso comprova o comportamento do *extrator*, não do sistema em produção. Separadamente, nesta mesma data, o schema foi migrado e o código foi publicado e ativado no banco/serviços de produção reais (`crm.service`, `whatsapp-bot.service`), com backup prévio, migração revalidada em cópia isolada, restart controlado e verificação pós-deploy só de leitura (rotas HTTP, consultas Prisma reais aos novos campos, integridade do banco) — sem enviar nenhuma mensagem real nem acessar conversa real. **O que isso NÃO comprova:** nenhuma conversa real de um cliente de verdade passou pelo extrator com o código novo em produção até o momento deste registro — esse é o próximo comportamento a observar organicamente (ou validar de forma controlada, se e quando o usuário decidir) antes de considerar o item 5 plenamente validado em uso real. Detalhes completos do deploy, incluindo um desvio de processo identificado e corrigido (migração aplicada em produção antes do backup, numa sessão anterior, sob suposição incorreta de que o banco era local — sem dano identificado), estão em `docs/deploy/DEPLOY_P0_P1_1_2026-09-22.md`.
6. Representar inclusão/remoção de itens como operações ou lista estruturada, em vez de depender de texto negativo em `movingNotes`.
7. Guardar proveniência por campo: direção da mensagem, índice do turno e trecho de evidência. Rejeitar nome/apelido confirmado quando a evidência vier apenas da empresa.
8. Aplicar gate de relevância antes da extração de data e CRM para mensagens fora do domínio.
9. Exigir evidência explícita para `truckAccess`, escada/elevador e tipo de imóvel; respostas sem evidência devem permanecer “não informado”.

### P2 — qualidade e observabilidade

10. Criar uma amostra estratificada com anotação humana independente cobrindo conversas longas, correções, exclusões, cancelamentos, datas relativas e conteúdo fora do domínio.
11. Medir separadamente precisão, recall, taxa de alucinação, perda de estado, correção legítima e cancelamento.
12. Registrar retries reais por `logicalCallId` e tentativa ordinal; não inferi-los por subtração.
13. Garantir `logicalCallId` em 100% das tentativas e validar isso em teste.
14. Reconciliar ou selar logs históricos para impedir divergência entre summary e JSONL.
15. Adicionar auditorias automáticas: mudança de campo sem nova evidência textual, data alterada em turno somente de mídia, nome originado de fala da empresa e campo operacional preenchido sem citação.

## 11. Evidências e hashes finais

Artefatos principais:

- `execution-config.json` — identidade, hashes de dataset, modelo e preços;
- `checkpoint.jsonl` — estado append-only de chamadas lógicas;
- `api-attempts.jsonl` — tentativas HTTP e usage;
- `execution-summary.json` — agregação final antes do travamento de saída;
- `results/` — 885 históricos consolidados turno a turno;
- `empty-conversations.json` — 379 conversas vazias;
- `PAUSE-AUDIT.json` — estado da pausa por RPD;
- `RESUME.md` — protocolo e incidentes de retomada.

Hashes SHA-256 após o encerramento:

| Artefato | SHA-256 |
|---|---|
| `checkpoint.jsonl` | `8901d40dcbc78f1f3dd303e61bcfb65b3eb05f287506b95b9787f331055b69c4` |
| `api-attempts.jsonl` | `80505e924f16d53bfaabe12167352767ca72ab3ee4185ba754aa26f7b374bdba` |
| `execution-summary.json` | `9ad19c30fb841bc7ecf667cea6f031ab40c904b0c2c3307472a757c857216ae5` |
| `execution-config.json` | `7da579d798f8f95761d7df87ea232aed381a419cb090edf801e5581b98759957` |
| `empty-conversations.json` | `596519f03de820439199257b429e38266edffbf85a632a2b4abac9dc747cf693` |
| `results/` agregado | `b6d8a073eb6119603026dd905acedb64b61f9e1f37aa4d463fec3b9abb09a706` |

O hash agregado de `results/` foi calculado ordenando dataset e nome de arquivo e alimentando SHA-256 com `caminho relativo`, byte NUL, conteúdo integral e byte NUL para cada um dos 885 JSON.

## 12. Conclusão

A bateria atingiu integralmente seu objetivo estrutural e preservou evidência suficiente para auditoria: 885 conversas completas, 6.847 turnos, 13.694 resultados canônicos — duas extrações por turno — e custo dentro do teto. Não há trabalho de API pendente.

O principal valor do resultado é revelar que a preservação mecânica de estado funciona e que a infraestrutura consegue retomar sem repetir sucessos válidos. Ao mesmo tempo, o replay completo expõe riscos semânticos que impedem tratar “100% processado” como “100% correto”: datas históricas ancoradas no relógio errado, inferências sem suporte, cancelamentos não modelados e mudanças de estado sem nova evidência textual.

O próximo passo recomendado é revisar e priorizar os itens P0/P1, mas somente depois deste relatório ser aceito e antes de qualquer correção de produção.
