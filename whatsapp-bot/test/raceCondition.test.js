import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConversationHandler } from '../src/conversationHandler.js'
import { prisma } from '../src/db.js'
import { markHumanHandoff } from '../src/clientState.js'
import { makeFakeWaClient, makeFakeMessage } from './support/fakeWaClient.js'
import { getMockOpenAi } from './support/mockOpenAiSingleton.js'

function uniqueChatId(label) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@c.us`
}

// Achado rodando a bateria real (ver relatório): processConversationTurn
// calculava handoffActive UMA VEZ no topo e reusava esse valor até o fim,
// mesmo depois de chamadas de IA que levam segundos de verdade. Se uma
// mensagem humana chegasse ENQUANTO extractClientInfo/generateReply ainda
// estavam rodando, o bot mandava a resposta mesmo assim — o handoff só era
// checado com dado já desatualizado. Este teste reproduz isso com um mock
// de IA lento (delay) e uma intervenção humana "chegando" no meio do
// processamento.
test('handoff que chega DURANTE o processamento (extração lenta) ainda bloqueia o envio', async () => {
  const chatId = uniqueChatId('race')
  const waClient = makeFakeWaClient()
  const handler = createConversationHandler(waClient, { testContacts: [chatId], log: () => {} })
  const mock = getMockOpenAi()

  await handler.handleIncomingMessage(makeFakeMessage({ fromMe: false, chatId, text: 'Bom dia, quero orçamento' }))
  const client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })

  // Simula a extração real demorando — e, ENQUANTO ela "está rodando",
  // uma mensagem humana chega e ativa o handoff antes da extração
  // terminar (equivalente ao que a latência real da API expôs).
  let handoffFiredMidflight = false
  mock.setHandler((body) => {
    if (!handoffFiredMidflight) {
      handoffFiredMidflight = true
      // dispara "em paralelo" (sem await, propositalmente) — o handler já
      // devolveu a resposta da extração quando isso resolver, simulando o
      // humano intervindo enquanto o turno ainda está em andamento
      markHumanHandoff(client.id)
    }
    const name = body.response_format?.json_schema?.name
    if (name === 'client_moving_info') {
      return JSON.stringify({
        clientName: null, clientNickname: null, originAddress: null, destinationAddress: null,
        propertyType: null, movingNotes: null, stairsOrElevator: null, truckAccess: null,
        vistoriaType: null, vistoriaResolved: false,
      })
    }
    if (name === 'moving_date_signals') {
      return JSON.stringify({ weekdayName: null, period: null, relativeDays: null, relativeWeeks: null, dayOfMonth: null, monthName: null, vague: true })
    }
    return 'Bom dia! Me chamo Luciano. Qual seu nome completo?'
  })

  await handler.processConversationTurn(client.id)

  assert.equal(waClient.sent.length, 0, 'bot não pode mandar resposta automática se o handoff ativou durante o processamento deste turno')

  mock.resetHandler()
})
