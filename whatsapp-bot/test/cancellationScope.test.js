// Regressão da correção P1.1 (docs/correcoes/05_CANCELAMENTOS_ESTRUTURADOS.md):
// o extrator não tinha nenhum estado estruturado para representar que um
// cliente cancelou a mudança inteira (ver relatório final, seção 6.5). A
// defesa em código é: (1) stabilizeExtraction nunca deixa a política de
// preservação-contra-null bloquear um cancelamento explícito, nem permite
// que o cancelamento "regrida" por incerteza do modelo numa rodada em que
// o assunto não voltou à tona — só uma reativação/reagendamento EXPLÍCITO
// (sinalizado por cancellationEvidence não-nulo acompanhando
// movingCancelled=false) reverte; (2) processConversationTurn persiste o
// novo estado sem alterar nenhuma condição de handoff, cooldown ou envio
// de mensagem automática.
//
// A distinção de ESCOPO em si (mudança inteira vs. só um agendamento/data
// específica, ver EXTRACTION_SYSTEM_PROMPT em src/ai.js) depende do
// modelo interpretar o texto real da conversa — isso foi validado com
// chamadas reais à API contra os dois casos citados no relatório
// (export/557185564498.json e export/557188926234.json) e está
// documentado em docs/correcoes/05_CANCELAMENTOS_ESTRUTURADOS.md, não
// repetido aqui pra manter a suíte determinística e sem custo de API.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stabilizeExtraction } from '../src/extractionPolicy.js'
import { createConversationHandler } from '../src/conversationHandler.js'
import { prisma } from '../src/db.js'
import { makeFakeWaClient, makeFakeMessage } from './support/fakeWaClient.js'
import { getMockOpenAi } from './support/mockOpenAiSingleton.js'

test('cancelamento explícito é aceito mesmo com a política de preservação contra null', () => {
  const client = { movingCancelled: false, cancellationEvidence: null }
  const result = stabilizeExtraction(client, { movingCancelled: true, cancellationEvidence: 'A mudança foi cancelada.' })
  assert.equal(result.movingCancelled, true)
  assert.equal(result.cancellationEvidence, 'A mudança foi cancelada.')
})

test('cancelamento confirmado não regride por incerteza do modelo (novo "false" sem evidência de reativação)', () => {
  const client = { movingCancelled: true, cancellationEvidence: 'A mudança foi cancelada.' }
  const result = stabilizeExtraction(client, { movingCancelled: false, cancellationEvidence: null })
  assert.equal(result.movingCancelled, true)
  assert.equal(result.cancellationEvidence, 'A mudança foi cancelada.')
})

test('reativação/reagendamento explícito (com evidência) reverte o cancelamento', () => {
  const client = { movingCancelled: true, cancellationEvidence: 'A mudança foi cancelada.' }
  const result = stabilizeExtraction(client, {
    movingCancelled: false,
    cancellationEvidence: 'Cliente confirmou que vai remarcar e seguir com a mudança.',
  })
  assert.equal(result.movingCancelled, false)
  assert.equal(result.cancellationEvidence, 'Cliente confirmou que vai remarcar e seguir com a mudança.')
})

test('declaração ambígua (modelo não marcou cancelamento) não mexe em movingCancelled nem nos demais campos', () => {
  const client = { movingCancelled: false, cancellationEvidence: null, originAddress: 'Rua A, 42' }
  const result = stabilizeExtraction(client, { movingCancelled: false, cancellationEvidence: null, originAddress: 'Rua A, 42' })
  assert.equal(result.movingCancelled, false)
  assert.equal(result.cancellationEvidence, null)
  assert.equal(result.originAddress, 'Rua A, 42')
})

test('cancelamento explícito não apaga nome, endereços nem itens já coletados', () => {
  const client = {
    name: 'Fulano de Tal',
    nameConfirmed: true,
    originAddress: 'Rua A, 42',
    destinationAddress: 'Rua B, 99',
    movingNotes: 'Sofá, geladeira',
  }
  const result = stabilizeExtraction(client, {
    clientName: null,
    originAddress: 'Rua A, 42',
    destinationAddress: 'Rua B, 99',
    movingNotes: 'Sofá, geladeira',
    movingCancelled: true,
    cancellationEvidence: 'A mudança foi cancelada.',
  })
  assert.equal(result.clientName, 'Fulano de Tal')
  assert.equal(result.originAddress, 'Rua A, 42')
  assert.equal(result.destinationAddress, 'Rua B, 99')
  assert.equal(result.movingNotes, 'Sofá, geladeira')
  assert.equal(result.movingCancelled, true)
})

function withMockedExtraction(mock, fields) {
  mock.setHandler((body) => JSON.stringify(
    body.response_format?.json_schema?.name === 'client_moving_info'
      ? {
          clientName: null,
          clientNickname: null,
          originAddress: null,
          destinationAddress: null,
          propertyType: null,
          movingNotes: null,
          commercialNotes: null,
          stairsOrElevator: null,
          truckAccess: null,
          vistoriaType: null,
          vistoriaResolved: false,
          movingCancelled: false,
          cancellationEvidence: null,
          ...fields,
        }
      : { vague: true },
  ))
}

test('pipeline: cancelamento explícito grava estado estruturado sem apagar dados nem mudar envio de mensagem', async () => {
  const wa = makeFakeWaClient()
  const handler = createConversationHandler(wa, { botEnabledForAll: true, log: () => {}, schedule: () => {} })
  const chatId = `cancel-${Date.now()}@c.us`
  await handler.handleIncomingMessage(makeFakeMessage({ fromMe: false, chatId, text: 'Oi' }))
  const client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  await prisma.client.update({
    where: { id: client.id },
    data: {
      nameConfirmed: true,
      name: 'Fulano de Tal',
      originAddress: 'Rua A, 42',
      destinationAddress: 'Rua B, 99',
      movingNotes: 'Sofá, geladeira',
    },
  })

  const mock = getMockOpenAi()
  withMockedExtraction(mock, {
    originAddress: 'Rua A, 42',
    destinationAddress: 'Rua B, 99',
    movingNotes: 'Sofá, geladeira',
    movingCancelled: true,
    cancellationEvidence: 'A mudança foi cancelada.',
  })
  const sentBefore = wa.sent.length
  try {
    await handler.processConversationTurn(client.id)
  } finally {
    mock.resetHandler()
  }

  const updated = await prisma.client.findUnique({ where: { id: client.id } })
  assert.equal(updated.movingCancelled, true)
  assert.ok(updated.movingCancelledAt instanceof Date)
  assert.equal(updated.cancellationEvidence, 'A mudança foi cancelada.')
  // Requisito 5: cancelar não apaga o que já foi coletado.
  assert.equal(updated.name, 'Fulano de Tal')
  assert.equal(updated.originAddress, 'Rua A, 42')
  assert.equal(updated.destinationAddress, 'Rua B, 99')
  assert.equal(updated.movingNotes, 'Sofá, geladeira')
  // Requisito 10: esta correção não muda nenhuma condição de envio —
  // continua mandando a próxima pergunta normalmente, como antes dela.
  assert.equal(wa.sent.length > sentBefore, true)
})

test('pipeline: reativação explícita após cancelamento limpa movingCancelledAt e atualiza a evidência', async () => {
  const wa = makeFakeWaClient()
  const handler = createConversationHandler(wa, { botEnabledForAll: true, log: () => {}, schedule: () => {} })
  const chatId = `reactivate-${Date.now()}@c.us`
  await handler.handleIncomingMessage(makeFakeMessage({ fromMe: false, chatId, text: 'Oi' }))
  const client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  await prisma.client.update({
    where: { id: client.id },
    data: { movingCancelled: true, movingCancelledAt: new Date('2026-08-04T12:00:00-03:00'), cancellationEvidence: 'A mudança foi cancelada.' },
  })

  const mock = getMockOpenAi()
  withMockedExtraction(mock, {
    movingCancelled: false,
    cancellationEvidence: 'Cliente confirmou que vai remarcar e seguir com a mudança.',
  })
  try {
    await handler.processConversationTurn(client.id)
  } finally {
    mock.resetHandler()
  }

  const updated = await prisma.client.findUnique({ where: { id: client.id } })
  assert.equal(updated.movingCancelled, false)
  assert.equal(updated.movingCancelledAt, null)
  assert.equal(updated.cancellationEvidence, 'Cliente confirmou que vai remarcar e seguir com a mudança.')
})
