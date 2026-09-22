// Testes de regressão para o defeito P0.3 (travamento de workers ociosos
// após a fila acabar). Ver docs/correcoes/03_TRAVAMENTO_WORKERS_OCIOSOS.md.
//
// Não usam os datasets reais (export/export-marcia) nem chamam a API da
// OpenAI: só exercitam o pool de workers com filas sintéticas pequenas.
// Cada teste tem um timeout curto do próprio runner de testes do Node, que
// falha o teste em vez de travar o processo indefinidamente se a correção
// regredir.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runWorkerPool } from './workerPool.js'

const WATCHDOG_MS = 5_000

test('concorrência inicial 1 com vários workers criados: todos terminam quando a fila acaba', { timeout: WATCHDOG_MS }, async () => {
  const taskCount = 5
  let desiredConcurrency = 1 // reproduz HYBRID_INITIAL_CONCURRENCY=1
  const processed = []

  await runWorkerPool({
    workerCount: 10, // mais de um worker criado, igual à bateria real
    taskCount,
    getConcurrency: () => desiredConcurrency,
    isStopped: () => false,
    stop: () => {},
    runTask: async (index) => {
      await new Promise((resolve) => setTimeout(resolve, 5))
      processed.push(index)
    },
    pollIntervalMs: 10,
  })

  assert.equal(processed.length, taskCount, 'todas as tarefas da fila pequena e finita devem ser processadas')
  assert.deepEqual([...processed].sort((a, b) => a - b), [0, 1, 2, 3, 4])
})

test('fila vazia: todos os workers retornam imediatamente', { timeout: WATCHDOG_MS }, async () => {
  const started = []
  await runWorkerPool({
    workerCount: 10,
    taskCount: 0,
    getConcurrency: () => 1,
    isStopped: () => false,
    stop: () => {},
    runTask: async (index) => { started.push(index) },
    pollIntervalMs: 10,
  })
  assert.equal(started.length, 0)
})

test('fila com apenas uma tarefa', { timeout: WATCHDOG_MS }, async () => {
  let count = 0
  await runWorkerPool({
    workerCount: 10,
    taskCount: 1,
    getConcurrency: () => 1,
    isStopped: () => false,
    stop: () => {},
    runTask: async () => { count++ },
    pollIntervalMs: 10,
  })
  assert.equal(count, 1)
})

test('fila com menos tarefas do que workers (concorrência alta)', { timeout: WATCHDOG_MS }, async () => {
  const processed = new Set()
  await runWorkerPool({
    workerCount: 10,
    taskCount: 3,
    getConcurrency: () => 10, // todos os 10 workers ativos desde o início
    isStopped: () => false,
    stop: () => {},
    runTask: async (index) => { processed.add(index) },
    pollIntervalMs: 10,
  })
  assert.deepEqual([...processed].sort((a, b) => a - b), [0, 1, 2])
})

test('fila com várias tarefas e concorrência inicial superior a 1', { timeout: WATCHDOG_MS }, async () => {
  const taskCount = 37
  const processed = []
  await runWorkerPool({
    workerCount: 8,
    taskCount,
    getConcurrency: () => 5,
    isStopped: () => false,
    stop: () => {},
    runTask: async (index) => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 5))
      processed.push(index)
    },
    pollIntervalMs: 10,
  })
  assert.equal(processed.length, taskCount)
  // cada tarefa processada exatamente uma vez (sem retry neste cenário)
  assert.deepEqual([...processed].sort((a, b) => a - b), Array.from({ length: taskCount }, (_, i) => i))
})

test('workers temporariamente desativados: reativação dinâmica depois de escalar concorrência', { timeout: WATCHDOG_MS }, async () => {
  const taskCount = 12
  let desiredConcurrency = 1
  const processed = []
  const pool = runWorkerPool({
    workerCount: 10,
    taskCount,
    getConcurrency: () => desiredConcurrency,
    isStopped: () => false,
    stop: () => {},
    runTask: async (index) => {
      await new Promise((resolve) => setTimeout(resolve, 15))
      processed.push(index)
    },
    pollIntervalMs: 10,
  })
  // Simula o escalonamento adaptativo do harness real (setConcurrency).
  await new Promise((resolve) => setTimeout(resolve, 30))
  desiredConcurrency = 5
  await pool
  assert.equal(processed.length, taskCount, 'workers reativados devem processar o restante da fila')
})

test('tarefas ainda em execução quando a fila já foi distribuída: nenhuma chamada é abandonada', { timeout: WATCHDOG_MS }, async () => {
  const taskCount = 4
  let inFlight = 0
  let maxInFlight = 0
  const finished = []
  await runWorkerPool({
    workerCount: 4,
    taskCount,
    getConcurrency: () => 4,
    isStopped: () => false,
    stop: () => {},
    runTask: async (index) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      // As últimas tarefas já foram distribuídas (nextIndex chegou ao fim)
      // enquanto esta ainda está "em voo" — o pool deve esperar por ela.
      await new Promise((resolve) => setTimeout(resolve, 40))
      inFlight--
      finished.push(index)
    },
    pollIntervalMs: 10,
  })
  assert.equal(finished.length, taskCount, 'nenhuma tarefa em execução pode ser abandonada quando a fila termina')
  assert.equal(inFlight, 0, 'todas as chamadas em voo devem ter terminado antes do pool retornar')
})

test('encerramento normal após a última tarefa, mesmo com workers desativados', { timeout: WATCHDOG_MS }, async () => {
  const taskCount = 2
  const desiredConcurrency = 1
  const finishedAt = Date.now()
  await runWorkerPool({
    workerCount: 10, // 9 workers ficam desativados o tempo todo
    taskCount,
    getConcurrency: () => desiredConcurrency,
    isStopped: () => false,
    stop: () => {},
    runTask: async () => { await new Promise((resolve) => setTimeout(resolve, 5)) },
    pollIntervalMs: 10,
  })
  // Se chegamos aqui sem o watchdog do runner de testes disparar, o
  // Promise.all interno resolveu normalmente — os 9 workers ociosos
  // retornaram assim que a fila esgotou, e não ficaram presos.
  assert.ok(Date.now() - finishedAt < WATCHDOG_MS)
})

test('parada controlada (stop): tarefas ainda não iniciadas não são processadas, mas nada em voo é descartado', { timeout: WATCHDOG_MS }, async () => {
  const taskCount = 10
  let stopRequested = false
  const started = []
  const finished = []
  await runWorkerPool({
    workerCount: 3,
    taskCount,
    getConcurrency: () => 3,
    isStopped: () => stopRequested,
    stop: () => { stopRequested = true },
    runTask: async (index) => {
      started.push(index)
      if (index === 1) {
        // Simula o CostLimitReached do harness real: a chamada corrente
        // termina normalmente (nada é abortado no meio), mas nenhuma nova
        // tarefa deve ser iniciada depois.
        stopRequested = true
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
      finished.push(index)
    },
    pollIntervalMs: 10,
  })
  assert.ok(started.length < taskCount, 'parada controlada deve impedir que toda a fila seja processada')
  assert.equal(started.length, finished.length, 'toda tarefa iniciada antes da parada deve terminar (nada abandonado em voo)')
})

test('erro fatal (isFatal) interrompe o pool via stop(), sem relançar para o chamador', { timeout: WATCHDOG_MS }, async () => {
  class FatalError extends Error {}
  let stopRequested = false
  const started = []
  await runWorkerPool({
    workerCount: 4,
    taskCount: 20,
    getConcurrency: () => 4,
    isStopped: () => stopRequested,
    stop: () => { stopRequested = true },
    runTask: async (index) => {
      started.push(index)
      if (started.length === 3) throw new FatalError('limite atingido')
    },
    isFatal: (error) => error instanceof FatalError,
    pollIntervalMs: 10,
  })
  assert.ok(stopRequested, 'stop() deve ter sido chamado pelo pool ao ver um erro fatal')
  assert.ok(started.length < 20, 'nem toda a fila deveria ter sido iniciada após o erro fatal')
})

test('erro não-fatal se propaga para o chamador (Promise.all rejeita)', { timeout: WATCHDOG_MS }, async () => {
  class RegularError extends Error {}
  await assert.rejects(
    runWorkerPool({
      workerCount: 2,
      taskCount: 5,
      getConcurrency: () => 2,
      isStopped: () => false,
      stop: () => {},
      runTask: async () => { throw new RegularError('falha comum') },
      isFatal: () => false,
      pollIntervalMs: 10,
    }),
    RegularError,
  )
})
