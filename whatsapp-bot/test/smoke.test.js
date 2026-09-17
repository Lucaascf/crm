import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConversationHandler } from '../src/conversationHandler.js'
import { prisma } from '../src/db.js'
import { makeFakeWaClient, makeFakeMessage } from './support/fakeWaClient.js'

test('infra: cliente manda mensagem, bot processa e responde (sanity check)', async () => {
  const chatId = `smoke-${Date.now()}@c.us`
  const waClient = makeFakeWaClient()
  const handler = createConversationHandler(waClient, { testContacts: [chatId], log: () => {} })

  const msg = makeFakeMessage({ fromMe: false, chatId, text: 'Boa tarde, quero orçamento' })
  await handler.handleIncomingMessage(msg)

  const client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  assert.ok(client, 'Client deveria ter sido criado')

  await handler.processConversationTurn(client.id)

  assert.equal(waClient.sent.length, 1, 'bot deveria ter respondido uma vez')
  const messages = await prisma.message.findMany({ where: { clientId: client.id }, orderBy: { createdAt: 'asc' } })
  assert.equal(messages.length, 2, 'deveria ter a mensagem IN do cliente + a OUT do bot')
  assert.equal(messages[0].direction, 'IN')
  assert.equal(messages[1].direction, 'OUT')
})
