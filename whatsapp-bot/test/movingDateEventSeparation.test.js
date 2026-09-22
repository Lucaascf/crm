// Regressão da correção P0.2 (docs/correcoes/02_SEPARACAO_DATAS_EVENTOS.md):
// o extrator de data de mudança (extractMovingDate) não pode confundir a
// data de outros eventos da conversa — vistoria, coleta, entrega — com a
// data da mudança em si. A defesa é o campo "event" dos sinais brutos: só
// "mudança" pode preencher movingDate, mesmo que os demais campos de data
// venham preenchidos (defesa em profundidade, ver src/ai.js).
//
// Estes testes mockam a resposta do modelo (como o resto da suíte faz,
// ver test/support/mockOpenAi.js) pra validar o PORTÃO determinístico em
// código. A separação de fato — o modelo reconhecer sozinho, a partir do
// texto real, a qual evento uma data pertence — foi validada com chamadas
// reais à API e está documentada em docs/correcoes/02_SEPARACAO_DATAS_EVENTOS.md,
// não repetida aqui pra manter a suíte determinística e sem custo de API.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractMovingDate } from '../src/ai.js'
import { createConversationHandler } from '../src/conversationHandler.js'
import { prisma } from '../src/db.js'
import { makeFakeWaClient, makeFakeMessage } from './support/fakeWaClient.js'
import { getMockOpenAi } from './support/mockOpenAiSingleton.js'

const BASE_SIGNALS = {
  event: null,
  weekdayName: null,
  period: null,
  relativeDays: null,
  relativeWeeks: null,
  dayOfMonth: null,
  monthName: null,
  vague: false,
}

function withMockedSignals(mock, signals) {
  mock.setHandler((body) => JSON.stringify(
    body.response_format?.json_schema?.name === 'moving_date_signals' ? { ...BASE_SIGNALS, ...signals } : {},
  ))
}

test('data explícita de mudança (event="mudança") é extraída normalmente', async () => {
  const mock = getMockOpenAi()
  withMockedSignals(mock, { event: 'mudança', dayOfMonth: 20, monthName: 'dezembro' })
  try {
    const result = await extractMovingDate(
      [{ direction: 'IN', text: 'Vamos fazer a mudança dia 20 de dezembro.' }],
      new Date('2026-09-01T12:00:00-03:00'),
    )
    assert.equal(result, '2026-12-20')
  } finally {
    mock.resetHandler()
  }
})

test('data relativa de mudança (event="mudança") é extraída normalmente', async () => {
  const mock = getMockOpenAi()
  withMockedSignals(mock, { event: 'mudança', relativeDays: 5 })
  try {
    const result = await extractMovingDate(
      [{ direction: 'IN', text: 'A mudança vai ser daqui a 5 dias.' }],
      new Date('2026-09-01T12:00:00-03:00'),
    )
    assert.equal(result, '2026-09-06')
  } finally {
    mock.resetHandler()
  }
})

for (const event of ['vistoria', 'coleta', 'entrega']) {
  test(`data de ${event} (event="${event}") NUNCA preenche movingDate, mesmo com sinais de data completos`, async () => {
    const mock = getMockOpenAi()
    // Sinais de data plenamente preenchidos, exatamente como aconteceria se
    // o modelo extraísse "amanhã" ou um dia da semana de uma resposta sobre
    // vistoria/coleta/entrega — o portão em código deve barrar mesmo assim.
    withMockedSignals(mock, { event, weekdayName: 'sexta-feira', relativeDays: 1 })
    try {
      const result = await extractMovingDate(
        [{ direction: 'IN', text: `Combinado, a ${event} pode ser amanhã à tarde.` }],
        new Date('2026-09-01T12:00:00-03:00'),
      )
      assert.equal(result, null)
    } finally {
      mock.resetHandler()
    }
  })
}

test('event=null (nenhum evento identificado) não preenche movingDate mesmo com sinais de data presentes', async () => {
  const mock = getMockOpenAi()
  withMockedSignals(mock, { event: null, relativeDays: 2 })
  try {
    const result = await extractMovingDate(
      [{ direction: 'IN', text: 'amanhã ou depois' }],
      new Date('2026-09-01T12:00:00-03:00'),
    )
    assert.equal(result, null, 'sem identificação clara do evento, nunca deve presumir que é a mudança')
  } finally {
    mock.resetHandler()
  }
})

test('mensagem com dois eventos: sinais já isolados para "mudança" pelo modelo são respeitados', async () => {
  const mock = getMockOpenAi()
  // Simula o modelo tendo corretamente identificado, dentro de uma mensagem
  // com duas datas ("vistoria amanhã, mudança dia 20"), que os SINAIS
  // BRUTOS devolvidos (dayOfMonth=20) são os da mudança — não os da
  // vistoria ("amanhã"), que o prompt instrui a nunca preencher junto.
  withMockedSignals(mock, { event: 'mudança', dayOfMonth: 20 })
  try {
    const result = await extractMovingDate(
      [{ direction: 'IN', text: 'A vistoria pode ser amanhã, mas a mudança mesmo só dia 20.' }],
      new Date('2026-09-01T12:00:00-03:00'),
    )
    assert.equal(result, '2026-09-20')
  } finally {
    mock.resetHandler()
  }
})

test('mensagem ambígua sobre a qual evento a data pertence: vague=true também barra, mesmo com event="mudança"', async () => {
  const mock = getMockOpenAi()
  withMockedSignals(mock, { event: 'mudança', vague: true })
  try {
    const result = await extractMovingDate(
      [{ direction: 'IN', text: 'ainda não sei bem quando vai ser' }],
      new Date('2026-09-01T12:00:00-03:00'),
    )
    assert.equal(result, null)
  } finally {
    mock.resetHandler()
  }
})

test('histórico longo (>12 mensagens): só a janela recente é considerada, e uma data de mudança recente ainda é extraída', async () => {
  const mock = getMockOpenAi()
  withMockedSignals(mock, { event: 'mudança', dayOfMonth: 3, monthName: 'novembro' })
  const history = []
  for (let i = 0; i < 20; i++) {
    history.push({ direction: i % 2 === 0 ? 'IN' : 'OUT_HUMAN', text: `mensagem antiga ${i}, sem relação com data` })
  }
  history.push({ direction: 'IN', text: 'Só confirmando: a mudança vai ser dia 3 de novembro.' })
  try {
    const result = await extractMovingDate(history, new Date('2026-09-01T12:00:00-03:00'))
    assert.equal(result, '2026-11-03')
  } finally {
    mock.resetHandler()
  }
})

// Integração com o fluxo real de turno a turno (processConversationTurn):
// confirma que uma pergunta/resposta de VISTORIA não altera movingDate, e
// que uma correção de data real subsequente é aplicada corretamente — sem
// tocar em nenhum dataset, mensagem real de WhatsApp ou serviço de produção
// (fakeWaClient nunca manda mensagem de verdade).
test('integração: agendamento de vistoria não altera movingDate; correção posterior de data de mudança é aplicada', async () => {
  const chatId = `p02-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@c.us`
  const waClient = makeFakeWaClient()
  const handler = createConversationHandler(waClient, { testContacts: [chatId], log: () => {} })
  const mock = getMockOpenAi()

  await handler.handleIncomingMessage(makeFakeMessage({ fromMe: false, chatId, text: 'Pode ser a vistoria amanhã à tarde.' }))
  let client = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })

  // Turno 1: cliente responde à pergunta de agendamento de VISTORIA — o
  // modelo (mockado) identifica corretamente event="vistoria".
  mock.setHandler((body) => {
    const name = body.response_format?.json_schema?.name
    if (name === 'moving_date_signals') return JSON.stringify({ ...BASE_SIGNALS, event: 'vistoria', relativeDays: 1 })
    if (name === 'client_moving_info') {
      return JSON.stringify({
        clientName: null, clientNickname: null, originAddress: null, destinationAddress: null,
        propertyType: null, movingNotes: null, commercialNotes: null, stairsOrElevator: null, truckAccess: null,
        vistoriaType: null, vistoriaResolved: false,
      })
    }
    return 'ok'
  })
  await handler.processConversationTurn(client.id)
  client = await prisma.client.findUnique({ where: { id: client.id } })
  assert.equal(client.movingDate, null, 'resposta sobre vistoria não deve preencher movingDate')

  // Turno 2: cliente agora dá a data real da mudança — event="mudança".
  mock.setHandler((body) => {
    const name = body.response_format?.json_schema?.name
    if (name === 'moving_date_signals') return JSON.stringify({ ...BASE_SIGNALS, event: 'mudança', dayOfMonth: 15, monthName: 'outubro' })
    if (name === 'client_moving_info') {
      return JSON.stringify({
        clientName: null, clientNickname: null, originAddress: null, destinationAddress: null,
        propertyType: null, movingNotes: null, commercialNotes: null, stairsOrElevator: null, truckAccess: null,
        vistoriaType: null, vistoriaResolved: false,
      })
    }
    return 'ok'
  })
  await handler.handleIncomingMessage(makeFakeMessage({ fromMe: false, chatId, text: 'A mudança em si vai ser dia 15 de outubro.' }))
  await handler.processConversationTurn(client.id)
  client = await prisma.client.findUnique({ where: { id: client.id } })
  assert.equal(client.movingDate.toISOString().slice(0, 10), '2026-10-15')

  // Turno 3: cliente corrige a data da mudança.
  mock.setHandler((body) => {
    const name = body.response_format?.json_schema?.name
    if (name === 'moving_date_signals') return JSON.stringify({ ...BASE_SIGNALS, event: 'mudança', dayOfMonth: 22, monthName: 'outubro' })
    if (name === 'client_moving_info') {
      return JSON.stringify({
        clientName: null, clientNickname: null, originAddress: null, destinationAddress: null,
        propertyType: null, movingNotes: null, commercialNotes: null, stairsOrElevator: null, truckAccess: null,
        vistoriaType: null, vistoriaResolved: false,
      })
    }
    return 'ok'
  })
  await handler.handleIncomingMessage(makeFakeMessage({ fromMe: false, chatId, text: 'Na verdade vai ter que ser dia 22, não dia 15.' }))
  await handler.processConversationTurn(client.id)
  client = await prisma.client.findUnique({ where: { id: client.id } })
  assert.equal(client.movingDate.toISOString().slice(0, 10), '2026-10-22', 'correção posterior da data de mudança deve substituir a anterior')

  mock.resetHandler()
})
