// Pool de workers com concorrência dinâmica ajustável em tempo real, usado
// por runFinalHybridBattery.js. Extraído para módulo isolado para permitir
// teste de regressão sem depender dos datasets reais (export/export-marcia)
// nem de chamadas de API — ver docs/correcoes/03_TRAVAMENTO_WORKERS_OCIOSOS.md.
//
// Contrato preservado do harness original:
//  - até `workerCount` workers são criados de uma vez (Promise.all);
//  - só processam tarefas os workers com `workerId < getConcurrency()`;
//  - a concorrência pode subir/descer a qualquer momento (rate limiting
//    adaptativo do chamador) sem que o pool seja recriado;
//  - `stop()` interrompe a distribuição de novas tarefas assim que possível;
//    quem chama `runTask` é responsável por deixar a chamada em andamento
//    terminar (nenhuma chamada em voo é abandonada por este módulo);
//  - quando a fila acaba, TODO worker retorna normalmente — inclusive os
//    que estão desativados (workerId >= concorrência atual) — para que o
//    `Promise.all` resolva e o `finally` de quem chamou rode.
export async function runWorkerPool({
  workerCount,
  taskCount,
  getConcurrency,
  isStopped,
  stop,
  runTask,
  isFatal = () => false,
  pollIntervalMs = 250,
}) {
  let nextIndex = 0
  async function worker(workerId) {
    while (!isStopped()) {
      while (!isStopped() && workerId >= getConcurrency()) {
        // Correção P0.3: um worker desativado (acima da concorrência atual)
        // não deve esperar indefinidamente — se a fila já acabou, não há
        // razão para reativá-lo, então ele termina normalmente aqui.
        if (nextIndex >= taskCount) return
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
      }
      if (isStopped()) return
      const index = nextIndex++
      if (index >= taskCount) return
      try {
        await runTask(index)
      } catch (error) {
        if (isFatal(error)) {
          stop()
          return
        }
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: workerCount }, (_, workerId) => worker(workerId)))
}
