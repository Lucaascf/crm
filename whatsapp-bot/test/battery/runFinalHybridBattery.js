import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { loadConversations, groupIntoTurns } from './loadConversations.js'
import { startRecordingProxy, estimateCostUsd } from '../support/recordingProxy.js'
import { startMockOpenAi } from '../support/mockOpenAi.js'
import { runWorkerPool } from './workerPool.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const botRoot = path.resolve(__dirname, '../..')
const repoRoot = path.resolve(botRoot, '..')
const MODEL = 'gpt-4o-mini'
const COST_CAP_USD = Number(process.env.HYBRID_COST_CAP_USD || 7.50)
const DRY_RUN = process.env.HYBRID_DRY_RUN === 'true'
const MAX_CONVERSATIONS = Number(process.env.HYBRID_MAX_CONVERSATIONS || 0)
const outputDir = process.env.HYBRID_OUT_DIR || path.resolve(__dirname, 'out/final-full-15a92cc')
const priorOutputDir = path.resolve(__dirname, 'out/final-hybrid-15a92cc')
const checkpointPath = path.join(outputDir, 'checkpoint.jsonl')
const usageLogPath = path.join(outputDir, 'api-attempts.jsonl')
const configPath = path.join(outputDir, 'execution-config.json')
const summaryPath = path.join(outputDir, 'execution-summary.json')

if (!DRY_RUN && process.env.HYBRID_REAL_API_CONFIRMED !== 'yes') {
  throw new Error('Execução real bloqueada: defina HYBRID_REAL_API_CONFIRMED=yes após autorização explícita.')
}
if (!DRY_RUN && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY ausente.')
if (!Number.isFinite(COST_CAP_USD) || COST_CAP_USD <= 0 || COST_CAP_USD > 7.50) {
  throw new Error('HYBRID_COST_CAP_USD deve estar entre 0 e 7.50.')
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const stableJson = (value) => JSON.stringify(value, Object.keys(value).sort())
const atomicWrite = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(temp, file)
}

function directoryHash(dir) {
  const hash = crypto.createHash('sha256')
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort()) {
    hash.update(file)
    hash.update('\0')
    hash.update(fs.readFileSync(path.join(dir, file)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function relevantCodeHash() {
  const hash = crypto.createHash('sha256')
  for (const relative of ['src/ai.js', 'src/apiRetry.js', 'src/extractionPolicy.js']) {
    hash.update(relative)
    hash.update('\0')
    hash.update(fs.readFileSync(path.join(botRoot, relative)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

function readGitHead(root) {
  const gitPath = path.join(root, '.git')
  const gitDir = fs.statSync(gitPath).isDirectory()
    ? gitPath
    : path.resolve(root, fs.readFileSync(gitPath, 'utf8').trim().replace(/^gitdir:\s*/, ''))
  const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim()
  if (!head.startsWith('ref: ')) return head
  return fs.readFileSync(path.join(gitDir, head.slice(5)), 'utf8').trim()
}

function readCheckpoint(file = checkpointPath) {
  const records = new Map()
  if (!fs.existsSync(file)) return records
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    const record = JSON.parse(line)
    records.set(record.cacheKey, record)
  }
  return records
}

function readJsonLines(file) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line))
}

function aggregateRecords(records, usageAttempts) {
  const cost = estimateCostUsd(usageAttempts)
  const locallyAttempted = [...records.values()].filter((record) => !record.importedFrom).length
  return {
    ...cost,
    logicalCalls: [...records.values()].filter((record) => record.status === 'success').length,
    failedLogicalCalls: [...records.values()].filter((record) => record.status === 'error').length,
    importedLogicalCalls: records.size - locallyAttempted,
    httpAttempts: usageAttempts.length,
    retries: Math.max(0, usageAttempts.length - locallyAttempted),
    apiErrors: usageAttempts.filter((attempt) => attempt.status >= 400).length,
  }
}

function applyExtraction(client, extracted, movingDate) {
  return {
    ...client,
    ...(extracted.clientName ? { name: extracted.clientName, nameConfirmed: true } : {}),
    clientNickname: extracted.clientNickname,
    originAddress: extracted.originAddress,
    destinationAddress: extracted.destinationAddress,
    propertyType: extracted.propertyType,
    movingNotes: extracted.movingNotes,
    commercialNotes: extracted.commercialNotes,
    stairsOrElevator: extracted.stairsOrElevator,
    truckAccess: extracted.truckAccess,
    vistoriaResolved: extracted.vistoriaResolved,
    vistoriaType: extracted.vistoriaType,
    movingDate: movingDate || client.movingDate || null,
  }
}

const BASE_STATE = {
  name: null,
  nameConfirmed: false,
  clientNickname: null,
  originAddress: null,
  destinationAddress: null,
  propertyType: null,
  movingNotes: null,
  commercialNotes: null,
  stairsOrElevator: null,
  truckAccess: null,
  vistoriaResolved: false,
  vistoriaType: null,
  movingDate: null,
}

class CostLimitReached extends Error {}

async function main() {
  const commit = readGitHead(repoRoot)
  const datasets = [
    { name: 'export', dir: path.join(botRoot, 'export') },
    { name: 'export-marcia', dir: path.join(botRoot, 'export-marcia') },
  ]
  const datasetHashes = Object.fromEntries(datasets.map((dataset) => [dataset.name, directoryHash(dataset.dir)]))
  const codeHash = relevantCodeHash()
  const fingerprint = sha256(JSON.stringify({ kind: 'full-turn-replay-v1', commit, codeHash, datasetHashes, model: MODEL }))
  const config = {
    createdAt: new Date().toISOString(),
    commit,
    codeHash,
    datasetHashes,
    fingerprint,
    model: MODEL,
    temperature: 0,
    costCapUsd: COST_CAP_USD,
    dryRun: DRY_RUN,
    plannedConversations: 885,
    plannedReplayConversations: 885,
    plannedLogicalCalls: 13694,
    pricesPerMillion: { input: 0.15, cachedInput: 0.075, output: 0.60 },
    note: 'Sem geração de resposta, sem WhatsApp, sem banco de produção e sem deploy.',
  }
  fs.mkdirSync(outputDir, { recursive: true })
  if (fs.existsSync(configPath)) {
    const previous = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    if (previous.fingerprint !== fingerprint) throw new Error('Checkpoint pertence a outra configuração; use outro HYBRID_OUT_DIR.')
  } else atomicWrite(configPath, config)

  const records = readCheckpoint()
  const priorRecords = readCheckpoint(path.join(priorOutputDir, 'checkpoint.jsonl'))
  const priorByInput = new Map()
  for (const record of priorRecords.values()) {
    if (record.status !== 'success') continue
    const key = [record.dataset, record.file, record.phase, record.turnIndex, record.historyHash, record.task].join('\0')
    priorByInput.set(key, record)
  }
  const usageAttempts = readJsonLines(usageLogPath)
  const priorAttempts = readJsonLines(path.join(priorOutputDir, 'api-attempts.jsonl'))
  const priorCost = estimateCostUsd(priorAttempts)
  let observeHttp = () => {}
  let throttleForward = async () => {}
  const proxy = DRY_RUN
    ? await startMockOpenAi()
    : await startRecordingProxy({
      onCall: (call) => {
        fs.appendFileSync(usageLogPath, `${JSON.stringify(call)}\n`)
        usageAttempts.push(call)
        observeHttp(call)
      },
      beforeForward: (request) => throttleForward(request),
    })
  process.env.OPENAI_BASE_URL = proxy.url
  if (DRY_RUN) process.env.OPENAI_API_KEY = 'sk-dry-run-local-only'
  const configuredInitialConcurrency = Number.parseInt(process.env.HYBRID_INITIAL_CONCURRENCY || '5', 10)
  let desiredConcurrency = DRY_RUN
    ? 1
    : Math.max(1, Math.min(10, Number.isFinite(configuredInitialConcurrency) ? configuredInitialConcurrency : 5))
  const maxConversationConcurrency = DRY_RUN ? 1 : 10
  const TPM_LIMIT = Number(process.env.HYBRID_TPM_LIMIT || 200_000)
  const RPM_LIMIT = Number(process.env.HYBRID_RPM_LIMIT || 500)
  const TPM_TARGET = Math.floor(TPM_LIMIT * 0.70)
  const RPM_TARGET = Math.floor(RPM_LIMIT * 0.70)
  const MAX_IN_FLIGHT = DRY_RUN ? 2 : 10
  const recentHttp = []
  const reservations = new Map()
  const limiterWaiters = new Set()
  let backoffUntil = 0
  let lastScaleAt = Date.now()
  let last429At = 0
  let maxObservedTpm = 0
  let maxObservedRpm = 0
  let maxObservedInFlight = 0
  let nextTokenSlotAt = Date.now()
  let nextRequestSlotAt = Date.now()
  const concurrencyHistory = [{
    at: new Date().toISOString(),
    concurrency: desiredConcurrency,
    reason: process.env.HYBRID_INITIAL_CONCURRENCY ? 'retomada adaptativa configurada' : 'initial',
  }]

  const wakeLimiter = () => {
    for (const wake of limiterWaiters) wake()
    limiterWaiters.clear()
  }
  const trimWindow = (now = Date.now()) => {
    while (recentHttp.length && recentHttp[0].at <= now - 60_000) recentHttp.shift()
  }
  const windowMetrics = (now = Date.now()) => {
    trimWindow(now)
    return {
      rpm: recentHttp.length,
      tpm: recentHttp.reduce((sum, item) => sum + item.tokens, 0),
    }
  }
  const reservedTokens = () => [...reservations.values()].reduce((sum, queue) => sum + queue.reduce((a, value) => a + value, 0), 0)
  const reservedRequests = () => [...reservations.values()].reduce((sum, queue) => sum + queue.length, 0)
  const tokenEstimate = (task) => {
    const samples = recentHttp.filter((item) => item.tokens > 0).slice(-100).map((item) => item.tokens).sort((a, b) => a - b)
    const p90 = samples.length ? samples[Math.floor((samples.length - 1) * 0.9)] : 0
    return Math.max(task === 'extractMovingDate' ? 1_500 : 3_500, p90)
  }
  const waitForLimiter = (ms) => new Promise((resolve) => {
    const timer = setTimeout(() => { limiterWaiters.delete(done); resolve() }, Math.max(25, ms))
    const done = () => { clearTimeout(timer); limiterWaiters.delete(done); resolve() }
    limiterWaiters.add(done)
  })
  async function acquireHttp(callId, task) {
    const estimate = tokenEstimate(task)
    // Leaky bucket: espaça a carga solicitada de modo uniforme. Um simples
    // sliding window de respostas concluídas permite um burst inicial grande
    // demais, pois a API contabiliza o request antes de devolver o usage.
    while (true) {
      const now = Date.now()
      const metrics = windowMetrics(now)
      const inflight = reservedRequests()
      if (inflight < MAX_IN_FLIGHT) {
        const scheduledAt = Math.max(now, backoffUntil, nextTokenSlotAt, nextRequestSlotAt)
        nextTokenSlotAt = scheduledAt + Math.ceil((estimate * 60_000) / TPM_TARGET)
        nextRequestSlotAt = scheduledAt + Math.ceil(60_000 / RPM_TARGET)
        if (scheduledAt > now) await new Promise((resolve) => setTimeout(resolve, scheduledAt - now))
        if (Date.now() < backoffUntil) continue
        const queue = reservations.get(callId) || []
        queue.push(estimate)
        reservations.set(callId, queue)
        maxObservedInFlight = Math.max(maxObservedInFlight, inflight + 1)
        return
      }
      await waitForLimiter(250)
    }
  }
  const releaseReservation = (callId) => {
    const queue = reservations.get(callId)
    if (!queue?.length) return
    queue.shift()
    if (!queue.length) reservations.delete(callId)
    wakeLimiter()
  }
  const setConcurrency = (next, reason) => {
    next = Math.max(1, Math.min(maxConversationConcurrency, next))
    if (next === desiredConcurrency) return
    desiredConcurrency = next
    lastScaleAt = Date.now()
    concurrencyHistory.push({ at: new Date().toISOString(), concurrency: next, reason })
    console.log(`[concorrência] conversas=${next} motivo=${reason}`)
  }
  observeHttp = (call) => {
    const now = Date.now()
    releaseReservation(call.logicalCallId)
    const tokens = call.usage?.total_tokens ?? ((call.usage?.prompt_tokens ?? 0) + (call.usage?.completion_tokens ?? 0))
    recentHttp.push({ at: now, tokens, status: call.status })
    const metrics = windowMetrics(now)
    maxObservedTpm = Math.max(maxObservedTpm, metrics.tpm)
    maxObservedRpm = Math.max(maxObservedRpm, metrics.rpm)
    if (call.status === 429) {
      last429At = now
      const retrySeconds = Number.parseFloat(call.retryAfter || '')
      backoffUntil = Math.max(backoffUntil, now + Math.max(3_000, Number.isFinite(retrySeconds) ? retrySeconds * 1_000 : 0))
      nextTokenSlotAt = Math.max(nextTokenSlotAt, backoffUntil)
      nextRequestSlotAt = Math.max(nextRequestSlotAt, backoffUntil)
      setConcurrency(Math.ceil(desiredConcurrency / 2), 'HTTP 429')
    } else if (now - last429At >= 120_000 && now - lastScaleAt >= 60_000) {
      if (desiredConcurrency === 5 && metrics.tpm < TPM_LIMIT * 0.50 && metrics.rpm < RPM_LIMIT * 0.50) {
        setConcurrency(8, 'margem sustentada de TPM/RPM')
      } else if (desiredConcurrency === 8 && metrics.tpm < TPM_LIMIT * 0.55 && metrics.rpm < RPM_LIMIT * 0.55) {
        setConcurrency(10, 'margem sustentada de TPM/RPM')
      }
    }
    wakeLimiter()
  }
  throttleForward = ({ logicalCallId, task }) => acquireHttp(logicalCallId, task)
  const { extractClientInfo, extractMovingDate } = await import('../../src/ai.js')
  let lastProgressAt = 0
  let activeCalls = 0
  let stopRequested = false
  const paceMs = DRY_RUN ? 0 : Number(process.env.HYBRID_PACE_MS || 0)
  const activeCallReserveUsd = 0.01

  const totals = () => {
    const current = aggregateRecords(records, usageAttempts)
    return {
      ...current,
      priorPromptTokens: priorCost.promptTokens,
      priorCachedPromptTokens: priorCost.cachedPromptTokens,
      priorCompletionTokens: priorCost.completionTokens,
      priorCostUsd: priorCost.costUsd,
      runCostUsd: current.costUsd,
      costUsd: priorCost.costUsd + current.costUsd,
      adaptiveConcurrency: {
        current: desiredConcurrency,
        maximum: maxConversationConcurrency,
        history: concurrencyHistory,
        tpmLimit: TPM_LIMIT,
        rpmLimit: RPM_LIMIT,
        tpmTarget: TPM_TARGET,
        rpmTarget: RPM_TARGET,
        maxObservedTpm,
        maxObservedRpm,
        maxObservedInFlight,
        currentWindow: windowMetrics(),
      },
    }
  }
  const writeSummary = (extra = {}) => atomicWrite(summaryPath, {
    updatedAt: new Date().toISOString(),
    fingerprint,
    ...totals(),
    ...extra,
  })
  const appendRecord = (record) => {
    fs.appendFileSync(checkpointPath, `${JSON.stringify(record)}\n`)
    records.set(record.cacheKey, record)
    writeSummary()
  }

  async function checkedCall(meta, operation) {
    const cacheKey = sha256(JSON.stringify({ fingerprint, ...meta }))
    const cached = records.get(cacheKey)
    // Sucessos são imutáveis. Erros ficam preservados no JSONL para a
    // auditoria, mas são elegíveis a nova tentativa numa retomada.
    if (cached?.status === 'success') return cached
    if (meta.allowPriorImport) {
      const phases = meta.allowFinalImport ? ['replay', 'final'] : ['replay']
      const source = phases
        .map((phase) => priorByInput.get([meta.dataset, meta.file, phase, meta.turnIndex, meta.historyHash, meta.task].join('\0')))
        .find(Boolean)
      if (source) {
        const record = {
          cacheKey, ...meta, status: 'success', importedFrom: source.cacheKey,
          startedAt: source.startedAt, completedAt: source.completedAt,
          attempts: [], result: source.result,
        }
        appendRecord(record)
        return record
      }
    }
    const beforeTotals = totals()
    if (!DRY_RUN && (stopRequested || beforeTotals.costUsd + activeCalls * activeCallReserveUsd >= COST_CAP_USD)) {
      stopRequested = true
      throw new CostLimitReached(`Limite de US$ ${COST_CAP_USD.toFixed(2)} atingido ou reservado.`)
    }
    const startedAt = new Date().toISOString()
    activeCalls++
    try {
      proxy.registerLogicalCall?.(cacheKey, meta.task)
      const result = await operation()
      const attempts = usageAttempts.filter((attempt) => attempt.logicalCallId === cacheKey)
      const record = { cacheKey, ...meta, status: 'success', startedAt, completedAt: new Date().toISOString(), attempts, result }
      appendRecord(record)
      const current = totals()
      const now = Date.now()
      if (current.logicalCalls % 25 === 0 || now - lastProgressAt > 30_000) {
        console.log(`[progresso] chamadas=${current.logicalCalls}/${config.plannedLogicalCalls} tentativas=${current.httpAttempts} retries=${current.retries} custo=US$${current.costUsd.toFixed(6)}`)
        lastProgressAt = now
      }
      return record
    } catch (error) {
      if (error instanceof CostLimitReached) throw error
      const attempts = usageAttempts.filter((attempt) => attempt.logicalCallId === cacheKey)
      const record = {
        cacheKey, ...meta, status: 'error', startedAt, completedAt: new Date().toISOString(), attempts,
        error: { name: error.name, message: error.message, status: error.status ?? null, requestId: error.request_id ?? null },
      }
      appendRecord(record)
      console.error(`[erro] ${meta.dataset}/${meta.file} ${meta.phase} turno=${meta.turnIndex} tarefa=${meta.task}: ${error.message}`)
      return record
    } finally {
      activeCalls--
      reservations.delete(cacheKey)
      wakeLimiter()
      if (paceMs > 0) await new Promise((resolve) => setTimeout(resolve, paceMs))
    }
  }
  const all = []
  const emptyConversations = []
  for (const dataset of datasets) {
    for (const conversation of loadConversations(dataset.dir)) {
      if (!conversation.messages.length) {
        emptyConversations.push({ dataset: dataset.name, file: conversation.file, contato: conversation.contato })
        continue
      }
      all.push({ ...conversation, dataset: dataset.name })
    }
  }
  if (all.length !== 885) throw new Error(`Esperava 885 conversas com conteúdo, encontrei ${all.length}.`)
  const plannedTurns = all.reduce((sum, conversation) => sum + groupIntoTurns(conversation.messages).length, 0)
  if (plannedTurns !== 6847) throw new Error(`Esperava 6.847 turnos, encontrei ${plannedTurns}.`)
  atomicWrite(path.join(outputDir, 'empty-conversations.json'), {
    count: emptyConversations.length,
    note: 'Registradas sem chamadas de IA, pois não contêm mensagens processáveis.',
    conversations: emptyConversations,
  })

  const work = all
    .sort((a, b) => a.dataset.localeCompare(b.dataset) || a.file.localeCompare(b.file))
    .map((conversation) => ({ phase: 'replay', conversation }))
  const limitedWork = MAX_CONVERSATIONS > 0 ? work.slice(0, MAX_CONVERSATIONS) : work
  let completedConversations = 0
  let stoppedByCost = false

  async function processOne({ phase, conversation }) {
    if (stopRequested) return
    const history = []
    let state = { ...BASE_STATE }
    const turns = phase === 'replay' ? groupIntoTurns(conversation.messages) : [{ fromMe: null, messages: conversation.messages }]
    let extractionImportPrefix = true
    const turnResults = []
    for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
      if (stopRequested) throw new CostLimitReached(`Limite de US$ ${COST_CAP_USD.toFixed(2)} atingido ou reservado.`)
      history.push(...turns[turnIndex].messages.map((message) => ({
        direction: message.fromMe ? 'OUT_HUMAN' : 'IN',
        text: message.text,
        timestamp: message.timestamp,
      })))
      const movingDateReference = new Date(
        history.findLast((message) => message.direction === 'IN')?.timestamp
          ?? history.at(-1).timestamp,
      )
      const beforeState = { ...state }
      const baseMeta = {
        dataset: conversation.dataset,
        file: conversation.file,
        phase,
        turnIndex,
        historyHash: sha256(JSON.stringify(history)),
        allowFinalImport: turns.length === 1,
      }
      // As duas funções leem o mesmo snapshot e não consomem o resultado
      // uma da outra. O estado só é consolidado depois de ambas terminarem.
      const [extraction, movingDate] = await Promise.all([
        checkedCall({
          ...baseMeta,
          task: 'extractClientInfo',
          stateHash: sha256(JSON.stringify(state)),
          allowPriorImport: extractionImportPrefix,
        }, () => extractClientInfo(state, history)),
        checkedCall({ ...baseMeta, task: 'extractMovingDate', allowPriorImport: true }, () => extractMovingDate(history, movingDateReference)),
      ])
      if (!extraction.importedFrom && !records.get(extraction.cacheKey)?.importedFrom) extractionImportPrefix = false
      if (extraction.status === 'success') state = applyExtraction(state, extraction.result, movingDate.status === 'success' ? movingDate.result : null)
      else if (movingDate.status === 'success' && movingDate.result) state.movingDate = movingDate.result
      turnResults.push({
        turnIndex,
        messageCount: turns[turnIndex].messages.length,
        direction: turns[turnIndex].fromMe == null ? 'FULL_HISTORY' : turns[turnIndex].fromMe ? 'OUT_HUMAN' : 'IN',
        beforeState,
        extractionCacheKey: extraction.cacheKey,
        dateCacheKey: movingDate.cacheKey,
        afterState: { ...state },
      })
      atomicWrite(path.join(outputDir, 'results', conversation.dataset, conversation.file), {
        dataset: conversation.dataset,
        file: conversation.file,
        contato: conversation.contato,
        phase,
        sourceMessages: conversation.messages.map((message) => ({ direction: message.fromMe ? 'OUT_HUMAN' : 'IN', text: message.text, timestamp: message.timestamp })),
        sourceMessageCount: conversation.messages.length,
        sourceTurnCount: groupIntoTurns(conversation.messages).length,
        processedTurns: turnResults.length,
        complete: turnResults.length === turns.length,
        turnResults,
        finalState: state,
      })
    }
    completedConversations++
  }

  try {
    await runWorkerPool({
      workerCount: maxConversationConcurrency,
      taskCount: limitedWork.length,
      getConcurrency: () => desiredConcurrency,
      isStopped: () => stopRequested,
      stop: () => { stopRequested = true },
      runTask: (index) => processOne(limitedWork[index]),
      isFatal: (error) => error instanceof CostLimitReached,
    })
    stoppedByCost = stopRequested
  } catch (error) {
    if (error instanceof CostLimitReached) {
      stoppedByCost = true
      console.log(`[limite] ${error.message}`)
    } else throw error
  } finally {
    writeSummary({ completedConversations, scheduledConversations: limitedWork.length, stoppedByCost })
    await proxy.close()
  }
}

main().catch((error) => {
  console.error('Falha na bateria híbrida final:', error)
  process.exitCode = 1
})
