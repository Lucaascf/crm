// Testes de regressão do marcador final atômico (item P0.4). Ver
// docs/correcoes/04_MARCADOR_FINAL_ATOMICO.md. Não usam os datasets reais
// (export/export-marcia) nem chamam a API da OpenAI: constroem, em
// diretórios temporários isolados, um estado sintético de "checkpoint +
// resultados + summary" no MESMO FORMATO que runFinalHybridBattery.js
// produz, e exercitam o módulo finalizationMarker.js diretamente.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  publishCompletionMarker,
  validateFinalization,
  invalidateStaleMarker,
  verifyCompletionMarker,
  computeResultsAggregateHash,
  FinalizationValidationError,
} from './finalizationMarker.js'

const FINGERPRINT = 'fingerprint-teste-p04'

function mkOutDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'p04-marker-'))
}

function atomicWriteJsonSync(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(temp, file)
}

// Constrói um estado completo e consistente com N conversas de T turnos
// cada, no formato exato que runFinalHybridBattery.js grava (checkpoint,
// results/<dataset>/<file>.json, execution-summary.json,
// execution-config.json). Retorna o contexto pronto para
// publishCompletionMarker/validateFinalization.
function buildValidExecution({ outDir, conversations = 3, turnsPerConversation = 2, dataset = 'export', fingerprint = FINGERPRINT }) {
  const checkpointPath = path.join(outDir, 'checkpoint.jsonl')
  const summaryPath = path.join(outDir, 'execution-summary.json')
  const configPath = path.join(outDir, 'execution-config.json')
  const usageLogPath = path.join(outDir, 'api-attempts.jsonl')
  const emptyConversationsPath = path.join(outDir, 'empty-conversations.json')
  const resultsDir = path.join(outDir, 'results')

  const config = { fingerprint, commit: 'deadbeef', codeHash: 'codehash', datasetHashes: { [dataset]: 'datasethash' }, model: 'gpt-4o-mini', temperature: 0, costCapUsd: 7.5, dryRun: true, createdAt: new Date().toISOString() }
  atomicWriteJsonSync(configPath, config)
  fs.writeFileSync(usageLogPath, `${JSON.stringify({ status: 200, usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n`)

  let checkpointLines = ''
  for (let c = 0; c < conversations; c++) {
    const file = `conversa-${c}.json`
    const turnResults = []
    for (let t = 0; t < turnsPerConversation; t++) {
      const extractionCacheKey = `extract-${c}-${t}`
      const dateCacheKey = `date-${c}-${t}`
      checkpointLines += `${JSON.stringify({ cacheKey: extractionCacheKey, status: 'success' })}\n`
      checkpointLines += `${JSON.stringify({ cacheKey: dateCacheKey, status: 'success' })}\n`
      turnResults.push({ turnIndex: t, extractionCacheKey, dateCacheKey, beforeState: {}, afterState: {} })
    }
    atomicWriteJsonSync(path.join(resultsDir, dataset, file), {
      dataset, file, processedTurns: turnResults.length, complete: true, turnResults,
    })
  }
  fs.writeFileSync(checkpointPath, checkpointLines)
  atomicWriteJsonSync(emptyConversationsPath, { count: 0, conversations: [] })
  atomicWriteJsonSync(summaryPath, { fingerprint, completedConversations: conversations, scheduledConversations: conversations, stoppedByCost: false })

  const expectedTurns = conversations * turnsPerConversation
  return {
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
    expectedConversations: conversations,
    expectedTurns,
    expectedLogicalCalls: expectedTurns * 2,
  }
}

// 1. Execução completamente finalizada.
test('publica o marcador quando todas as condições são satisfeitas', async () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 3, turnsPerConversation: 2 })
    const marker = await publishCompletionMarker(ctx)
    assert.equal(marker.completed, true)
    assert.equal(marker.executionId, FINGERPRINT)
    assert.equal(marker.conversations.actual, 3)
    assert.equal(marker.turns.actual, 6)
    assert.equal(marker.logicalCalls.actual, 12)
    assert.equal(marker.logicalCalls.succeeded, 12)
    assert.equal(marker.logicalCalls.failed, 0)
    assert.ok(marker.artifactHashes['checkpoint.jsonl'])
    assert.ok(marker.artifactHashes['execution-summary.json'])
    assert.ok(marker.artifactHashes['execution-config.json'])
    assert.ok(marker.artifactHashes.results)
    assert.ok(marker.artifactHashes['api-attempts.jsonl'])
    assert.ok(marker.artifactHashes['empty-conversations.json'])
    assert.equal(marker.executionConfig.fingerprint, FINGERPRINT)

    const onDisk = JSON.parse(fs.readFileSync(path.join(outDir, 'completion-marker.json'), 'utf8'))
    assert.deepEqual(onDisk, marker)
    // nenhum arquivo temporário deve sobrar depois da publicação
    assert.deepEqual(fs.readdirSync(outDir).filter((f) => f.endsWith('.tmp')), [])
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

// 2. Fila vazia válida.
test('fila vazia válida: publica o marcador com contagens zeradas', async () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 0, turnsPerConversation: 0 })
    const marker = await publishCompletionMarker(ctx)
    assert.equal(marker.completed, true)
    assert.equal(marker.conversations.actual, 0)
    assert.equal(marker.turns.actual, 0)
    assert.equal(marker.logicalCalls.actual, 0)
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

// 3. Conversa ou resultado incompleto.
test('resultado marcado como incompleto (complete !== true) impede o marcador', async () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 2, turnsPerConversation: 2 })
    const resultFile = path.join(ctx.resultsDir, 'export', 'conversa-0.json')
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'))
    result.complete = false
    atomicWriteJsonSync(resultFile, result)

    await assert.rejects(publishCompletionMarker(ctx), (error) => {
      assert.ok(error instanceof FinalizationValidationError)
      assert.equal(error.reason, 'incomplete-result')
      return true
    })
    assert.equal(fs.existsSync(path.join(outDir, 'completion-marker.json')), false)
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

// 4. Checkpoint inconsistente (linha malformada) e checkpoint ausente.
test('checkpoint com linha malformada impede o marcador', async () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 1, turnsPerConversation: 1 })
    fs.appendFileSync(ctx.checkpointPath, 'isto não é json\n')
    await assert.rejects(publishCompletionMarker(ctx), (error) => {
      assert.equal(error.reason, 'checkpoint-malformed')
      return true
    })
    assert.equal(fs.existsSync(path.join(outDir, 'completion-marker.json')), false)
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('checkpoint ausente impede o marcador', async () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 1, turnsPerConversation: 1 })
    fs.rmSync(ctx.checkpointPath)
    await assert.rejects(publishCompletionMarker(ctx), (error) => {
      assert.equal(error.reason, 'checkpoint-missing')
      return true
    })
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

// 5. Divergência entre contagens esperadas e efetivas.
test('divergência entre conversas esperadas e efetivas impede o marcador', async () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 3, turnsPerConversation: 2 })
    ctx.expectedConversations = 4
    await assert.rejects(publishCompletionMarker(ctx), (error) => {
      assert.equal(error.reason, 'conversation-count-mismatch')
      return true
    })
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('divergência entre turnos esperados e efetivos impede o marcador', async () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 3, turnsPerConversation: 2 })
    ctx.expectedTurns = 99
    await assert.rejects(publishCompletionMarker(ctx), (error) => {
      assert.equal(error.reason, 'turn-count-mismatch')
      return true
    })
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('divergência entre chamadas lógicas esperadas e efetivas impede o marcador', async () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 3, turnsPerConversation: 2 })
    ctx.expectedLogicalCalls = 1
    await assert.rejects(publishCompletionMarker(ctx), (error) => {
      assert.equal(error.reason, 'logical-call-count-mismatch')
      return true
    })
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

// 6. Falha na persistência de resultados (referência pendurada / arquivo faltando).
test('referência de chamada lógica ausente do checkpoint (resultado persistido, mas checkpoint incompleto) impede o marcador', async () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 2, turnsPerConversation: 2 })
    // Remove do checkpoint uma das chaves referenciadas pelos resultados —
    // simula falha de persistência do checkpoint para uma chamada cujo
    // resultado, mesmo assim, foi gravado.
    const lines = fs.readFileSync(ctx.checkpointPath, 'utf8').trim().split('\n')
    fs.writeFileSync(ctx.checkpointPath, `${lines.filter((line) => !line.includes('"extract-0-0"')).join('\n')}\n`)
    await assert.rejects(publishCompletionMarker(ctx), (error) => {
      assert.equal(error.reason, 'dangling-checkpoint-reference')
      assert.equal(error.details.cacheKey, 'extract-0-0')
      return true
    })
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('resultado de uma conversa não persistido em disco impede o marcador (contagem diverge)', async () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 3, turnsPerConversation: 1 })
    fs.rmSync(path.join(ctx.resultsDir, 'export', 'conversa-2.json'))
    await assert.rejects(publishCompletionMarker(ctx), (error) => {
      assert.equal(error.reason, 'conversation-count-mismatch')
      return true
    })
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

// 7. Falha na gravação do summary.
test('summary ausente impede o marcador', async () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 1, turnsPerConversation: 1 })
    fs.rmSync(ctx.summaryPath)
    await assert.rejects(publishCompletionMarker(ctx), (error) => {
      assert.equal(error.reason, 'summary-missing')
      return true
    })
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('summary corrompido (JSON inválido) impede o marcador', async () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 1, turnsPerConversation: 1 })
    fs.writeFileSync(ctx.summaryPath, '{ isto não fecha')
    await assert.rejects(publishCompletionMarker(ctx), (error) => {
      assert.equal(error.reason, 'summary-invalid')
      return true
    })
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('summary de outra execução (fingerprint diferente) impede o marcador', async () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 1, turnsPerConversation: 1 })
    atomicWriteJsonSync(ctx.summaryPath, { fingerprint: 'outra-execucao', completedConversations: 1 })
    await assert.rejects(publishCompletionMarker(ctx), (error) => {
      assert.equal(error.reason, 'summary-fingerprint-mismatch')
      return true
    })
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

// 8. Falha durante o fechamento do proxy.
test('proxy não fechado (proxyClosed=false) impede o marcador', async () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 1, turnsPerConversation: 1 })
    ctx.proxyClosed = false
    await assert.rejects(publishCompletionMarker(ctx), (error) => {
      assert.equal(error.reason, 'proxy-not-closed')
      return true
    })
    assert.equal(fs.existsSync(path.join(outDir, 'completion-marker.json')), false)
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

// 9. Interrupção anterior à publicação do marcador (workers não terminaram normalmente).
test('workers não terminados normalmente impede o marcador, mesmo com o resto do estado consistente', async () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 1, turnsPerConversation: 1 })
    ctx.workersEndedNormally = false
    assert.throws(() => validateFinalization(ctx), (error) => {
      assert.equal(error.reason, 'workers-not-ended-normally')
      return true
    })
    await assert.rejects(publishCompletionMarker(ctx))
    assert.equal(fs.existsSync(path.join(outDir, 'completion-marker.json')), false)
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

// 10. Retomada de uma execução interrompida.
test('retomada: execução parcial (interrompida) completada depois publica o marcador normalmente', async () => {
  const outDir = mkOutDir()
  try {
    // "Execução 1": só 1 de 2 conversas processadas antes de travar/crashar
    // — sem marcador, exatamente como uma interrupção real deixaria.
    const partial = buildValidExecution({ outDir, conversations: 1, turnsPerConversation: 2 })
    await assert.rejects(publishCompletionMarker({ ...partial, expectedConversations: 2, expectedTurns: 4, expectedLogicalCalls: 8 }))
    assert.equal(fs.existsSync(path.join(outDir, 'completion-marker.json')), false)

    // "Retomada": a segunda conversa é processada e persistida, igual ao
    // checkpoint/cache real permitiria numa retomada de verdade.
    const checkpointExtra = `${JSON.stringify({ cacheKey: 'extract-1-0', status: 'success' })}\n${JSON.stringify({ cacheKey: 'date-1-0', status: 'success' })}\n${JSON.stringify({ cacheKey: 'extract-1-1', status: 'success' })}\n${JSON.stringify({ cacheKey: 'date-1-1', status: 'success' })}\n`
    fs.appendFileSync(partial.checkpointPath, checkpointExtra)
    atomicWriteJsonSync(path.join(partial.resultsDir, 'export', 'conversa-1.json'), {
      dataset: 'export', file: 'conversa-1.json', processedTurns: 2, complete: true,
      turnResults: [
        { turnIndex: 0, extractionCacheKey: 'extract-1-0', dateCacheKey: 'date-1-0' },
        { turnIndex: 1, extractionCacheKey: 'extract-1-1', dateCacheKey: 'date-1-1' },
      ],
    })

    const marker = await publishCompletionMarker({ ...partial, expectedConversations: 2, expectedTurns: 4, expectedLogicalCalls: 8 })
    assert.equal(marker.completed, true)
    assert.equal(marker.conversations.actual, 2)
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

// 11. Existência de marcador obsoleto de uma execução anterior.
test('marcador obsoleto é arquivado (não apagado) no início de uma nova execução, nunca fica no caminho canônico durante ela', async () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 1, turnsPerConversation: 1 })
    const first = await publishCompletionMarker(ctx)
    const canonical = path.join(outDir, 'completion-marker.json')
    assert.ok(fs.existsSync(canonical))

    const archived = invalidateStaleMarker(outDir)
    assert.ok(archived)
    assert.equal(fs.existsSync(canonical), false, 'o caminho canônico não pode ter um marcador obsoleto enquanto a nova execução roda')
    const archivedContent = JSON.parse(fs.readFileSync(archived, 'utf8'))
    assert.deepEqual(archivedContent, first, 'o conteúdo do marcador antigo deve ser preservado, não apagado')

    // invalidar de novo sem marcador presente não deve lançar
    assert.equal(invalidateStaleMarker(outDir), null)
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

// 12. Verificação dos hashes registrados.
test('verifyCompletionMarker detecta adulteração de um artefato depois da publicação', async () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 2, turnsPerConversation: 1 })
    await publishCompletionMarker(ctx)

    const okCheck = verifyCompletionMarker(ctx)
    assert.equal(okCheck.valid, true)

    // Adultera um resultado DEPOIS de publicado (sem tocar no marcador).
    const resultFile = path.join(ctx.resultsDir, 'export', 'conversa-0.json')
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'))
    result.turnResults[0].afterState = { name: 'valor adulterado depois da publicação' }
    atomicWriteJsonSync(resultFile, result)

    const tamperedCheck = verifyCompletionMarker(ctx)
    assert.equal(tamperedCheck.valid, false)
    assert.equal(tamperedCheck.reason, 'hash-mismatch')
    assert.ok(tamperedCheck.mismatches.some((m) => m.artifact === 'results'))
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('verifyCompletionMarker sinaliza ausência de marcador', () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 1, turnsPerConversation: 1 })
    const check = verifyCompletionMarker(ctx)
    assert.equal(check.valid, false)
    assert.equal(check.reason, 'marker-missing')
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

// 13. Atomicidade da publicação.
test('atomicidade: se a publicação falhar (rename não pode substituir o caminho canônico), nenhum conteúdo parcial fica lá', async () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 1, turnsPerConversation: 1 })
    const canonical = path.join(outDir, 'completion-marker.json')
    // Ocupa o caminho canônico com um diretório não vazio — fs.renameSync de
    // um arquivo para cima de um diretório sempre falha (ENOTDIR/EISDIR/
    // ENOTEMPTY conforme a plataforma), simulando uma falha na etapa final
    // (única) de publicação: o rename atômico.
    fs.mkdirSync(canonical)
    fs.writeFileSync(path.join(canonical, 'nao-deveria-existir.txt'), 'marcador nunca escrito com sucesso')

    await assert.rejects(publishCompletionMarker(ctx))

    // O caminho canônico continua sendo o diretório inalterado: nenhum
    // conteúdo de marcador (completo ou parcial) foi publicado nele.
    assert.ok(fs.statSync(canonical).isDirectory())
    assert.deepEqual(fs.readdirSync(canonical), ['nao-deveria-existir.txt'])
    // nenhum arquivo .tmp órfão deve sobrar no diretório de saída
    assert.deepEqual(fs.readdirSync(outDir).filter((f) => f.endsWith('.tmp')), [])
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('publicação é idempotente: publicar de novo sobre um marcador válido produz o mesmo conteúdo (exceto completedAt)', async () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 2, turnsPerConversation: 2 })
    const first = await publishCompletionMarker(ctx)
    const second = await publishCompletionMarker(ctx)
    assert.deepEqual({ ...first, completedAt: null }, { ...second, completedAt: null })
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('hash agregado de results/ muda quando o conteúdo de um arquivo de resultado muda', () => {
  const outDir = mkOutDir()
  try {
    const ctx = buildValidExecution({ outDir, conversations: 2, turnsPerConversation: 1 })
    const before = computeResultsAggregateHash(ctx.resultsDir, ctx.datasets)

    const resultFile = path.join(ctx.resultsDir, 'export', 'conversa-0.json')
    const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'))
    result.turnResults[0].afterState = { name: 'mudou' }
    atomicWriteJsonSync(resultFile, result)

    const after = computeResultsAggregateHash(ctx.resultsDir, ctx.datasets)
    assert.notEqual(before, after)
    // determinístico: recalcular sem mudar nada dá o mesmo hash
    assert.equal(after, computeResultsAggregateHash(ctx.resultsDir, ctx.datasets))
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})
