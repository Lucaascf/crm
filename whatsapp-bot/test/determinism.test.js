import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractClientInfo, extractMovingDate, classifyVistoriaResponse, classifyMediaSubmissionComplete, generateReply } from '../src/ai.js'
import { getMockOpenAi } from './support/mockOpenAiSingleton.js'

// Seção 12 do pedido: extractClientInfo/extractMovingDate/
// classifyVistoriaResponse/classifyMediaSubmissionComplete são tarefas de
// extração/classificação/atualização estruturada — nenhuma delas definia
// `temperature` antes (default da API = 1.0), o que foi apontado como
// causa de vistoriaResolved mudar de valor entre duas execuções idênticas.
// Este teste não prova determinismo da API de verdade (isso só a chamada
// real garante, testado à parte na bateria com custo real) — prova que o
// CÓDIGO está mandando temperature=0 nessas quatro chamadas, e que
// generateReply (geração de texto natural, não extração) continua sem
// forçar temperature, de propósito.
test('extração/classificação mandam temperature=0; generateReply não força temperature', async () => {
  const mock = getMockOpenAi()
  mock.clearCalls()

  const client = {
    nameConfirmed: false, name: null, originAddress: null, destinationAddress: null,
    propertyType: null, movingNotes: null, stairsOrElevator: null, truckAccess: null,
    vistoriaResolved: false, vistoriaType: null,
  }
  const history = [{ direction: 'IN', text: 'Oi' }]

  await extractClientInfo(client, history)
  await extractMovingDate(history)
  await classifyVistoriaResponse(history)
  await classifyMediaSubmissionComplete(history)
  await generateReply(history, [{ label: 'nome completo do cliente' }])

  assert.equal(mock.calls.length, 5)
  const [extractCall, dateCall, vistoriaCall, mediaCall, replyCall] = mock.calls

  assert.equal(extractCall.temperature, 0, 'extractClientInfo deveria mandar temperature=0')
  assert.equal(dateCall.temperature, 0, 'extractMovingDate deveria mandar temperature=0')
  assert.equal(vistoriaCall.temperature, 0, 'classifyVistoriaResponse deveria mandar temperature=0')
  assert.equal(mediaCall.temperature, 0, 'classifyMediaSubmissionComplete deveria mandar temperature=0')
  assert.equal(replyCall.temperature, undefined, 'generateReply não deveria forçar temperature (geração de texto, não extração)')

  mock.clearCalls()
})

// Repetição do MESMO input duas vezes: com o mock (que é determinístico
// por natureza — sempre devolve o mesmo texto pro mesmo response_format)
// isso valida só que o CÓDIGO é estável (mesmo request, mesmo parsing,
// mesmo resultado) — não substitui o teste de determinismo real da API,
// feito à parte com chamadas reais (ver relatório, seção custos).
test('mesma entrada processada duas vezes produz o mesmo resultado (estabilidade do código)', async () => {
  const client = {
    nameConfirmed: false, name: null, originAddress: null, destinationAddress: null,
    propertyType: null, movingNotes: null, stairsOrElevator: null, truckAccess: null,
    vistoriaResolved: false, vistoriaType: null,
  }
  const history = [
    { direction: 'IN', text: 'Quero mudar de Salvador pra Feira de Santana' },
    { direction: 'OUT', text: 'Qual o tipo de imóvel?' },
    { direction: 'IN', text: 'Apartamento' },
  ]

  const first = await extractClientInfo(client, history)
  const second = await extractClientInfo(client, history)
  assert.deepEqual(first, second)
})
