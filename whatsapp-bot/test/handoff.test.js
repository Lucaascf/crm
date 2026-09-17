import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConversationHandler } from '../src/conversationHandler.js'
import { prisma } from '../src/db.js'
import { isHumanHandoffActive, HUMAN_HANDOFF_COOLDOWN_MS } from '../src/clientState.js'
import { makeFakeWaClient, makeFakeMessage } from './support/fakeWaClient.js'
import { getMockOpenAi } from './support/mockOpenAiSingleton.js'

function uniqueChatId(label) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@c.us`
}

async function setupHandler(chatId) {
  const waClient = makeFakeWaClient()
  const handler = createConversationHandler(waClient, { testContacts: [chatId], log: () => {} })
  return { waClient, handler }
}

// A. Fluxo normal — cliente manda mensagem, bot pode responder.
test('A. fluxo normal: cliente sem intervenção humana recebe resposta automática', async () => {
  const chatId = uniqueChatId('a')
  const { waClient, handler } = await setupHandler(chatId)

  await handler.handleIncomingMessage(makeFakeMessage({ fromMe: false, chatId, text: 'Bom dia, preciso de orçamento' }))
  const client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  await handler.processConversationTurn(client.id)

  assert.equal(waClient.sent.length, 1, 'bot deveria responder no fluxo normal')
  assert.equal(await isHumanHandoffActive(await prisma.client.findUnique({ where: { id: client.id } })), false)
})

// B. Primeiro takeover — humano manda mensagem, bot entra em handoff.
test('B. primeiro takeover: mensagem humana é registrada, processa CRM e não responde', async () => {
  const chatId = uniqueChatId('b')
  const { waClient, handler } = await setupHandler(chatId)
  const mock = getMockOpenAi()

  await handler.handleIncomingMessage(makeFakeMessage({ fromMe: false, chatId, text: 'Quero fazer uma mudança de Salvador para Feira' }))
  let client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  await handler.processConversationTurn(client.id) // turno normal, bot responde 1x
  assert.equal(waClient.sent.length, 1)

  mock.clearCalls()
  await handler.handleIncomingMessage(makeFakeMessage({ fromMe: true, chatId, text: 'Qual o bairro de origem?' }))
  client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  assert.ok(client.lastHumanMessageAt, 'lastHumanMessageAt deveria ter sido marcado')
  assert.equal(await isHumanHandoffActive(client), true)

  await handler.processConversationTurn(client.id)

  const messages = await prisma.message.findMany({ where: { clientId: client.id }, orderBy: { createdAt: 'asc' } })
  const humanMsg = messages.find((m) => m.text === 'Qual o bairro de origem?')
  assert.ok(humanMsg, 'mensagem humana deveria estar no histórico')
  assert.equal(humanMsg.direction, 'OUT_HUMAN')

  const extractionCalls = mock.calls.filter((b) => b.response_format?.json_schema?.name === 'client_moving_info')
  assert.ok(extractionCalls.length >= 1, 'extração deveria ter rodado depois da mensagem humana (CRM processado)')

  assert.equal(waClient.sent.length, 1, 'bot NÃO deveria ter mandado nova mensagem automática depois do takeover')
})

// C. Cliente continua falando depois do humano — CRM continua atualizando, bot continua quieto.
test('C. cliente continua falando após handoff: CRM atualiza, bot permanece silencioso', async () => {
  const chatId = uniqueChatId('c')
  const { waClient, handler } = await setupHandler(chatId)
  const mock = getMockOpenAi()

  await handler.handleIncomingMessage(makeFakeMessage({ fromMe: false, chatId, text: 'Quero mudar de Salvador para Feira' }))
  let client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  await handler.processConversationTurn(client.id)

  await handler.handleIncomingMessage(makeFakeMessage({ fromMe: true, chatId, text: 'Qual o bairro de origem?' }))
  client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  await handler.processConversationTurn(client.id)
  const sentAfterHandoff = waClient.sent.length

  mock.setHandler((body) => {
    if (body.response_format?.json_schema?.name === 'client_moving_info') {
      return JSON.stringify({
        clientName: null, clientNickname: null,
        originAddress: 'Pituba, Salvador', destinationAddress: null,
        propertyType: null, movingNotes: null, stairsOrElevator: null, truckAccess: null,
        vistoriaType: null, vistoriaResolved: false,
      })
    }
    return JSON.stringify({ weekdayName: null, period: null, relativeDays: null, relativeWeeks: null, dayOfMonth: null, monthName: null, vague: true })
  })

  await handler.handleIncomingMessage(makeFakeMessage({ fromMe: false, chatId, text: 'Pituba' }))
  client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  await handler.processConversationTurn(client.id)

  const updated = await prisma.client.findUnique({ where: { id: client.id } })
  assert.equal(updated.originAddress, 'Pituba, Salvador', 'CRM deveria ter sido atualizado com a resposta do cliente durante o handoff')
  assert.equal(waClient.sent.length, sentAfterHandoff, 'bot continua sem mandar mensagem automática')
  mock.resetHandler()
})

// D. Várias mensagens humanas intercaladas com o cliente — estado não quebra.
test('D. sequência humano/cliente/humano/cliente/humano: estado consistente, sem crash', async () => {
  const chatId = uniqueChatId('d')
  const { waClient, handler } = await setupHandler(chatId)

  const turns = [
    { fromMe: true, text: 'Boa tarde, aqui é o Luciano' },
    { fromMe: false, text: 'Boa tarde!' },
    { fromMe: true, text: 'Qual o endereço de origem?' },
    { fromMe: false, text: 'Rua das Flores, 123' },
    { fromMe: true, text: 'Perfeito, anotado' },
  ]

  for (const turn of turns) {
    await handler.handleIncomingMessage(makeFakeMessage({ fromMe: turn.fromMe, chatId, text: turn.text }))
    const client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
    await handler.processConversationTurn(client.id)
  }

  const client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  const messages = await prisma.message.findMany({ where: { clientId: client.id } })
  assert.equal(messages.length, turns.length, 'todas as mensagens deveriam estar persistidas')
  assert.equal(waClient.sent.length, 0, 'bot não deveria ter mandado nenhuma mensagem automática')
  assert.equal(await isHumanHandoffActive(client), true)
})

// E. Humano manda informação importante (data) — verifica se chega ao CRM.
test('E. informação relevante numa mensagem humana é incorporada ao CRM', async () => {
  const chatId = uniqueChatId('e')
  const { handler } = await setupHandler(chatId)
  const mock = getMockOpenAi()

  await handler.handleIncomingMessage(makeFakeMessage({ fromMe: false, chatId, text: 'Quero agendar minha mudança' }))
  let client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  await handler.processConversationTurn(client.id)

  mock.setHandler((body) => {
    const name = body.response_format?.json_schema?.name
    if (name === 'moving_date_signals') {
      // "amanhã às 14h" -> relativeDays = 1 (ver MOVING_DATE_SIGNALS_SYSTEM_PROMPT)
      return JSON.stringify({ weekdayName: null, period: null, relativeDays: 1, relativeWeeks: null, dayOfMonth: null, monthName: null, vague: false })
    }
    if (name === 'client_moving_info') {
      return JSON.stringify({
        clientName: null, clientNickname: null, originAddress: null, destinationAddress: null,
        propertyType: null, movingNotes: null, stairsOrElevator: null, truckAccess: null,
        vistoriaType: null, vistoriaResolved: false,
      })
    }
    return 'ok'
  })

  await handler.handleIncomingMessage(makeFakeMessage({ fromMe: true, chatId, text: 'Ficou combinado para amanhã às 14h.' }))
  client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  await handler.processConversationTurn(client.id)

  const updated = await prisma.client.findUnique({ where: { id: client.id } })
  assert.ok(updated.movingDate, 'movingDate deveria ter sido preenchido a partir da mensagem humana')

  const tomorrow = new Date()
  tomorrow.setHours(0, 0, 0, 0)
  tomorrow.setDate(tomorrow.getDate() + 1)
  assert.equal(updated.movingDate.toDateString(), tomorrow.toDateString())
  mock.resetHandler()
})

// F. Conversa sem intervenção humana — comportamento antigo intacto (regressão).
test('F. sem intervenção humana: comportamento automático de ponta a ponta continua igual', async () => {
  const chatId = uniqueChatId('f')
  const { waClient, handler } = await setupHandler(chatId)
  const mock = getMockOpenAi()

  mock.setHandler((body) => {
    const name = body.response_format?.json_schema?.name
    if (name === 'client_moving_info') {
      return JSON.stringify({
        clientName: 'João Silva', clientNickname: null,
        originAddress: 'Rua A, 1', destinationAddress: 'Rua B, 2',
        propertyType: 'Casa', movingNotes: 'Sofá, geladeira',
        stairsOrElevator: 'Origem: escada. Destino: elevador.',
        truckAccess: 'Sim, nos dois',
        vistoriaType: 'fotos', vistoriaResolved: true,
      })
    }
    if (name === 'moving_date_signals') {
      return JSON.stringify({ weekdayName: null, period: null, relativeDays: 3, relativeWeeks: null, dayOfMonth: null, monthName: null, vague: false })
    }
    return 'Beleza! Pode mandar as fotos e vídeos, por favor.'
  })

  await handler.handleIncomingMessage(makeFakeMessage({ fromMe: false, chatId, text: 'Meu nome é João Silva, quero mudar de Rua A pra Rua B' }))
  const client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  await handler.processConversationTurn(client.id)

  const updated = await prisma.client.findUnique({ where: { id: client.id } })
  assert.equal(updated.name, 'João Silva')
  assert.equal(updated.nameConfirmed, true)
  assert.equal(updated.vistoriaResolved, true)
  assert.equal(updated.vistoriaType, 'fotos')
  assert.equal(updated.collectingVistoriaMedia, true, 'vistoriaType=fotos deveria entrar em coleta de mídia')
  assert.equal(waClient.sent.length, 1, 'bot deveria ter respondido pedindo as fotos')
  mock.resetHandler()
})

// G. Mensagem humana logo após resposta do bot — o eco da própria resposta
// do bot não pode ser confundido com intervenção humana, e a intervenção
// humana real não pode ser seguida de outra resposta automática.
test('G. eco da própria resposta do bot não ativa handoff; intervenção humana real sim', async () => {
  const chatId = uniqueChatId('g')
  const { waClient, handler } = await setupHandler(chatId)

  await handler.handleIncomingMessage(makeFakeMessage({ fromMe: false, chatId, text: 'Oi, quero orçamento' }))
  let client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  await handler.processConversationTurn(client.id)
  assert.equal(waClient.sent.length, 1)

  // Simula o eco que whatsapp-web.js manda de volta (message_create,
  // fromMe=true) pra ESSA MESMA mensagem que o bot acabou de enviar.
  const echoId = waClient.sent[0].id
  await handler.handleIncomingMessage(
    makeFakeMessage({ fromMe: true, chatId, text: waClient.sent[0].text, waMessageId: echoId }),
  )
  client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  assert.equal(client.lastHumanMessageAt, null, 'eco da própria mensagem do bot NÃO deveria ativar handoff')

  const messagesAfterEcho = await prisma.message.findMany({ where: { clientId: client.id } })
  assert.equal(messagesAfterEcho.length, 2, 'eco não deveria ter criado uma mensagem duplicada')

  // Agora uma intervenção humana de verdade (id diferente).
  await handler.handleIncomingMessage(makeFakeMessage({ fromMe: true, chatId, text: 'Deixa que eu assumo daqui' }))
  client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  assert.ok(client.lastHumanMessageAt, 'mensagem humana real deveria ativar handoff')

  await handler.processConversationTurn(client.id)
  assert.equal(waClient.sent.length, 1, 'bot não pode falar por cima do humano depois da intervenção real')
})

// H. Mensagens humanas consecutivas — sem gerar resposta automática.
test('H. mensagens humanas consecutivas não geram nenhuma resposta automática', async () => {
  const chatId = uniqueChatId('h')
  const { waClient, handler } = await setupHandler(chatId)

  for (const text of ['Oi', 'Deixa comigo', 'Já te retorno']) {
    await handler.handleIncomingMessage(makeFakeMessage({ fromMe: true, chatId, text }))
    const client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
    await handler.processConversationTurn(client.id)
  }

  assert.equal(waClient.sent.length, 0)
  const client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  assert.equal(await isHumanHandoffActive(client), true)
})

// I. Reinício do processo — o estado de handoff (banco) sobrevive; o
// dedup de eco em memória (botSentMessageIds) não precisa sobreviver,
// porque depois de um restart não há eco pendente de mensagem nenhuma.
test('I. handoff sobrevive a um "restart" do processo (novo handler/instância)', async () => {
  const chatId = uniqueChatId('i')
  const { handler: handlerBeforeRestart } = await setupHandler(chatId)

  await handlerBeforeRestart.handleIncomingMessage(makeFakeMessage({ fromMe: true, chatId, text: 'Assumindo essa conversa' }))
  const clientBefore = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  assert.ok(clientBefore.lastHumanMessageAt)

  // "Restart": nova instância do handler, novo waClient — só o banco
  // (Prisma) persiste entre as duas, exatamente como seria entre dois
  // processos do bot.
  const waClientAfterRestart = makeFakeWaClient()
  const handlerAfterRestart = createConversationHandler(waClientAfterRestart, { testContacts: [chatId], log: () => {} })

  await handlerAfterRestart.handleIncomingMessage(makeFakeMessage({ fromMe: false, chatId, text: 'Cliente manda mensagem depois do restart' }))
  const clientAfter = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  assert.equal(await isHumanHandoffActive(clientAfter), true, 'handoff persistido no banco deveria sobreviver ao restart')

  await handlerAfterRestart.processConversationTurn(clientAfter.id)
  assert.equal(waClientAfterRestart.sent.length, 0, 'bot não deveria responder depois do restart enquanto o handoff persistido ainda vale')
})

// J. Concorrência — mensagens quase simultâneas (cliente/humano) num chat
// NOVO (Client ainda não existe) não podem criar Client duplicado nem
// perder mensagem.
test('J. concorrência: mensagens simultâneas em chat novo não duplicam Client nem perdem mensagem', async () => {
  const chatId = uniqueChatId('j')
  const { handler } = await setupHandler(chatId)

  const texts = [
    { fromMe: false, text: 'Cliente 1' },
    { fromMe: true, text: 'Humano 1' },
    { fromMe: false, text: 'Cliente 2' },
    { fromMe: true, text: 'Humano 2' },
  ]

  await Promise.all(texts.map((t) => handler.handleIncomingMessage(makeFakeMessage({ fromMe: t.fromMe, chatId, text: t.text }))))

  const clients = await prisma.client.findMany({ where: { whatsappChatId: chatId } })
  assert.equal(clients.length, 1, 'não pode ter criado Client duplicado na corrida')

  const messages = await prisma.message.findMany({ where: { clientId: clients[0].id } })
  assert.equal(messages.length, texts.length, 'nenhuma mensagem pode ter sido perdida na corrida')

  await assert.doesNotReject(handler.processConversationTurn(clients[0].id), 'processConversationTurn não pode lançar depois da corrida')
})

// Extra: duas mensagens com o MESMO waMessageId (corrida entre o eco do
// bot e o Set em memória) não duplicam no banco (defesa da constraint
// única, ver isDuplicateWaMessageError).
test('extra: waMessageId duplicado simultâneo não gera Message duplicada', async () => {
  const chatId = uniqueChatId('dup')
  const { handler } = await setupHandler(chatId)
  const sharedId = `wamid.DUP_${Date.now()}`

  await Promise.allSettled([
    handler.handleIncomingMessage(makeFakeMessage({ fromMe: true, chatId, text: 'Mesma mensagem', waMessageId: sharedId })),
    handler.handleIncomingMessage(makeFakeMessage({ fromMe: true, chatId, text: 'Mesma mensagem', waMessageId: sharedId })),
  ])

  const client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
  const messages = await prisma.message.findMany({ where: { clientId: client.id, waMessageId: sharedId } })
  assert.equal(messages.length, 1, 'waMessageId é único — não pode duplicar mesmo com corrida')
})
