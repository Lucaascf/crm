import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stabilizeExtraction, mergeSides } from '../src/extractionPolicy.js'
import { withApiRetry } from '../src/apiRetry.js'
import { pickSample, cosmeticEqual } from './battery/sample.js'
import { createConversationHandler } from '../src/conversationHandler.js'
import { prisma } from '../src/db.js'
import { makeFakeWaClient, makeFakeMessage } from './support/fakeWaClient.js'
import { getMockOpenAi } from './support/mockOpenAiSingleton.js'

test('extração incerta preserva dados; correções concretas continuam aceitas', () => {
  const client = { originAddress: 'Rua A, 42', truckAccess: 'Sim, nos dois.', clientNickname: 'Leila', name: 'Leila Silva', nameConfirmed: true, vistoriaResolved: true, vistoriaType: 'fotos' }
  const merged = stabilizeExtraction(client, { originAddress: null, truckAccess: 'ainda não informado.', clientNickname: null, vistoriaResolved: false, vistoriaType: null })
  assert.equal(merged.originAddress, client.originAddress)
  assert.equal(merged.truckAccess, client.truckAccess)
  assert.equal(mergeSides(client.truckAccess, 'Origem: ainda não informado. Destino: ainda não informado.'), client.truckAccess)
  assert.equal(merged.clientNickname, 'Leila')
  assert.equal(merged.clientName, client.name)
  assert.equal(merged.vistoriaResolved, true)
  assert.equal(stabilizeExtraction(client, { originAddress: 'Rua B, 12' }).originAddress, 'Rua B, 12')
  assert.equal(stabilizeExtraction({}, { vistoriaResolved: true }).vistoriaResolved, false)
})

test('escadas: completa formato vazio e preserva cada lado conhecido', () => {
  assert.equal(mergeSides(null, 'Destino: elevador.', true), 'Origem: ainda não informado. Destino: elevador.')
  assert.equal(mergeSides(null, 'escada', true), 'Origem: ainda não informado. Destino: ainda não informado.')
  assert.equal(mergeSides(null, 'ainda não informado.'), 'Origem: ainda não informado. Destino: ainda não informado.')
  assert.equal(mergeSides('Origem: escada. Destino: elevador.', 'Origem: ainda não informado. Destino: térreo.'), 'Origem: escada. Destino: térreo.')
})

test('retry recupera falha temporária, limita tentativas e não repete erros permanentes', async () => {
  let calls = 0
  const delays = []
  assert.equal(await withApiRetry(async () => { if (++calls < 3) throw { status: 503 }; return 'ok' }, { sleep: async (ms) => delays.push(ms) }), 'ok')
  assert.deepEqual(delays, [400, 800])
  for (const status of [400, 401, 403, 404, 422, 429]) {
    calls = 0
    await assert.rejects(withApiRetry(async () => { calls++; throw Object.assign(new Error('API'), { status }) }, { sleep: async () => {} }))
    assert.equal(calls, status === 429 ? 3 : 1)
  }
})

test('amostra inclui extremos, exclui vazios e diferencia cosmética de conteúdo', () => {
  const conversations = [0, 1, 1, 5, 20, 100].map((n, i) => ({ file: `${i}.json`, messages: Array(n).fill({}) }))
  assert.deepEqual(pickSample(conversations, 3).map((c) => c.messages.length), [1, 5, 100])
  assert.equal(pickSample(conversations, 10).length, 5)
  assert.throws(() => pickSample(conversations, 0))
  assert.equal(cosmeticEqual('armário', 'Armario.'), true)
  assert.equal(cosmeticEqual('Sim, nos dois.', 'ainda não informado'), false)
  assert.equal(cosmeticEqual('Leila', null), false)
})

test('pipeline persiste dados comerciais e apelido sem alterar orçamento; ausência posterior não apaga CRM', async () => {
  const wa = makeFakeWaClient()
  const handler = createConversationHandler(wa, { botEnabledForAll: true, log: () => {}, schedule: () => {} })
  const chatId = `policy-${Date.now()}@c.us`
  await handler.handleIncomingMessage(makeFakeMessage({ fromMe: true, chatId, text: 'Condições propostas pelo operador' }))
  const client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  const date = new Date('2026-10-12T00:00:00')
  await prisma.client.update({ where: { id: client.id }, data: { movingDate: date, truckAccess: 'Sim, nos dois.', budgetValue: 4500, budgetNotes: 'Aprovado pela equipe' } })
  const mock = getMockOpenAi()
  mock.setHandler((body) => JSON.stringify(body.response_format?.json_schema?.name === 'client_moving_info'
    ? { clientNickname: 'Leila', commercialNotes: 'Operador propôs R$ 3.000; sem aceite.', movingNotes: 'Sofá', truckAccess: null, vistoriaResolved: false }
    : { vague: true }))
  try { await handler.processConversationTurn(client.id) } finally { mock.resetHandler() }
  await handler.processConversationTurn(client.id)
  const updated = await prisma.client.findUnique({ where: { id: client.id } })
  assert.equal(updated.movingDate.getTime(), date.getTime())
  assert.equal(updated.truckAccess, 'Sim, nos dois.')
  assert.equal(updated.clientNickname, 'Leila')
  assert.equal(updated.commercialNotes, 'Operador propôs R$ 3.000; sem aceite.')
  assert.equal(updated.movingNotes, 'Sofá')
  assert.equal(updated.budgetValue, 4500)
  assert.equal(updated.budgetNotes, 'Aprovado pela equipe')
  assert.equal(wa.sent.length, 0)
})

test('loader respeita BATTERY_EXPORT_DIR sem misturar os datasets', async () => {
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { loadConversations } = await import('./battery/loadConversations.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trevo-loader-'))
  const previous = process.env.BATTERY_EXPORT_DIR
  try {
    fs.writeFileSync(path.join(dir, 'fixture.json'), JSON.stringify({ contato: 'fixture', mensagens: [{ remetente: 'Cliente', texto: 'teste', timestamp: '2026-09-18T00:00:00Z' }] }))
    process.env.BATTERY_EXPORT_DIR = dir
    assert.deepEqual(loadConversations().map((c) => c.file), ['fixture.json'])
  } finally {
    if (previous === undefined) delete process.env.BATTERY_EXPORT_DIR
    else process.env.BATTERY_EXPORT_DIR = previous
    fs.rmSync(dir, { recursive: true })
  }
})
