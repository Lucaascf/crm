// Teste de integração do P0.4: executa o fluxo real de finalização
// (runWorkerPool -> writeSummary -> proxy.close -> publishCompletionMarker,
// na mesma ordem e no mesmo padrão de try/finally de
// runFinalHybridBattery.js) em um PROCESSO SEPARADO
// (finalizationMarkerIntegrationRunner.mjs), com fila sintética pequena,
// dados fictícios e diretório temporário isolado — nenhum dataset real,
// nenhuma conta do WhatsApp, nenhuma chamada de API real.
//
// Objetivo: provar que (a) o caminho feliz publica o marcador com
// completed: true, hashes e contagens corretas, e termina com exit code 0;
// e (b) cada cenário de falha controlado (summary, proxy, checkpoint
// inconsistente) termina com exit code != 0 e SEM publicar o marcador —
// mesmo quando toda a fila foi processada com sucesso.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const runnerPath = path.join(__dirname, 'finalizationMarkerIntegrationRunner.mjs')
const SAFETY_TIMEOUT_MS = 15_000

function runIntegration({ taskCount = 6, initialConcurrency = 1, workerCount = 10, failureMode = 'none' }) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p04-marker-integration-'))
  let exitCode = 0
  let stderr = ''
  try {
    execFileSync(
      process.execPath,
      [runnerPath, outDir, String(taskCount), String(initialConcurrency), String(workerCount), failureMode],
      { timeout: SAFETY_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (error) {
    exitCode = error.status ?? -1
    stderr = error.stderr?.toString() ?? ''
    if (error.signal) throw new Error(`processo filho morto pelo timeout de segurança (signal=${error.signal})`)
  }
  return { outDir, exitCode, stderr }
}

test('integração real: caminho feliz publica o marcador com exit code 0', { timeout: SAFETY_TIMEOUT_MS + 2_000 }, () => {
  const taskCount = 6
  const { outDir, exitCode } = runIntegration({ taskCount, initialConcurrency: 1, workerCount: 10, failureMode: 'none' })
  try {
    assert.equal(exitCode, 0, 'o processo deve terminar sozinho com exit code 0')

    const markerPath = path.join(outDir, 'completion-marker.json')
    assert.ok(fs.existsSync(markerPath), 'o marcador deve existir depois de uma execução bem-sucedida')
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'))
    assert.equal(marker.completed, true)
    assert.equal(marker.conversations.actual, taskCount)
    assert.equal(marker.turns.actual, taskCount)
    assert.equal(marker.logicalCalls.actual, taskCount * 2)
    assert.ok(marker.artifactHashes.results)
    assert.ok(marker.artifactHashes['checkpoint.jsonl'])
    assert.ok(marker.artifactHashes['execution-summary.json'])

    const resultFiles = fs.readdirSync(path.join(outDir, 'results', 'sintetico'))
    assert.equal(resultFiles.length, taskCount)
    const checkpointLines = fs.readFileSync(path.join(outDir, 'checkpoint.jsonl'), 'utf8').trim().split('\n')
    assert.equal(checkpointLines.length, taskCount * 2)
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('integração: falha simulada ao gravar o summary final impede o marcador (exit code != 0)', { timeout: SAFETY_TIMEOUT_MS + 2_000 }, () => {
  const { outDir, exitCode } = runIntegration({ taskCount: 5, failureMode: 'summary-write' })
  try {
    assert.notEqual(exitCode, 0)
    assert.equal(fs.existsSync(path.join(outDir, 'completion-marker.json')), false, 'sem summary final, o marcador não pode existir')
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('integração: falha simulada ao fechar o proxy impede o marcador, mesmo com toda a fila processada (exit code != 0)', { timeout: SAFETY_TIMEOUT_MS + 2_000 }, () => {
  const taskCount = 5
  const { outDir, exitCode } = runIntegration({ taskCount, failureMode: 'proxy-close' })
  try {
    assert.notEqual(exitCode, 0)
    assert.equal(fs.existsSync(path.join(outDir, 'completion-marker.json')), false)
    // a fila inteira foi processada e persistida — a falha é só no fechamento do proxy
    const resultFiles = fs.readdirSync(path.join(outDir, 'results', 'sintetico'))
    assert.equal(resultFiles.length, taskCount, 'o trabalho em si deve ter sido concluído; só a publicação do marcador é bloqueada')
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('integração: checkpoint inconsistente depois do fechamento normal impede o marcador (exit code != 0)', { timeout: SAFETY_TIMEOUT_MS + 2_000 }, () => {
  const { outDir, exitCode, stderr } = runIntegration({ taskCount: 4, failureMode: 'checkpoint-drop' })
  try {
    assert.notEqual(exitCode, 0)
    assert.match(stderr, /dangling-checkpoint-reference|cacheKey ausente/, 'o erro deve vir da validação cruzada do marcador, não de um crash genérico')
    assert.equal(fs.existsSync(path.join(outDir, 'completion-marker.json')), false)
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

test('integração: marcador obsoleto de uma execução anterior é arquivado antes de uma nova execução no mesmo diretório', { timeout: (SAFETY_TIMEOUT_MS + 2_000) * 2 }, () => {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p04-marker-integration-resume-'))
  try {
    execFileSync(process.execPath, [runnerPath, outDir, '3', '1', '10', 'none'], { timeout: SAFETY_TIMEOUT_MS })
    const firstMarker = JSON.parse(fs.readFileSync(path.join(outDir, 'completion-marker.json'), 'utf8'))

    // Roda de novo no MESMO diretório (mesma "execução", cenário de
    // retomada/reexecução) — o marcador antigo não pode aparentar validade
    // para o resultado da execução anterior enquanto esta roda de novo, e
    // ao final deve haver um marcador fresco, coerente com o novo checkpoint.
    execFileSync(process.execPath, [runnerPath, outDir, '3', '1', '10', 'none'], { timeout: SAFETY_TIMEOUT_MS })
    const secondMarker = JSON.parse(fs.readFileSync(path.join(outDir, 'completion-marker.json'), 'utf8'))

    const archived = fs.readdirSync(outDir).filter((f) => f.startsWith('completion-marker.json.superseded-'))
    assert.equal(archived.length, 1, 'o marcador da primeira execução deve ter sido arquivado exatamente uma vez')
    const archivedContent = JSON.parse(fs.readFileSync(path.join(outDir, archived[0]), 'utf8'))
    assert.deepEqual(archivedContent, firstMarker)
    assert.equal(secondMarker.completed, true)
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})
