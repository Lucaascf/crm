// Pré-carregado via `node --import ./test/support/setup.js --test` (ver
// package.json). Roda ANTES de qualquer arquivo de teste ser importado —
// é o que garante que src/db.js (que faz `new PrismaClient()` no
// top-level, no momento do import) já enxerga um DATABASE_URL isolado, e
// que src/ai.js (que faz `new OpenAI(...)` no top-level) já enxerga o
// OPENAI_BASE_URL apontando pro mock local, nunca pra API de verdade.
//
// Isso é o que garante a exigência do pedido: a bateria de testes NUNCA
// toca o banco de produção/dev real (prisma/dev.db) nem manda chamada real
// pra OpenAI durante `npm test` — só a bateria de custo real (rodada à
// parte, fora do `npm test`) usa a API de verdade, e mesmo essa nunca
// manda mensagem real pro WhatsApp (fakeWaClient cobre isso sempre).
import { execSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startMockOpenAi } from './mockOpenAi.js'
import { mockOpenAiState } from './mockOpenAiSingleton.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..') // .../support -> test -> whatsapp-bot -> crm

const dbPath = path.join(os.tmpdir(), `trevo-bot-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`)
// O engine SQLite deste ambiente exige que o arquivo exista antes de db push.
fs.closeSync(fs.openSync(dbPath, 'wx'))
process.env.DATABASE_URL = `file:${dbPath}`
process.env.OPENAI_API_KEY = 'sk-test-fake-key-mock-server-only'
process.env.BOT_ENABLED_FOR_ALL = 'false'

execSync('npx prisma db push --skip-generate --schema=prisma/schema.prisma --accept-data-loss', {
  cwd: repoRoot,
  env: process.env,
  stdio: 'pipe',
})

const cleanupDb = () => {
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + suffix)
    } catch {
      // já não existe — ok
    }
  }
}
process.on('exit', cleanupDb)

// Seed do User dono das conversas do bot — findOrCreateClient (ver
// src/clientState.js) exige que ele já exista.
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()
await prisma.user.upsert({
  where: { email: 'luciano' },
  update: {},
  create: { name: 'Luciano (seed de teste)', email: 'luciano', passwordHash: 'test-seed-hash' },
})
await prisma.$disconnect()

const mock = await startMockOpenAi()
mockOpenAiState.instance = mock
process.env.OPENAI_BASE_URL = mock.url
