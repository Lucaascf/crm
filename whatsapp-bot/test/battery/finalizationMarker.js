// Marcador final atômico da bateria canônica (item P0.4 do relatório final —
// docs/relatorios/FINAL-REPORT-bateria-canonica-final-full-15a92cc.md,
// seções 3.3, 7.1 e 10). Ver docs/correcoes/04_MARCADOR_FINAL_ATOMICO.md.
//
// Hoje, `execution-summary.json` é reescrito a cada chamada lógica
// concluída (não só no final) e nunca contém um booleano de conclusão
// verificada, identificação única da execução ou hashes dos artefatos — ver
// reprodução em docs/correcoes/04_MARCADOR_FINAL_ATOMICO.md. Este módulo
// publica, à parte, um `completion-marker.json` que só pode conter
// `completed: true` depois que TODAS as condições abaixo forem verificadas
// nesta chamada (nunca supostas a partir de execuções anteriores):
//
//  1. os workers terminaram normalmente (`workersEndedNormally`);
//  2. todas as tarefas agendadas foram concluídas (contagem de conversas);
//  3. todos os resultados têm `complete: true` e a contagem de turnos bate;
//  4. toda referência de chamada lógica (`extractionCacheKey`/`dateCacheKey`)
//     nos resultados existe no checkpoint (nenhuma referência pendurada) e a
//     contagem total bate com o esperado;
//  5. o summary final existe, é JSON válido e pertence a esta execução
//     (mesmo `fingerprint`);
//  6. o proxy foi fechado (`proxyClosed`);
//  7. os hashes dos artefatos foram calculados com sucesso.
//
// Qualquer falha em qualquer verificação, ou qualquer erro durante a
// escrita, lança um erro e NÃO escreve nem sobrescreve o marcador — o
// arquivo permanece ausente (ou com o conteúdo anterior à tentativa) até
// uma publicação que passe em todas as verificações.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const DEFAULT_MARKER_FILENAME = 'completion-marker.json'

export class FinalizationValidationError extends Error {
  constructor(reason, message, details = {}) {
    super(message)
    this.name = 'FinalizationValidationError'
    this.reason = reason
    this.details = details
  }
}

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')

// Mesmo método de hash agregado usado na seção 11 do relatório final para
// `results/`: ordena por dataset e nome de arquivo, alimenta SHA-256 com
// caminho relativo + NUL + conteúdo integral + NUL, para cada arquivo.
export function computeResultsAggregateHash(resultsDir, datasets) {
  const hash = crypto.createHash('sha256')
  for (const dataset of [...datasets].sort()) {
    const dir = path.join(resultsDir, dataset)
    if (!fs.existsSync(dir)) continue
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort()) {
      hash.update(`${dataset}/${file}`)
      hash.update('\0')
      hash.update(fs.readFileSync(path.join(dir, file)))
      hash.update('\0')
    }
  }
  return hash.digest('hex')
}

function readCheckpointTerminalStatus(checkpointPath) {
  if (!fs.existsSync(checkpointPath)) {
    throw new FinalizationValidationError('checkpoint-missing', `Checkpoint ausente em ${checkpointPath}.`)
  }
  const status = new Map() // cacheKey -> 'success' | 'error'
  const raw = fs.readFileSync(checkpointPath, 'utf8')
  const lines = raw.split('\n').filter((line) => line.trim())
  for (const [index, line] of lines.entries()) {
    let record
    try {
      record = JSON.parse(line)
    } catch (error) {
      throw new FinalizationValidationError('checkpoint-malformed', `Linha ${index + 1} de ${checkpointPath} não é JSON válido: ${error.message}`)
    }
    if (!record.cacheKey || (record.status !== 'success' && record.status !== 'error')) {
      throw new FinalizationValidationError('checkpoint-malformed', `Linha ${index + 1} de ${checkpointPath} não tem cacheKey/status terminal reconhecível.`)
    }
    status.set(record.cacheKey, record.status)
  }
  return status
}

function readAndValidateResults(resultsDir, datasets, checkpointStatus) {
  let actualConversations = 0
  let actualTurns = 0
  let logicalCallsSucceeded = 0
  let logicalCallsFailed = 0
  const referencedKeys = new Set()
  for (const dataset of datasets) {
    const dir = path.join(resultsDir, dataset)
    if (!fs.existsSync(dir)) continue
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.json')).sort()) {
      const full = path.join(dir, file)
      let result
      try {
        result = JSON.parse(fs.readFileSync(full, 'utf8'))
      } catch (error) {
        throw new FinalizationValidationError('result-malformed', `Resultado ${dataset}/${file} não é JSON válido: ${error.message}`)
      }
      if (result.complete !== true) {
        throw new FinalizationValidationError('incomplete-result', `Resultado ${dataset}/${file} não está marcado como complete: true.`, { dataset, file })
      }
      const turnResults = Array.isArray(result.turnResults) ? result.turnResults : []
      if (typeof result.processedTurns === 'number' && result.processedTurns !== turnResults.length) {
        throw new FinalizationValidationError('incomplete-result', `Resultado ${dataset}/${file}: processedTurns (${result.processedTurns}) diverge de turnResults.length (${turnResults.length}).`, { dataset, file })
      }
      actualConversations++
      actualTurns += turnResults.length
      for (const turn of turnResults) {
        for (const key of [turn.extractionCacheKey, turn.dateCacheKey]) {
          if (key == null) continue
          if (referencedKeys.has(key)) continue
          referencedKeys.add(key)
          const status = checkpointStatus.get(key)
          if (!status) {
            throw new FinalizationValidationError(
              'dangling-checkpoint-reference',
              `Resultado ${dataset}/${file} (turno ${turn.turnIndex}) referencia cacheKey ausente do checkpoint: ${key}.`,
              { dataset, file, turnIndex: turn.turnIndex, cacheKey: key },
            )
          }
          if (status === 'success') logicalCallsSucceeded++
          else logicalCallsFailed++
        }
      }
    }
  }
  return {
    actualConversations,
    actualTurns,
    logicalCallsCompleted: referencedKeys.size,
    logicalCallsSucceeded,
    logicalCallsFailed,
  }
}

function readSummary(summaryPath, fingerprint) {
  if (!fs.existsSync(summaryPath)) {
    throw new FinalizationValidationError('summary-missing', `Summary final ausente em ${summaryPath}.`)
  }
  let summary
  try {
    summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'))
  } catch (error) {
    throw new FinalizationValidationError('summary-invalid', `Summary final ${summaryPath} não é JSON válido: ${error.message}`)
  }
  if (summary.fingerprint !== fingerprint) {
    throw new FinalizationValidationError('summary-fingerprint-mismatch', `Summary final pertence a outra execução (fingerprint ${summary.fingerprint} != ${fingerprint}).`)
  }
  return summary
}

// Verifica todas as pré-condições e, se todas passarem, retorna os dados
// já coletados (evita reler os arquivos na hora de montar o marcador).
// Nunca escreve nada em disco.
export function validateFinalization(ctx) {
  const {
    fingerprint,
    workersEndedNormally,
    proxyClosed,
    checkpointPath,
    resultsDir,
    datasets,
    summaryPath,
    expectedConversations,
    expectedTurns,
    expectedLogicalCalls,
  } = ctx

  if (workersEndedNormally !== true) {
    throw new FinalizationValidationError('workers-not-ended-normally', 'Os workers não terminaram normalmente (stop/erro fatal/exceção não tratada); marcador não pode ser publicado.')
  }
  if (proxyClosed !== true) {
    throw new FinalizationValidationError('proxy-not-closed', 'O proxy (ou recurso equivalente) não foi fechado com sucesso; marcador não pode ser publicado.')
  }

  const checkpointStatus = readCheckpointTerminalStatus(checkpointPath)
  const summary = readSummary(summaryPath, fingerprint)
  const { actualConversations, actualTurns, logicalCallsCompleted, logicalCallsSucceeded, logicalCallsFailed } =
    readAndValidateResults(resultsDir, datasets, checkpointStatus)

  if (actualConversations !== expectedConversations) {
    throw new FinalizationValidationError(
      'conversation-count-mismatch',
      `Contagem de conversas concluídas (${actualConversations}) diverge da esperada (${expectedConversations}).`,
      { actualConversations, expectedConversations },
    )
  }
  if (actualTurns !== expectedTurns) {
    throw new FinalizationValidationError(
      'turn-count-mismatch',
      `Contagem de turnos concluídos (${actualTurns}) diverge da esperada (${expectedTurns}).`,
      { actualTurns, expectedTurns },
    )
  }
  if (logicalCallsCompleted !== expectedLogicalCalls) {
    throw new FinalizationValidationError(
      'logical-call-count-mismatch',
      `Contagem de chamadas lógicas concluídas (${logicalCallsCompleted}) diverge da esperada (${expectedLogicalCalls}).`,
      { logicalCallsCompleted, expectedLogicalCalls },
    )
  }

  return {
    summary,
    counts: {
      conversations: { expected: expectedConversations, actual: actualConversations },
      turns: { expected: expectedTurns, actual: actualTurns },
      logicalCalls: {
        expected: expectedLogicalCalls,
        actual: logicalCallsCompleted,
        succeeded: logicalCallsSucceeded,
        failed: logicalCallsFailed,
      },
    },
  }
}

function computeArtifactHashes(ctx) {
  const { checkpointPath, usageLogPath, summaryPath, configPath, resultsDir, datasets, emptyConversationsPath } = ctx
  const hashes = {
    'checkpoint.jsonl': sha256File(checkpointPath),
    'execution-summary.json': sha256File(summaryPath),
    'execution-config.json': sha256File(configPath),
    results: computeResultsAggregateHash(resultsDir, datasets),
  }
  if (usageLogPath && fs.existsSync(usageLogPath)) hashes['api-attempts.jsonl'] = sha256File(usageLogPath)
  if (emptyConversationsPath && fs.existsSync(emptyConversationsPath)) hashes['empty-conversations.json'] = sha256File(emptyConversationsPath)
  return hashes
}

function atomicWriteJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  // Escreve no arquivo temporário e só então publica com rename — no mesmo
  // sistema de arquivos, rename é atômico: um leitor concorrente nunca vê um
  // arquivo parcialmente escrito no caminho final, e uma falha antes do
  // rename nunca chega a tocar no caminho final.
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`)
  try {
    fs.renameSync(temp, file)
  } catch (error) {
    // O rename falhou (ex.: caminho final ocupado por um diretório): o
    // caminho final permanece intocado, e o temporário não deve sobrar
    // órfão no disco.
    fs.rmSync(temp, { force: true })
    throw error
  }
}

// Publica o marcador final atômico. Lança (sem escrever nada) se qualquer
// pré-condição falhar. Só chama fs.renameSync depois que o objeto completo
// do marcador já foi montado e serializado com sucesso em memória.
export async function publishCompletionMarker(ctx) {
  const markerPath = ctx.markerPath || path.join(ctx.outputDir, DEFAULT_MARKER_FILENAME)
  const { counts } = validateFinalization(ctx)
  const artifactHashes = computeArtifactHashes(ctx)

  const marker = {
    completed: true,
    executionId: ctx.fingerprint,
    outputDir: path.basename(ctx.outputDir),
    completedAt: new Date().toISOString(),
    conversations: counts.conversations,
    turns: counts.turns,
    logicalCalls: counts.logicalCalls,
    artifactHashes,
    executionConfig: {
      fingerprint: ctx.fingerprint,
      commit: ctx.config?.commit ?? null,
      codeHash: ctx.config?.codeHash ?? null,
      datasetHashes: ctx.config?.datasetHashes ?? null,
      model: ctx.config?.model ?? null,
      temperature: ctx.config?.temperature ?? null,
      costCapUsd: ctx.config?.costCapUsd ?? null,
      dryRun: ctx.config?.dryRun ?? null,
    },
  }

  atomicWriteJson(markerPath, marker)
  return marker
}

// Deve ser chamada no INÍCIO de uma execução (antes de qualquer trabalho
// novo), para que um marcador de uma tentativa anterior não permaneça no
// caminho canônico enquanto esta execução está em andamento (ou se ela
// travar/crashar antes de publicar um novo marcador). O conteúdo antigo não
// é perdido: fica arquivado ao lado, com timestamp, para auditoria.
export function invalidateStaleMarker(outputDir, markerPath) {
  const canonical = markerPath || path.join(outputDir, DEFAULT_MARKER_FILENAME)
  if (!fs.existsSync(canonical)) return null
  const archived = `${canonical}.superseded-${Date.now()}-${process.pid}.json`
  fs.renameSync(canonical, archived)
  return archived
}

// Releitura independente do marcador publicado, recomputando hashes e
// contagens a partir dos artefatos em disco — usada para detectar
// adulteração (arquivo do marcador ou artefatos alterados depois da
// publicação) sem confiar apenas no conteúdo do próprio marcador.
export function verifyCompletionMarker(ctx) {
  const markerPath = ctx.markerPath || path.join(ctx.outputDir, DEFAULT_MARKER_FILENAME)
  if (!fs.existsSync(markerPath)) return { valid: false, reason: 'marker-missing' }
  let marker
  try {
    marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
  } catch (error) {
    return { valid: false, reason: 'marker-invalid-json', message: error.message }
  }
  if (marker.completed !== true) return { valid: false, reason: 'marker-not-completed' }
  const recomputedHashes = computeArtifactHashes(ctx)
  const mismatches = []
  for (const [key, value] of Object.entries(marker.artifactHashes || {})) {
    if (recomputedHashes[key] !== value) mismatches.push({ artifact: key, recorded: value, recomputed: recomputedHashes[key] ?? null })
  }
  for (const key of Object.keys(recomputedHashes)) {
    if (!(key in (marker.artifactHashes || {}))) mismatches.push({ artifact: key, recorded: null, recomputed: recomputedHashes[key] })
  }
  if (mismatches.length) return { valid: false, reason: 'hash-mismatch', mismatches, marker }
  return { valid: true, marker }
}
