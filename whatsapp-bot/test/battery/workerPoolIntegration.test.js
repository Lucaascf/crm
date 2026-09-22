// Teste de integração da P0.3: executa o pool de workers real (workerPool.js,
// sem mock nenhum no controle de concorrência) em um PROCESSO SEPARADO,
// exatamente como runFinalHybridBattery.js o usa — checkpoint incremental,
// resultados atômicos por tarefa, fechamento de "proxy" no finally — mas com
// fila sintética pequena, dados fictícios e diretório temporário isolado, e
// "respostas de API" simuladas (nenhuma chamada de rede real).
//
// Objetivo: provar que, depois da correção, o harness encerra sozinho com
// exit code 0 — sem depender de Ctrl-C nem de timeout forçado — e que os
// recursos (proxy) são fechados pelo fluxo normal de finalização.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const runnerPath = path.join(__dirname, 'workerPoolIntegrationRunner.mjs')
const SAFETY_TIMEOUT_MS = 15_000

function runIntegration({ taskCount, initialConcurrency, workerCount }) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'p03-worker-pool-integration-'))
  let exitCode = 0
  try {
    execFileSync(
      process.execPath,
      [runnerPath, outDir, String(taskCount), String(initialConcurrency), String(workerCount)],
      { timeout: SAFETY_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (error) {
    // execFileSync lança em exit code != 0 (inclusive quando o processo é
    // morto pelo timeout de segurança, o que indicaria travamento).
    exitCode = error.status ?? -1
    if (error.signal) throw new Error(`processo filho morto pelo timeout de segurança (signal=${error.signal}) — travamento não corrigido`)
  }
  return { outDir, exitCode }
}

test('integração real do harness (processo separado): encerra sozinho com exit code 0 depois de concluir a fila', { timeout: SAFETY_TIMEOUT_MS + 2_000 }, () => {
  const taskCount = 9
  const { outDir, exitCode } = runIntegration({ taskCount, initialConcurrency: 1, workerCount: 10 })

  assert.equal(exitCode, 0, 'o harness deve terminar sozinho com exit code 0, sem Ctrl-C nem timeout forçado')

  const summary = JSON.parse(fs.readFileSync(path.join(outDir, 'execution-summary.json'), 'utf8'))
  assert.equal(summary.completedConversations, taskCount)
  assert.equal(summary.scheduledConversations, taskCount)
  assert.equal(summary.completed, true)

  const checkpointLines = fs.readFileSync(path.join(outDir, 'checkpoint.jsonl'), 'utf8').trim().split('\n')
  assert.equal(checkpointLines.length, taskCount, 'cada tarefa deve ter exatamente um registro persistido no checkpoint')
  const indices = checkpointLines.map((line) => JSON.parse(line).index).sort((a, b) => a - b)
  assert.deepEqual(indices, Array.from({ length: taskCount }, (_, i) => i), 'cada tarefa processada exatamente uma vez')

  const resultFiles = fs.readdirSync(path.join(outDir, 'results'))
  assert.equal(resultFiles.length, taskCount, 'todas as tarefas concluídas devem ter resultado persistido em disco')

  assert.ok(fs.existsSync(path.join(outDir, 'proxy-closed.marker')), 'proxy.close() deve ter sido alcançado pelo fluxo normal de finalização (bloco finally)')

  fs.rmSync(outDir, { recursive: true, force: true })
})

test('integração: fila menor que o número de workers, concorrência inicial 1', { timeout: SAFETY_TIMEOUT_MS + 2_000 }, () => {
  const taskCount = 2
  const { outDir, exitCode } = runIntegration({ taskCount, initialConcurrency: 1, workerCount: 10 })
  assert.equal(exitCode, 0)
  const summary = JSON.parse(fs.readFileSync(path.join(outDir, 'execution-summary.json'), 'utf8'))
  assert.equal(summary.completedConversations, taskCount)
  assert.ok(fs.existsSync(path.join(outDir, 'proxy-closed.marker')))
  fs.rmSync(outDir, { recursive: true, force: true })
})

test('integração: concorrência inicial já alta (sem workers desativados)', { timeout: SAFETY_TIMEOUT_MS + 2_000 }, () => {
  const taskCount = 15
  const { outDir, exitCode } = runIntegration({ taskCount, initialConcurrency: 10, workerCount: 10 })
  assert.equal(exitCode, 0)
  const summary = JSON.parse(fs.readFileSync(path.join(outDir, 'execution-summary.json'), 'utf8'))
  assert.equal(summary.completedConversations, taskCount)
  fs.rmSync(outDir, { recursive: true, force: true })
})
