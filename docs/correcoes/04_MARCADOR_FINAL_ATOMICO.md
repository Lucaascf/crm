# Correção 04 — Marcador final atômico e verificável de conclusão

Data: 22/09/2026. Escopo: exclusivamente o item **P0.4** do relatório final da bateria canônica (`docs/relatorios/FINAL-REPORT-bateria-canonica-final-full-15a92cc.md`, seções 3.3, 7.1 e 10). Esta correção é **posterior** à execução canônica `final-full-15a92cc` e não alterou nenhum artefato, hash, checkpoint, log ou dataset daquela execução. Ela também preserva integralmente as correções [[P0.1]](01_DATAS_RELATIVAS_HISTORICAS.md), [[P0.2]](02_SEPARACAO_DATAS_EVENTOS.md) e [[P0.3]](03_TRAVAMENTO_WORKERS_OCIOSOS.md).

## Problema e causa raiz

O relatório final (seção 3.3) descreve que `execution-summary.json` "não contém `completedConversations`, `scheduledConversations` e `stoppedByCost`, porque o processo ficou preso antes do `finally`" e que a conclusão da execução `final-full-15a92cc` foi estabelecida por **julgamento manual**: "Após confirmar a completude dos resultados e a ausência de atividade por cerca de uma hora, ele foi encerrado com `Ctrl-C`" (seção 1). A recomendação P0.4 (seção 10) pede exatamente o que faltava: "Escrever um marcador final atômico (`completed: true`, contagens, hashes e timestamp) somente após validar resultados e fechar o proxy."

A causa raiz, confirmada por leitura de `whatsapp-bot/test/battery/runFinalHybridBattery.js` (antes desta correção): `execution-summary.json` é reescrito por `writeSummary()` a cada `appendRecord()` — ou seja, a cada chamada lógica concluída, não só no final — e nunca contém um campo booleano de conclusão *verificada*, nenhuma identificação única da execução e nenhum hash dos artefatos. O único momento em que campos de encerramento (`completedConversations`, `scheduledConversations`, `stoppedByCost`) são acrescentados é dentro do bloco `finally`, mas mesmo esse summary final não é validado contra o checkpoint nem contra os resultados em disco — ele só reflete o que o próprio processo acredita ter feito, sem nenhuma prova cruzada independente.

## Reprodução do problema antes da correção

A reprodução (`repro-no-atomic-marker.mjs`, executada antes de qualquer alteração de código, sem tocar `export/`, `export-marcia/` nem qualquer conta do WhatsApp) copiou o padrão exato de finalização então vigente — `writeSummary()`/`appendRecord()` reescrevendo `execution-summary.json` a cada registro, seguido de um bloco `finally` com `writeSummary(extra)` + `proxy.close()` — aplicado a uma fila sintética de 5 itens.

Evidências coletadas:

- `execution-summary.json` foi reescrito **6 vezes** durante a execução (5 registros + 1 no `finally`), não apenas uma vez ao final;
- um snapshot tirado **antes** do bloco `finally` rodar (equivalente a um crash logo após o último registro, antes de `proxy.close()`) já mostra `checkpoint.jsonl` com **5/5 sucessos persistidos** — ou seja, um leitor externo que confiasse só no checkpoint concluiria "está tudo pronto" antes mesmo do proxy fechar;
- nem o snapshot intermediário nem o summary final (depois do `finally`) contêm `completed` (booleano), identificação única da execução, contagens explícitas de esperado-vs-efetivo, ou hashes de qualquer artefato.

Isso confirma, com evidência executável (não apenas pela ausência do marcador na bateria histórica), que o código então vigente não produzia — em nenhum ponto do fluxo — um artefato que só pudesse afirmar conclusão depois de workers, resultados, checkpoint, summary e proxy terem sido efetivamente validados.

## Arquivos modificados

- `whatsapp-bot/test/battery/finalizationMarker.js` (novo) — módulo com toda a lógica de validação cruzada e publicação atômica do marcador.
- `whatsapp-bot/test/battery/runFinalHybridBattery.js` — depois do bloco `try/catch/finally` existente (que já cuida de `writeSummary(extra)` e `proxy.close()`, preservado sem alteração de comportamento), chama `publishCompletionMarker(...)` apenas se a execução não foi interrompida por custo/parada; e, no início de `main()`, chama `invalidateStaleMarker(outputDir)` logo depois da checagem de fingerprint do `execution-config.json` existente. Nenhuma outra parte do harness (checkpoint, cache, limiter de TPM/RPM, custo, retomada, escalonamento adaptativo, pool de workers, escrita atômica de resultados) foi tocada.
- `whatsapp-bot/test/battery/finalizationMarker.test.js` (novo) — 22 testes unitários de regressão.
- `whatsapp-bot/test/battery/finalizationMarkerIntegrationRunner.mjs` (novo) — script auxiliar que roda o fluxo real de finalização (workers → summary → proxy → marcador) em processo separado, com dados sintéticos e modos de falha controlados.
- `whatsapp-bot/test/battery/finalizationMarkerIntegration.test.js` (novo) — 5 testes de integração de ponta a ponta.
- `docs/correcoes/04_MARCADOR_FINAL_ATOMICO.md` (este arquivo).
- `docs/relatorios/FINAL-REPORT-bateria-canonica-final-full-15a92cc.md` — seções 1, 3.3, 7.1 e 10 (item P0.4) atualizadas para refletir a correção, preservando integralmente números, custos, hashes e evidências da execução canônica original.

Nenhum arquivo de produção (`whatsapp-bot/src/**`, `prisma/schema.prisma`, app Next.js do CRM) foi tocado. Os datasets `export/` e `export-marcia/` permanecem byte-a-byte idênticos (ver "Verificação de integridade" abaixo). `whatsapp-bot/package.json` já incluía `test/battery/*.test.js` no script `test` desde a correção P0.3; os dois novos arquivos de teste rodam automaticamente em `npm test`, sem alteração adicional.

## Implementação e justificativas

### O que é o marcador e onde ele mora

`whatsapp-bot/test/battery/finalizationMarker.js` publica, ao lado dos demais artefatos da execução, um arquivo `completion-marker.json` — um artefato **separado** de `execution-summary.json`, escrito **uma única vez**, só depois de toda validação passar. `execution-summary.json` continua existindo exatamente como antes (P0.3 não foi alterado): ele é o registro operacional, contínuo, reescrito a cada chamada. `completion-marker.json` é o atestado final, binário (existe com `completed: true` e é válido, ou não existe) — a distinção deliberada entre os dois evita misturar telemetria de progresso com prova de conclusão.

### Formato do marcador e seus campos

```json
{
  "completed": true,
  "executionId": "<fingerprint da execução>",
  "outputDir": "final-full-15a92cc",
  "completedAt": "2026-09-22T13:14:20.123Z",
  "conversations": { "expected": 885, "actual": 885 },
  "turns": { "expected": 6847, "actual": 6847 },
  "logicalCalls": { "expected": 13694, "actual": 13694, "succeeded": 13694, "failed": 0 },
  "artifactHashes": {
    "checkpoint.jsonl": "<sha256>",
    "api-attempts.jsonl": "<sha256>",
    "execution-summary.json": "<sha256>",
    "execution-config.json": "<sha256>",
    "empty-conversations.json": "<sha256>",
    "results": "<sha256 agregado>"
  },
  "executionConfig": {
    "fingerprint": "...", "commit": "...", "codeHash": "...",
    "datasetHashes": { "export": "...", "export-marcia": "..." },
    "model": "gpt-4o-mini", "temperature": 0, "costCapUsd": 7.5, "dryRun": false
  }
}
```

Todos os campos mínimos pedidos pela tarefa estão presentes: `completed: true`; `executionId` (o `fingerprint`, que já identifica de forma única commit + hash do código relevante + hashes dos datasets + modelo — reaproveitar esse identificador existente, em vez de gerar um UUID novo, torna o marcador determinístico: republicar sobre um estado idêntico produz o mesmo conteúdo, só `completedAt` muda); `completedAt`; contagem esperada e efetiva de conversas e de turnos; contagem de chamadas lógicas concluídas (com detalhamento de sucesso/erro — ver "Semântica de 'concluída' vs. 'bem-sucedida'" abaixo); hashes dos artefatos necessários à verificação; e a identificação completa da configuração da execução.

O hash agregado de `results/` usa o mesmo método já documentado na seção 11 do relatório final (ordenar por dataset e nome de arquivo, alimentar SHA-256 com caminho relativo + byte NUL + conteúdo integral + byte NUL, por arquivo) — escolha deliberada para que o método de verificação seja o mesmo já usado e auditado na execução canônica.

### As 7 condições de publicação

`publishCompletionMarker(ctx)` só grava algo em disco depois que `validateFinalization(ctx)` (chamada internamente) verifica, nesta ordem, exatamente as 7 condições pedidas:

1. **Workers terminaram normalmente** — `ctx.workersEndedNormally !== true` lança `workers-not-ended-normally` antes de tocar em qualquer arquivo. No harness real, isso só é `true` quando o `try/catch/finally` de `runFinalHybridBattery.js` (que chama `runWorkerPool`, já corrigido em P0.3) terminou sem relançar.
2. **Todas as tarefas esperadas concluídas** — contagem de conversas é recomputada a partir dos arquivos realmente presentes em `results/<dataset>/*.json` (nunca de um contador em memória) e comparada com `expectedConversations`.
3. **Resultados e checkpoints persistidos** — cada resultado precisa ter `complete: true` e `processedTurns === turnResults.length`; a soma de `turnResults.length` de todos os resultados é comparada com `expectedTurns`.
4. **Contagens e referências entre resultados e checkpoint verificadas** — toda `extractionCacheKey`/`dateCacheKey` citada em qualquer resultado precisa existir no checkpoint (senão: `dangling-checkpoint-reference`, com o arquivo e a chave exatos no erro); o total de referências resolvidas é comparado com `expectedLogicalCalls`.
5. **Summary final gravado com sucesso** — o arquivo precisa existir, ser JSON válido e pertencer à mesma execução (`summary.fingerprint === fingerprint`); qualquer uma dessas falhas usa um motivo específico (`summary-missing`, `summary-invalid`, `summary-fingerprint-mismatch`).
6. **Proxy e recursos fechados** — `ctx.proxyClosed !== true` lança `proxy-not-closed`. No harness real, `publishCompletionMarker` só é chamado depois que `await proxy.close()` (dentro do `finally` já existente) retornou sem lançar.
7. **Verificações de integridade aprovadas** — as condições 2–4 acima, em conjunto, são a verificação de integridade cruzada entre resultados, checkpoint e contagens esperadas; os hashes (calculados só depois de todas as condições passarem) são a prova de integridade dos artefatos no momento da publicação.

Se qualquer condição falhar, `validateFinalization`/`publishCompletionMarker` **lançam** uma `FinalizationValidationError` com um `reason` específico (12 motivos distintos, um por tipo de falha) e **nada é escrito em disco** — nem um marcador parcial, nem um marcador com `completed: false`. A ausência do arquivo é, por si só, o sinal de "ainda não verificado".

### Semântica de "concluída" vs. "bem-sucedida"

O harness tolera erros individuais de chamada de IA sem falhar a execução inteira (`checkedCall` grava `status: 'error'` e segue adiante, preservando o estado anterior — ver `RELATORIO-FINAL-AJUSTES.md`, seção 3, e o próprio relatório final, que registra 23 erros históricos entre 13.694 referências canônicas). Por isso, o marcador conta como "concluída" (`logicalCalls.actual`) toda chamada lógica com um registro **terminal** no checkpoint — `success` ou `error`, nunca ausente/pendente — e reporta `succeeded`/`failed` separadamente. Exigir 100% de sucesso quebraria a tolerância a erro que já é parte do desenho do harness; exigir apenas "existe alguma referência" (sem checar status terminal) deixaria passar uma chamada ainda em voo. A condição correta, e a que este marcador aplica, é "toda chamada referenciada tem uma resolução terminal registrada" — nenhuma referência pendurada, nenhuma em voo.

### Atomicidade

`atomicWriteJson` (interno ao módulo) escreve o marcador completo, já serializado, num arquivo temporário no **mesmo diretório** (`completion-marker.json.<pid>.<random>.tmp`) e só então chama `fs.renameSync` para o caminho final — `rename` no mesmo sistema de arquivos é atômico no POSIX: nenhum leitor concorrente pode observar um arquivo parcialmente escrito no caminho canônico, e qualquer falha antes do `rename` nunca chega a tocar nele. Se o `rename` em si falhar (por exemplo, o caminho final já existir como diretório — testado explicitamente), o arquivo temporário é removido (`fs.rmSync`) antes de relançar o erro, para não deixar lixo órfão em disco.

### Retomadas, marcadores obsoletos e execuções interrompidas

- **Execução interrompida (crash/Ctrl-C) antes da publicação:** como o marcador só é escrito no fim, depois de todas as validações, uma interrupção em qualquer ponto anterior simplesmente nunca chega a chamar `publishCompletionMarker` — não existe marcador para essa tentativa. Isso é o comportamento correto: ausência de marcador == não verificado, exatamente como a reprodução (seção acima) mostrou ser necessário.
- **Marcador obsoleto de uma execução anterior:** `invalidateStaleMarker(outputDir)` é chamada no **início** de `main()` em `runFinalHybridBattery.js`, logo depois da checagem de fingerprint do `execution-config.json` (que já impede reusar `HYBRID_OUT_DIR` com uma configuração incompatível — comportamento preexistente, não alterado). Se já existir um `completion-marker.json` no diretório, ele é renomeado para `completion-marker.json.superseded-<timestamp>-<pid>.json` (arquivado, nunca apagado) antes de qualquer trabalho novo começar. Assim, enquanto esta execução está em andamento — inclusive se ela travar de novo — o caminho canônico nunca contém um `completed: true` que pertence a uma tentativa anterior.
- **Retomada de uma execução interrompida:** não precisa de nenhum tratamento especial no marcador. O checkpoint e a lógica de cache (`checkedCall`/`allowPriorImport`, inalterados) já garantem que uma retomada não repete trabalho válido; quando a retomada finalmente processa tudo que faltava, `publishCompletionMarker` roda a mesma validação completa de uma execução do zero — contando o que está em disco, não confiando em nenhum estado herdado de uma tentativa anterior.

### Interação com P0.3 (pool de workers)

A publicação do marcador acontece **depois** do bloco `try/catch/finally` que envolve `runWorkerPool(...)` (corrigido em P0.3) e é condicionada a `!stoppedByCost && !stopRequested`. Isso significa: (a) o pool de workers continua exatamente como a correção P0.3 o deixou — nenhuma linha do laço de workers, de `workerPool.js` ou da chamada a `runWorkerPool` em `runFinalHybridBattery.js` foi tocada; (b) o encerramento automático que P0.3 corrigiu (o `Promise.all` resolvendo quando a fila acaba, mesmo com workers desativados) é justamente o que permite ao fluxo chegar até a publicação do marcador sem `Ctrl-C` — P0.4 depende do comportamento corrigido em P0.3, mas não o modifica.

## Testes automatizados criados

`whatsapp-bot/test/battery/finalizationMarker.test.js` — **22 testes unitários**, sem I/O de rede, em diretórios temporários isolados (`fs.mkdtempSync`), cobrindo exatamente os cenários pedidos:

1. execução completamente finalizada (marcador publicado, contagens e hashes corretos);
2. fila vazia válida (0 conversas/turnos/chamadas, marcador publicado normalmente);
3. resultado incompleto (`complete: false`) — bloqueado (`incomplete-result`);
4. checkpoint malformado e checkpoint ausente — bloqueados (`checkpoint-malformed`, `checkpoint-missing`);
5. divergência de contagens (conversas, turnos, chamadas lógicas) — 3 testes, cada um com seu motivo específico;
6. referência de chamada lógica pendurada (persistida no resultado, ausente do checkpoint) e resultado de conversa não persistido em disco — 2 testes;
7. summary ausente, corrompido e de outra execução (fingerprint diferente) — 3 testes;
8. proxy não fechado — bloqueado (`proxy-not-closed`);
9. workers não terminados normalmente — bloqueado mesmo com todo o resto consistente;
10. retomada de execução interrompida — primeira tentativa parcial rejeitada, segunda tentativa (depois de completar o que faltava) publica o marcador normalmente;
11. marcador obsoleto — arquivado (não apagado), caminho canônico fica ausente até nova publicação;
12. verificação dos hashes registrados — `verifyCompletionMarker` detecta adulteração de um resultado feita **depois** da publicação, sem depender do conteúdo do próprio marcador para essa detecção;
13. atomicidade da publicação — falha forçada no `rename` (caminho final ocupado por um diretório) não deixa conteúdo parcial nem arquivo temporário órfão; mais um teste de idempotência (publicar de novo sobre um estado inalterado produz o mesmo conteúdo, exceto `completedAt`) e um teste do hash agregado de `results/` mudando com o conteúdo.

`whatsapp-bot/test/battery/finalizationMarkerIntegration.test.js` — **5 testes de integração**, executando `finalizationMarkerIntegrationRunner.mjs` em **processo filho separado** (sem mock no controle de fluxo), com fila sintética, diretório temporário isolado e "respostas de API" simuladas por atraso (nenhuma chamada de rede real):

1. caminho feliz: `runWorkerPool` real → summary real → proxy fake real → `publishCompletionMarker` real, terminando com **exit code 0** e marcador válido em disco;
2. falha simulada na gravação do summary final → **exit code != 0**, marcador ausente;
3. falha simulada no fechamento do proxy, mesmo com toda a fila processada e persistida → **exit code != 0**, marcador ausente;
4. checkpoint inconsistente introduzido *depois* do fechamento normal (summary e proxy OK) → barrado pela validação cruzada do marcador (`dangling-checkpoint-reference`), não pelo controle de fluxo do harness → **exit code != 0**, marcador ausente;
5. execução do mesmo diretório duas vezes seguidas → o marcador da primeira execução é arquivado (`completion-marker.json.superseded-*`) antes da segunda rodar, e a segunda publica um marcador fresco.

## Resultados dos testes e da integração

- Reprodução do problema no código anterior: `execution-summary.json` reescrito 6 vezes numa fila de 5 itens, checkpoint já "parecendo completo" antes do `finally` rodar, nenhum campo de conclusão verificada em nenhum ponto — confirmado.
- `whatsapp-bot/test/battery/finalizationMarker.test.js`: **22/22 testes passaram.**
- `whatsapp-bot/test/battery/finalizationMarkerIntegration.test.js`: **5/5 testes passaram**, todos com o processo filho terminando com o exit code esperado (0 no caminho feliz, != 0 em cada cenário de falha) e sem timeout de segurança acionado.
- Suíte completa do bot (`npm test` em `whatsapp-bot`): **74/74 testes passaram** — os 47 anteriores (incluindo `historicalRelativeDates.test.js` do P0.1, `movingDateEventSeparation.test.js` do P0.2, e `workerPool.test.js`/`workerPoolIntegration.test.js` do P0.3, todos sem alteração de comportamento) mais os 22 + 5 novos desta correção.
- Raiz do projeto (Next.js/CRM): `npm run lint` — sem avisos ou erros; `npm run build` — concluído com sucesso, incluindo checagem de tipos (Next.js roda `tsc` como parte do build). `git diff --check` — sem problemas de espaço em branco. Nenhum deploy ou reinício de serviço foi executado.

## Evidências da integração real do harness

O teste de integração 1 (`integração real: caminho feliz publica o marcador com exit code 0`) executa, em processo separado, exatamente a sequência que `runFinalHybridBattery.js` usa hoje: `runWorkerPool` (módulo real de P0.3, sem mock) → `writeSummary(extra)` → `proxy.close()` (dentro do mesmo `try/finally`) → `publishCompletionMarker` (só alcançado se nada acima lançou). Com 6 tarefas sintéticas, concorrência inicial 1 e 10 workers (a mesma configuração da retomada final da bateria canônica): o processo processa e persiste as 6 conversas e 12 chamadas lógicas (2 por turno), termina sozinho com exit code 0, e o `completion-marker.json` resultante tem `completed: true`, contagens batendo (6/6/12) e os 6 hashes de artefato presentes. Os 3 testes de falha controlada (summary, proxy, checkpoint) provam que, mesmo com a fila inteira processada e persistida com sucesso, uma falha em qualquer uma das etapas restantes impede o marcador — nenhum deles produziu `completed: true`.

## Verificação de integridade dos datasets

Hashes SHA-256 agregados de `export/` e `export-marcia/` (todos os arquivos `.json`, ordenados por caminho, `sha256sum` por arquivo e depois `sha256sum` da lista) calculados **antes** de qualquer alteração desta correção e **depois** de toda a implementação, testes, lint e build:

- `export/` antes: `9719fc4c2c2ed53cec0dbde8b7e195f8d8a0563ce612b5cffa82b25326e38ec9`
- `export/` depois: **idêntico**
- `export-marcia/` antes: `e1dc0adfa259638337e696139af1c982e86f453f1c6f9be07e978e5743a32878`
- `export-marcia/` depois: **idêntico**

Nenhum byte dos datasets foi alterado. Os artefatos da execução `final-full-15a92cc` (`checkpoint.jsonl`, `api-attempts.jsonl`, `execution-summary.json`, `execution-config.json`, `empty-conversations.json`, `results/`) **não existem no ambiente de trabalho local** desta sessão — mesma limitação já registrada em `docs/correcoes/03_TRAVAMENTO_WORKERS_OCIOSOS.md`: apenas o relatório final que os descreve e registra seus hashes (seção 11) está presente. Como não há artefatos locais para reler, a garantia de integridade para eles é: (a) esta correção não executou nenhuma leitura, escrita ou remoção em qualquer caminho contendo `final-full-15a92cc`; (b) `git status` confirma que nenhum arquivo fora do listado em "Arquivos modificados" foi tocado; (c) os hashes já registrados na seção 11 do relatório permanecem exatamente como estavam — a seção 11 não foi editada por esta correção.

Todos os testes desta correção escreveram exclusivamente em diretórios temporários próprios (`fs.mkdtempSync` sob `os.tmpdir()`), removidos ao final de cada teste (`fs.rmSync(..., { recursive: true, force: true })`); os processos filho dos testes de integração rodaram sob timeout externo (`execFileSync({ timeout })`), garantindo que nenhum processo órfão sobrevivesse mesmo em caso de falha.

## Limitações e riscos residuais

- **O marcador não substitui a execução canônica histórica.** `final-full-15a92cc` foi encerrada por `Ctrl-C` e permanece registrada assim (seção 1 do relatório); esta correção não gera retroativamente um `completion-marker.json` para aquela execução, pois seus artefatos não estão disponíveis neste ambiente e a tarefa proíbe explicitamente completar ou alterar artificialmente a execução original. O marcador vale para execuções futuras do harness.
- **O polling de `invalidateStaleMarker` não é atômico em relação a uma segunda execução concorrente no mesmo diretório.** Duas instâncias do harness rodando simultaneamente sobre o mesmo `HYBRID_OUT_DIR` já não são suportadas por nenhuma parte do harness hoje (checkpoint, config, etc. também não têm lock entre processos); isso não é um risco novo introduzido por esta correção, e o uso pretendido (um processo por diretório de saída) já é a única forma suportada de operar o harness.
- **A integração real (teste de integração) usa uma fila sintética pequena (até 6 itens) e respostas simuladas por atraso**, não os datasets/API reais — restrição explícita do escopo autorizado desta correção (proibição de rodar uma nova bateria integral). A correção também foi validada por leitura de código linha a linha do ponto de chamada em `runFinalHybridBattery.js`.
- **Hashes de artefatos não protegem contra adulteração no mesmo instante da publicação** — só contra adulteração posterior (é exatamente o que `verifyCompletionMarker` detecta, e o teste 12 comprova). Isso é uma limitação inerente a qualquer hash calculado uma vez, não específica desta implementação.
- Não foi executada uma nova bateria real de milhares de conversas para observar a publicação do marcador em escala real; isso está fora do escopo autorizado desta tarefa.

## Status final

**P0.4: CONCLUÍDO.**

Todos os critérios de conclusão foram atendidos: o comportamento anterior foi comprovado por reprodução executável (não apenas por leitura de código) mostrando ausência de qualquer marcador atômico e um checkpoint que já "parecia completo" antes do `finally` rodar; a causa raiz foi identificada linha a linha; o marcador atômico foi implementado com as 7 condições de publicação pedidas, escrita atômica (temp + rename no mesmo sistema de arquivos) e limpeza de temporário órfão em caso de falha; a publicação depois de uma execução válida foi demonstrada pela integração real (exit code 0, marcador com `completed: true`, contagens e hashes corretos); cenários de falha (summary, proxy, checkpoint inconsistente, workers não terminados, contagens divergentes, resultado incompleto, referência pendurada, marcador ausente/corrompido/de outra execução) foram demonstrados não produzindo `completed: true`, tanto nos testes unitários quanto na integração real; a suíte de testes do bot (74/74), lint e build da raiz passaram; as correções P0.1, P0.2 e P0.3 continuam passando integralmente e sem alteração; comportamento de retomada e de marcador obsoleto foi definido e testado; e os datasets/artefatos históricos disponíveis permaneceram intactos, com a limitação de ausência dos artefatos de `final-full-15a92cc` registrada explicitamente, não afirmada como verificada.
