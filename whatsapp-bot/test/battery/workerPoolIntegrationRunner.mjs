// Executado como PROCESSO SEPARADO pelo teste de integração
// (workerPoolIntegration.test.js). Reproduz, em miniatura e com dados
// sintéticos, o mesmo fluxo de runFinalHybridBattery.js em torno do pool de
// workers: checkpoint incremental, resultados atômicos por tarefa,
// concorrência inicial 1, escalonamento dinâmico, fechamento de "proxy" no
// finally e escrita do summary final — SEM usar os datasets reais, SEM
// chamada de rede real (a "API" é simulada com um atraso), e escrevendo
// tudo em um diretório temporário isolado passado por argumento.
import fs from 'node:fs'
import path from 'node:path'
import { runWorkerPool } from './workerPool.js'

const [, , outDir, taskCountArg, initialConcurrencyArg, workerCountArg] = process.argv
if (!outDir) throw new Error('uso: workerPoolIntegrationRunner.mjs <outDir> [taskCount] [initialConcurrency] [workerCount]')

const taskCount = Number.parseInt(taskCountArg ?? '9', 10)
const workerCount = Number.parseInt(workerCountArg ?? '10', 10)

const checkpointPath = path.join(outDir, 'checkpoint.jsonl')
const summaryPath = path.join(outDir, 'execution-summary.json')
const resultsDir = path.join(outDir, 'results')
const proxyClosedMarker = path.join(outDir, 'proxy-closed.marker')

fs.mkdirSync(resultsDir, { recursive: true })

function atomicWrite(file, value) {
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(value, null, 2))
  fs.renameSync(temp, file)
}

// Simula o proxy de gravação HTTP real (recordingProxy/mockOpenAi): não abre
// nenhuma porta nem faz chamada de rede, só expõe close() como o harness
// real usa no finally.
function startFakeProxy() {
  let closed = false
  return {
    close: async () => {
      closed = true
      fs.writeFileSync(proxyClosedMarker, new Date().toISOString())
    },
    isClosed: () => closed,
  }
}

async function main() {
  const proxy = startFakeProxy()
  // Igual ao harness real: concorrência inicial configurável, teto de 10
  // workers, mutável durante a execução (rate limiting adaptativo).
  let desiredConcurrency = Number.parseInt(initialConcurrencyArg ?? '1', 10)
  let stopRequested = false
  let completedConversations = 0

  // Escalonamento dinâmico simulado: depois de algumas tarefas concluídas,
  // sobe a concorrência — igual ao setConcurrency() real reagindo a
  // métricas de TPM/RPM, mas aqui disparado por tempo simulado.
  const scaleTimer = setTimeout(() => { desiredConcurrency = Math.min(workerCount, Math.max(desiredConcurrency, 4)) }, 60)
  scaleTimer.unref?.()

  async function processOne(index) {
    // "Resposta de API simulada": nenhuma chamada de rede real, só um
    // atraso pequeno representando a latência de extractClientInfo/
    // extractMovingDate.
    await new Promise((resolve) => setTimeout(resolve, 15 + Math.floor(Math.random() * 20)))
    const record = { index, status: 'success', completedAt: new Date().toISOString() }
    fs.appendFileSync(checkpointPath, `${JSON.stringify(record)}\n`)
    atomicWrite(path.join(resultsDir, `conversation-${index}.json`), record)
    completedConversations++
  }

  try {
    await runWorkerPool({
      workerCount,
      taskCount,
      getConcurrency: () => desiredConcurrency,
      isStopped: () => stopRequested,
      stop: () => { stopRequested = true },
      runTask: (index) => processOne(index),
    })
  } finally {
    atomicWrite(summaryPath, {
      completedConversations,
      scheduledConversations: taskCount,
      completed: completedConversations === taskCount,
      finishedAt: new Date().toISOString(),
    })
    await proxy.close()
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
