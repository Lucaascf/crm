// Preload pras baterias que usam a API REAL da OpenAI (custo real — ver
// relatório). Isola o banco (nunca toca prisma/dev.db) igual test/support/
// setup.js, mas NÃO sobe o mock — aponta pra api.openai.com de verdade via
// test/support/recordingProxy.js, que só grava o `usage` de cada chamada
// pra calcular custo, sem alterar request/response.
//
// Rodar sempre a partir de whatsapp-bot/ com a API key no ambiente, ex:
//   node --env-file=.env --import ./test/support/setupRealApiTestDb.js test/battery/runCrmAccuracyBattery.js
import { execSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startRecordingProxy } from './recordingProxy.js'
import { mockOpenAiState } from './mockOpenAiSingleton.js' // reaproveita o mesmo "slot" pra guardar a instância — testes reais chamam getMockOpenAi() só pra ler .calls

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')

if (!process.env.OPENAI_API_KEY) {
  throw new Error(
    'OPENAI_API_KEY não encontrada no ambiente. Rode com `node --env-file=.env --import ./test/support/setupRealApiTestDb.js ...` a partir de whatsapp-bot/.',
  )
}

const dbPath = path.join(os.tmpdir(), `trevo-bot-realapi-${process.pid}-${Date.now()}.db`)
// O engine SQLite deste ambiente exige que o arquivo exista antes de db push.
fs.closeSync(fs.openSync(dbPath, 'wx'))
process.env.DATABASE_URL = `file:${dbPath}`
process.env.BOT_ENABLED_FOR_ALL = 'false'

execSync('npx prisma db push --skip-generate --schema=prisma/schema.prisma --accept-data-loss', {
  cwd: repoRoot,
  env: process.env,
  stdio: 'pipe',
})

const cleanup = () => {
  for (const suf of ['', '-journal', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + suf)
    } catch {
      // ok
    }
  }
}
process.on('exit', cleanup)

const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()
await prisma.user.upsert({
  where: { email: 'luciano' },
  update: {},
  create: { name: 'Luciano (seed bateria real)', email: 'luciano', passwordHash: 'test-seed-hash' },
})
await prisma.$disconnect()

const proxy = await startRecordingProxy()
mockOpenAiState.instance = proxy
process.env.OPENAI_BASE_URL = proxy.url

console.log(`[setupRealApiTestDb] DB isolado: ${dbPath}`)
console.log('[setupRealApiTestDb] Usando API REAL da OpenAI via proxy de gravação — custo real será cobrado na conta configurada em OPENAI_API_KEY.')
