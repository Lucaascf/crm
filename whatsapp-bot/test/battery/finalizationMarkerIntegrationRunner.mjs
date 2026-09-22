// Executado como PROCESSO SEPARADO por finalizationMarkerIntegration.test.js.
// Reproduz, em miniatura e com dados sintéticos, o fluxo REAL de
// finalização de runFinalHybridBattery.js na ordem exata em que ele
// acontece lá: runWorkerPool -> writeSummary(extra) -> proxy.close() (tudo
// dentro de um try/finally) -> só então, se nada foi interrompido,
// publishCompletionMarker(...). Usa os módulos reais workerPool.js e
// finalizationMarker.js (sem mock), sem tocar em export/, export-marcia/
// nem qualquer conta do WhatsApp, e sem nenhuma chamada de API real (a
// "resposta da API" é simulada por um atraso, como no runner de integração
// do P0.3).
//
// Modo de falha controlado via argv[6] (`failureMode`), para provar que
// nenhum deles produz completed: true:
//   - "none": caminho feliz, marcador deve ser publicado.
//   - "summary-write": writeSummary força uma exceção (simula falha de
//     gravação do summary) — deve interromper ANTES do proxy fechar e do
//     marcador ser publicado.
//   - "proxy-close": proxy.close() lança — deve impedir o marcador mesmo
//     com summary já gravado e toda a fila processada.
//   - "checkpoint-drop": depois que os workers terminam e o summary/proxy
//     fecham normalmente, uma linha do checkpoint é removida antes da
//     publicação — simula persistência inconsistente do checkpoint e deve
//     ser barrada pela validação cruzada do marcador (não pelo controle de
//     fluxo do harness).
import fs from 'node:fs'
import path from 'node:path'
import { runWorkerPool } from './workerPool.js'
import { invalidateStaleMarker, publishCompletionMarker } from './finalizationMarker.js'

const [, , outDir, taskCountArg, initialConcurrencyArg, workerCountArg, failureModeArg] = process.argv
if (!outDir) throw new Error('uso: finalizationMarkerIntegrationRunner.mjs <outDir> [taskCount] [initialConcurrency] [workerCount] [failureMode]')

const taskCount = Number.parseInt(taskCountArg ?? '6', 10)
const workerCount = Number.parseInt(workerCountArg ?? '10', 10)
const failureMode = failureModeArg || 'none'

const checkpointPath = path.join(outDir, 'checkpoint.jsonl')
const summaryPath = path.join(outDir, 'execution-summary.json')
const configPath = path.join(outDir, 'execution-config.json')
const usageLogPath = path.join(outDir, 'api-attempts.jsonl')
const emptyConversationsPath = path.join(outDir, 'empty-conversations.json')
const resultsDir = path.join(outDir, 'results')
const dataset = 'sintetico'
const fingerprint = 'fingerprint-integracao-p04'

fs.mkdirSync(path.join(resultsDir, dataset), { recursive: true })

function atomicWrite(file, value) {
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, JSON.stringify(value, null, 2))
  fs.renameSync(temp, file)
}

const config = { fingerprint, commit: 'integracao', codeHash: 'integracao', datasetHashes: { [dataset]: 'integracao' }, model: 'gpt-4o-mini-mock', temperature: 0, costCapUsd: 7.5, dryRun: true }
atomicWrite(configPath, config)
fs.writeFileSync(usageLogPath, '')
atomicWrite(emptyConversationsPath, { count: 0, conversations: [] })

const staleMarker = invalidateStaleMarker(outDir)
if (staleMarker) console.log(`marcador anterior arquivado em ${staleMarker}`)

async function main() {
  let desiredConcurrency = Number.parseInt(initialConcurrencyArg ?? '1', 10)
  let stopRequested = false
  let completedConversations = 0

  const scaleTimer = setTimeout(() => { desiredConcurrency = Math.min(workerCount, Math.max(desiredConcurrency, 4)) }, 60)
  scaleTimer.unref?.()

  async function processOne(index) {
    // "Resposta de API simulada": nenhuma chamada de rede real, só um
    // atraso pequeno no lugar de extractClientInfo/extractMovingDate.
    await new Promise((resolve) => setTimeout(resolve, 10 + Math.floor(Math.random() * 15)))
    const extractionCacheKey = `extract-${index}`
    const dateCacheKey = `date-${index}`
    fs.appendFileSync(checkpointPath, `${JSON.stringify({ cacheKey: extractionCacheKey, status: 'success' })}\n`)
    fs.appendFileSync(checkpointPath, `${JSON.stringify({ cacheKey: dateCacheKey, status: 'success' })}\n`)
    atomicWrite(path.join(resultsDir, dataset, `conversa-${index}.json`), {
      dataset, file: `conversa-${index}.json`, processedTurns: 1, complete: true,
      turnResults: [{ turnIndex: 0, extractionCacheKey, dateCacheKey }],
    })
    completedConversations++
  }

  let stoppedByCost = false
  const proxy = {
    close: async () => {
      if (failureMode === 'proxy-close') throw new Error('falha simulada ao fechar o proxy')
    },
  }
  function writeSummary(extra = {}) {
    if (failureMode === 'summary-write') throw new Error('falha simulada ao gravar o summary final')
    atomicWrite(summaryPath, { fingerprint, updatedAt: new Date().toISOString(), ...extra })
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
    writeSummary({ completedConversations, scheduledConversations: taskCount, stoppedByCost })
    await proxy.close()
  }

  if (failureMode === 'checkpoint-drop') {
    // O harness terminou normalmente (workers, summary, proxy) — a falha é
    // de integridade dos DADOS persistidos, detectável só pela validação
    // cruzada do marcador, não pelo controle de fluxo acima.
    const lines = fs.readFileSync(checkpointPath, 'utf8').trim().split('\n')
    fs.writeFileSync(checkpointPath, `${lines.filter((line) => !line.includes('"extract-0"')).join('\n')}\n`)
  }

  const marker = await publishCompletionMarker({
    outputDir: outDir,
    fingerprint,
    config,
    workersEndedNormally: true,
    proxyClosed: true,
    checkpointPath,
    usageLogPath,
    summaryPath,
    configPath,
    resultsDir,
    datasets: [dataset],
    emptyConversationsPath,
    expectedConversations: taskCount,
    expectedTurns: taskCount,
    expectedLogicalCalls: taskCount * 2,
  })
  console.log(`marcador publicado: ${JSON.stringify({ completed: marker.completed, conversations: marker.conversations, turns: marker.turns, logicalCalls: marker.logicalCalls })}`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
