# Correção 03 — Travamento dos workers ociosos após a conclusão da fila

Data: 22/09/2026. Escopo: exclusivamente o item **P0.3** do relatório final da bateria canônica (`docs/relatorios/FINAL-REPORT-bateria-canonica-final-full-15a92cc.md`, seção 7.1). Esta correção é **posterior** à execução canônica `final-full-15a92cc` e não alterou nenhum artefato, hash, checkpoint, log ou dataset daquela execução. Ela também preserva integralmente as correções [[P0.1]](01_DATAS_RELATIVAS_HISTORICAS.md) e [[P0.2]](02_SEPARACAO_DATAS_EVENTOS.md).

## Problema identificado

Na execução `final-full-15a92cc`, todo o trabalho útil terminou (885/885 conversas, 13.694/13.694 chamadas canônicas), mas o processo do harness continuou vivo indefinidamente. Foi necessário `Ctrl-C` depois de confirmar manualmente, por cerca de uma hora sem atividade, que não havia trabalho pendente. O `execution-summary.json` daquela execução não recebeu os campos finais de encerramento (`completedConversations`, `scheduledConversations`, `stoppedByCost`), porque o bloco `finally` nunca rodou.

## Causa raiz confirmada

Em `whatsapp-bot/test/battery/runFinalHybridBattery.js`, o harness cria `maxConversationConcurrency` workers de uma vez (10 fora de `DRY_RUN`) via `Promise.all`, mas só deixa ativos os workers cujo `workerId` é menor que a concorrência desejada no momento (`desiredConcurrency`), que é ajustada dinamicamente conforme a resposta da API (rate limiting adaptativo). O laço de cada worker era:

```js
async function worker(workerId) {
  while (!stopRequested) {
    while (!stopRequested && workerId >= desiredConcurrency) {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    if (stopRequested) return
    const index = nextIndex++
    if (index >= limitedWork.length) return
    // ...processa limitedWork[index]...
  }
}
```

Com `HYBRID_INITIAL_CONCURRENCY=1` (concorrência usada na retomada final), apenas o worker 0 ficava ativo. Ele sozinho consumiu toda a fila (`nextIndex` chegou a `limitedWork.length`) e retornou normalmente. Os workers 1–9, porém, ficaram presos no laço interno `while (!stopRequested && workerId >= desiredConcurrency)`: esse laço **não verifica se ainda há trabalho** (`nextIndex >= limitedWork.length`) — ele só olha `stopRequested` e a concorrência atual. Como `desiredConcurrency` nunca voltou a subir o suficiente (a fila já tinha acabado, então não havia mais tráfego HTTP para disparar o escalonamento adaptativo) e `stopRequested` só é setado por `CostLimitReached` (o teto de custo nunca foi atingido) ou por uma parada manual, esses 9 workers ficaram aguardando `setTimeout(250)` para sempre. `Promise.all` nunca resolveu, e o bloco `finally` (que grava o summary final e fecha o proxy) nunca foi alcançado.

## Reprodução do erro antes da correção

A reprodução usou exclusivamente uma fila sintética pequena e finita, sem tocar `export/`, `export-marcia/` nem qualquer conta do WhatsApp, e sem nenhuma chamada de API real.

1. O trecho do laço de workers foi copiado **literalmente** do arquivo atual (antes desta correção) para um script isolado (`repro-buggy-original.mjs`), substituindo apenas a origem dos dados: fila sintética de 5 itens, `desiredConcurrency = 1`, 10 workers criados (igual à bateria real), `processOne` simulado com um `setTimeout` de 20ms no lugar da chamada de IA.
2. O script grava evidência incremental em um arquivo de saída (diretório temporário) mostrando quantas tarefas da fila já foram concluídas.
3. Executado como processo separado, com timeout externo do sistema operacional (`timeout --signal=KILL 8s`) para garantir que nenhum processo órfão sobrevivesse ao teste, mesmo em caso de travamento.

Resultado observado:

```json
{
  "queueLength": 5,
  "completedConversations": 5,
  "queueFullyConsumed": true,
  "stillRunning": true
}
```

O processo foi morto pelo `timeout` (`exit code 137`, `SIGKILL`) depois de consumir a fila inteira (5/5) e continuar rodando sem trabalho pendente — confirmando exatamente o defeito descrito no relatório: a fila termina, mas o processo não. Isso prova que o defeito **ainda existia no código atual** antes desta correção, não apenas na execução histórica.

## Arquivos modificados

- `whatsapp-bot/test/battery/workerPool.js` (novo) — pool de workers extraído para módulo isolado e testável, com a correção aplicada.
- `whatsapp-bot/test/battery/runFinalHybridBattery.js` — o laço de workers inline foi substituído por uma chamada a `runWorkerPool(...)`, com o mesmo comportamento externo (mesma variável `stopRequested`, mesmo tratamento de `CostLimitReached`, mesmo `finally` com `writeSummary`/`proxy.close()`). Nenhuma outra parte do harness (checkpoint, cache, limiter de TPM/RPM, custo, retomada, escalonamento adaptativo, escrita atômica de resultados) foi alterada.
- `whatsapp-bot/test/battery/workerPool.test.js` (novo) — suíte de regressão permanente.
- `whatsapp-bot/test/battery/workerPoolIntegrationRunner.mjs` (novo) — script auxiliar que roda o pool real em processo separado com dados sintéticos, usado pelo teste de integração.
- `whatsapp-bot/test/battery/workerPoolIntegration.test.js` (novo) — teste de integração de ponta a ponta.
- `whatsapp-bot/package.json` — o script `test` passou a incluir `test/battery/*.test.js`, para que a nova suíte rode automaticamente em `npm test` (antes, o glob só cobria `test/*.test.js`).
- `docs/correcoes/03_TRAVAMENTO_WORKERS_OCIOSOS.md` (este arquivo).
- `docs/relatorios/FINAL-REPORT-bateria-canonica-final-full-15a92cc.md` — seções 1, 7.1 e 10 (item P0.3) atualizadas para refletir a correção, preservando integralmente números, custos, hashes e evidências da execução canônica original.

Nenhum arquivo de produção (`whatsapp-bot/src/**`, `prisma/schema.prisma`, app Next.js do CRM) foi tocado. Nenhum prompt de IA, schema de extração ou comportamento do bot foi alterado. Os datasets `export/` e `export-marcia/` permanecem byte-a-byte idênticos (ver seção "Verificação de integridade" abaixo).

## Explicação técnica da implementação

A correção é a menor mudança segura possível no laço em si: um worker desativado (`workerId >= desiredConcurrency`) agora verifica, a cada iteração do laço de espera, se a fila já foi totalmente distribuída (`nextIndex >= taskCount`) e retorna normalmente nesse caso, em vez de continuar esperando um aumento de concorrência que pode nunca vir.

```js
while (!isStopped() && workerId >= getConcurrency()) {
  if (nextIndex >= taskCount) return   // <- única linha nova
  await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
}
```

Essa checagem é segura porque:

- **Nenhuma tarefa pendente é descartada.** `nextIndex >= taskCount` só é verdadeiro quando toda a fila já foi *distribuída* (atribuída a algum worker via `nextIndex++`), nunca antes disso — um worker desativado nunca "pula a fila", ele só para de esperar quando não há mais nada a distribuir.
- **Nenhuma chamada em voo é abandonada.** O worker desativado, por definição, não está no meio de nenhum `runTask` — ele está preso no laço de espera *antes* de pegar qualquer índice. Os workers que efetivamente pegaram tarefas continuam seu fluxo normal (`await runTask(index)`) sem qualquer alteração; o `Promise.all` externo já esperava por eles antes e continua esperando.
- **Nenhum encerramento prematuro.** Se ainda há itens não distribuídos (`nextIndex < taskCount`), o worker desativado continua no laço de espera normalmente — ele só sai quando a concorrência subir o suficiente para ativá-lo, quando `stopRequested` virar `true`, ou quando a fila de fato acabar. A condição de saída antecipada é estritamente mais restritiva que "a fila acabou".
- **Concorrência dinâmica preservada.** `getConcurrency()` continua sendo chamado a cada iteração (não é capturado uma única vez), então um worker que estava prestes a desistir por falta de fila, mas cuja concorrência sobe antes disso, é reativado normalmente — o `if` novo só dispara quando realmente não sobrou trabalho.
- **Concorrência inicial 1 e valores maiores funcionam igual.** A lógica não depende do valor específico de `desiredConcurrency`; funciona para qualquer concorrência inicial de 1 até o teto de 10.
- **Retry, rate limiting, checkpoint e retomada preservados.** Nada dentro de `runTask`/`processOne`/`checkedCall` foi tocado; a correção fica inteiramente no laço externo que decide *quando* chamar `runTask`, não *o que* `runTask` faz.
- **`Promise.all` resolve e o `finally` roda.** Como todo worker agora retorna normalmente quando a fila acaba (ativo ou não), o `Promise.all` de `runWorkerPool` resolve, e o `finally` de `runFinalHybridBattery.js` (que grava o summary final e fecha o proxy) volta a ser alcançado pelo fluxo normal.

O laço foi extraído para `whatsapp-bot/test/battery/workerPool.js` como uma função pura e parametrizada (`runWorkerPool`), recebendo `getConcurrency`, `isStopped`, `stop`, `runTask` e `isFatal` como funções — o mesmo padrão de "getters" que o código original já usava implicitamente via closures sobre variáveis externas (`desiredConcurrency`, `stopRequested`). Essa extração foi necessária para permitir testes de regressão automatizados com filas sintéticas pequenas, sem depender dos datasets reais (que fixam exatamente 885 conversas e 6.847 turnos, ver `runFinalHybridBattery.js:424-426`) nem de chamadas de API. `runFinalHybridBattery.js` chama `runWorkerPool` passando exatamente as mesmas variáveis de antes; o comportamento externo do harness (summary, checkpoint, custo, limiter, escalonamento) é idêntico ao anterior, exceto pelo bug corrigido.

## Testes de regressão criados

`whatsapp-bot/test/battery/workerPool.test.js` (11 testes, unitários, sem I/O de rede nem de disco, todos com timeout de watchdog do próprio runner de testes):

1. concorrência inicial 1 com 10 workers criados e fila pequena finita;
2. fila vazia;
3. fila com apenas uma tarefa;
4. fila com menos tarefas do que workers (concorrência alta);
5. fila com várias tarefas (37) e concorrência inicial superior a 1;
6. workers temporariamente desativados, reativados por escalonamento dinâmico de concorrência;
7. tarefas ainda em execução quando a fila já foi totalmente distribuída (garante que nada em voo é abandonado);
8. encerramento normal após a última tarefa, com a maioria dos workers desativados o tempo todo;
9. parada controlada (`stop()`/`isStopped()`) — tarefas não iniciadas não são processadas, mas as já iniciadas terminam;
10. erro fatal (`isFatal`) aciona `stop()` sem relançar para o chamador (equivalente ao `CostLimitReached` real);
11. erro não-fatal se propaga normalmente para quem chamou o pool.

Os testes 1, 5 e 11 verificam explicitamente que cada tarefa é processada **exatamente uma vez** (índices únicos, sem duplicata) e que todas têm resultado presente no array de saída.

`whatsapp-bot/test/battery/workerPoolIntegration.test.js` (3 testes) — integração real, sem mock no controle dos workers, rodando `workerPool.js` de dentro de um **processo filho separado** (`workerPoolIntegrationRunner.mjs`), com:

- fila sintética (9, 2 e 15 tarefas nos três cenários), diretório temporário isolado por teste (`fs.mkdtempSync`, removido ao final);
- "respostas de API" simuladas por um atraso (nenhuma chamada de rede real);
- checkpoint incremental (`checkpoint.jsonl`) e resultado atômico por tarefa em disco, no mesmo padrão do harness real;
- fechamento de um "proxy" fake no `finally`, com um arquivo-marcador (`proxy-closed.marker`) provando que o fluxo normal de finalização foi alcançado;
- timeout de segurança de 15s no processo filho (`execFileSync({ timeout })`) — se o processo for morto pelo timeout, o teste falha explicitamente citando "travamento não corrigido", em vez de deixar o processo filho órfão.

## Resultados dos testes e da integração

- Reprodução do defeito no código anterior: fila 5/5 consumida, processo morto pelo `timeout` (`exit code 137`) — travamento confirmado.
- Mesmo cenário, código corrigido (`runWorkerPool`): fila 5/5 consumida, processo termina sozinho, **exit code 0**, em ~250ms (bem abaixo do timeout de 8s).
- `whatsapp-bot/test/battery/workerPool.test.js`: **11/11 testes passaram.**
- `whatsapp-bot/test/battery/workerPoolIntegration.test.js`: **3/3 testes passaram**, todos com o processo filho terminando com **exit code 0**.
- Suíte completa do bot (`npm test` em `whatsapp-bot`, glob ampliado para incluir `test/battery/*.test.js`): **47/47 testes passaram**, incluindo:
  - os 14 novos testes desta correção;
  - `historicalRelativeDates.test.js` (P0.1): passou integralmente;
  - `movingDateEventSeparation.test.js` (P0.2): passou integralmente;
  - `handoff.test.js`, `raceCondition.test.js`, `extractionPolicy.test.js`, `determinism.test.js`, `smoke.test.js` e `battery/loadConversations`-relacionados: todos passaram sem alteração de comportamento.
- Raiz do projeto (Next.js/CRM): `npm run lint` — sem avisos ou erros; `npm run build` — concluído com sucesso, incluindo checagem de tipos. Nenhum deploy ou reinício de serviço foi executado (apenas `npm run build` como verificação de compilação, mesma prática das correções P0.1 e P0.2 — nunca `npm run deploy`).

## Evidências de encerramento automático e exit code

O teste de integração principal (`integração real do harness (processo separado): encerra sozinho com exit code 0 depois de concluir a fila`) reproduz a configuração exata da retomada final da bateria canônica — concorrência inicial 1, 10 workers criados — com uma fila sintética de 9 tarefas. O processo filho:

- consome a fila inteira (9/9, verificado por `checkpoint.jsonl` e pelos 9 arquivos em `results/`, cada tarefa presente exatamente uma vez);
- alcança o bloco `finally` (marcador `proxy-closed.marker` presente, `execution-summary.json` com `completed: true`);
- termina sozinho, sem qualquer sinal externo, com **exit code 0** — sem depender de `Ctrl-C` nem do timeout de segurança de 15s do teste.

## Verificação de integridade dos datasets e artefatos históricos

Hashes SHA-256 agregados de `export/` e `export-marcia/` (todos os arquivos, ordenados por caminho) calculados **antes** de qualquer alteração desta correção e **depois** de toda a implementação, testes e execução de `npm run build`/`npm run lint`:

- hash agregado antes: `f6c5ab4f7ed9cc46dc967f67f27f7c9aad79e2e23af4c882df7f6e133feacb4a`
- hash agregado depois: **idêntico** — nenhum byte dos datasets foi alterado.

Os artefatos da execução `final-full-15a92cc` (`checkpoint.jsonl`, `api-attempts.jsonl`, `execution-summary.json`, `execution-config.json`, `empty-conversations.json`, `results/`) **não existem no ambiente de trabalho local** desta sessão — apenas o relatório final que os descreve e registra seus hashes (seção 11 do relatório) está presente. Como não há artefatos locais para reler, a garantia de integridade para eles é: (a) esta correção não executou nenhuma leitura, escrita ou remoção em qualquer caminho contendo `final-full-15a92cc`; (b) os hashes SHA-256 já registrados na seção 11 do relatório permanecem exatamente como estavam, porque a seção 11 não foi editada por esta correção (ver diff do relatório); (c) `git status` confirma que nenhum arquivo fora do escopo listado em "Arquivos modificados" foi tocado.

Todos os testes desta correção (unitários e de integração) escreveram exclusivamente em diretórios temporários próprios (`fs.mkdtempSync` sob o `os.tmpdir()` do sistema, ou o diretório de scratchpad da sessão), nunca em `whatsapp-bot/test/battery/out/final-full-15a92cc` nem em qualquer checkpoint real. Cada diretório temporário criado pelos testes de integração foi removido (`fs.rmSync(..., { recursive: true, force: true })`) ao final do próprio teste que o criou; os processos filho dos testes de integração e do script de reprodução rodaram sob timeout externo (`execFileSync({ timeout })` / `timeout --signal=KILL`), garantindo que nenhum processo órfão sobrevivesse a esta sessão mesmo em caso de falha.

## Limitações e riscos residuais

- O polling de 250ms (`pollIntervalMs` no harness real) significa que, no pior caso, um worker recém-esvaziado de trabalho pode levar até ~250ms a mais para perceber que a fila acabou e retornar — irrelevante frente à escala de uma bateria de milhares de chamadas, e não é um comportamento novo desta correção (o mesmo intervalo já existia antes, controlando quando um worker desativado verifica se deve ser reativado).
- Esta correção não implementa o marcador final atômico (`completed: true` com contagens, hashes e timestamp) previsto no item **P0.4** do relatório — isso permanece fora de escopo, como instruído. O `execution-summary.json` escrito no `finally` continua no mesmo formato de antes (apenas passa a ser efetivamente alcançado quando a concorrência inicial é baixa). **Nota adicionada em 22/09/2026:** o item P0.4 foi implementado separadamente em uma correção posterior — ver [[04_MARCADOR_FINAL_ATOMICO.md]](04_MARCADOR_FINAL_ATOMICO.md) — sem alterar nenhuma linha desta correção (P0.3) nem de `workerPool.js`.
- A integração real (Etapa 3.4) usa uma fila sintética pequena (até 15 itens) e respostas simuladas por atraso, não os datasets/API reais — isso é uma restrição explícita do escopo autorizado desta correção (proibição de rodar uma nova bateria integral de 885 conversas), não uma limitação técnica da correção em si. A correção também foi validada por leitura de código linha a linha contra o laço original documentado no relatório.
- Não foi executada uma nova bateria real de milhares de conversas para observar o desligamento automático em escala real; isso está fora do escopo autorizado desta tarefa.

## Status final

**P0.3: CONCLUÍDO.**

Todos os critérios de conclusão foram atendidos: o travamento foi reproduzido no código anterior com evidência de fila 100% consumida e processo travado (exit code 137 sob timeout externo); a causa raiz foi demonstrada linha a linha; a correção foi implementada como a menor mudança segura no laço de workers; o mesmo teste de reprodução passa após a correção (exit code 0); a integração em processo separado demonstra encerramento automático com exit code 0 e todas as tarefas persistidas exatamente uma vez; nenhum processo de teste ficou órfão; a suíte de testes do bot (47/47), lint e build da raiz passaram; as correções P0.1 e P0.2 continuam passando integralmente; os datasets e o relatório histórico permanecem intactos fora das seções explicitamente atualizadas nesta correção.
