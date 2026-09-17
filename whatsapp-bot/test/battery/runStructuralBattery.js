// Bateria 1 (seções 5-9 do pedido): reproduz as 383 conversas reais
// exportadas, testando o COMPORTAMENTO do handoff/CRM/supressão de
// resposta em escala. Usa o mock do OpenAI (sem custo, sem chamada real) —
// a bateria que valida a QUALIDADE da extração com IA de verdade é
// runCrmAccuracyBattery.js, separada. Nenhuma mensagem real é mandada pro
// WhatsApp (fakeWaClient) e nenhum dado é escrito no banco de
// produção/dev (DATABASE_URL isolado, ver test/support/setup.js).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConversationHandler } from '../../src/conversationHandler.js'
import { makeFakeWaClient, makeFakeMessage } from '../support/fakeWaClient.js'
import { prisma } from '../../src/db.js'
import { isHumanHandoffActive } from '../../src/clientState.js'
import { loadConversations, groupIntoTurns } from './loadConversations.js'
import { getMockOpenAi } from '../support/mockOpenAiSingleton.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

async function runOne(conv, index) {
  const chatId = `battery1-${index}-${conv.contato}@c.us`
  const waClient = makeFakeWaClient()
  const handler = createConversationHandler(waClient, { botEnabledForAll: true, log: () => {} })
  const turns = groupIntoTurns(conv.messages)
  const mock = getMockOpenAi()

  const result = {
    file: conv.file,
    contato: conv.contato,
    totalMessages: conv.messages.length,
    clientMessages: conv.messages.filter((m) => !m.fromMe).length,
    humanMessages: conv.messages.filter((m) => m.fromMe).length,
    turns: turns.length,
    hadHumanIntervention: turns.some((t) => t.fromMe),
    handoffDetected: false,
    humanTurnsTotal: 0,
    humanTurnsProcessedByCrm: 0,
    violationsTalkOverHuman: 0,
    crashes: 0,
    crashMessages: [],
    persistedMessageCount: 0,
    expectedMessageCount: conv.messages.length,
  }

  let clientId = null
  for (const turn of turns) {
    for (const m of turn.messages) {
      const msg = makeFakeMessage({ fromMe: turn.fromMe, chatId, text: m.text })
      try {
        await handler.handleIncomingMessage(msg)
      } catch (err) {
        result.crashes++
        result.crashMessages.push(`handleIncomingMessage: ${err.message}`)
      }
    }

    if (!clientId) {
      const c = await prisma.client.findUnique({ where: { whatsappChatId: chatId } })
      clientId = c?.id ?? null
    }
    if (!clientId) continue // conversa sem nenhuma mensagem persistível (todas vazias) — não deveria acontecer

    const beforeState = await prisma.client.findUnique({ where: { id: clientId } })
    const handoffActiveBeforeTurn = isHumanHandoffActive(beforeState)

    if (turn.fromMe) {
      result.humanTurnsTotal++
      if (beforeState.lastHumanMessageAt) result.handoffDetected = true
    }

    const sentCountBefore = waClient.sent.length
    const callsBefore = mock.calls.length

    try {
      await handler.processConversationTurn(clientId)
    } catch (err) {
      result.crashes++
      result.crashMessages.push(`processConversationTurn: ${err.message}`)
    }

    if (turn.fromMe && mock.calls.length > callsBefore) {
      result.humanTurnsProcessedByCrm++
    }

    const sentCountAfter = waClient.sent.length
    if (handoffActiveBeforeTurn && sentCountAfter > sentCountBefore) {
      result.violationsTalkOverHuman += sentCountAfter - sentCountBefore
    }
  }

  if (clientId) {
    const finalMessages = await prisma.message.findMany({ where: { clientId } })
    result.persistedMessageCount = finalMessages.length
  }
  // O bot pode ter mandado resposta automática ANTES do handoff ativar
  // (turnos de cliente antes da primeira intervenção humana) — essas
  // mensagens OUT também ficam no histórico, então persistido = mensagens
  // reais da conversa + respostas automáticas do bot nessa simulação. Isso
  // NÃO é duplicação; é o comportamento esperado (ver seção 8-A/8-F).
  result.botSentCount = waClient.sent.length
  result.expectedMessageCount = result.totalMessages + result.botSentCount

  return result
}

async function main() {
  const conversations = loadConversations()
  const results = []
  let i = 0
  for (const conv of conversations) {
    i++
    const r = await runOne(conv, i)
    results.push(r)
    if (i % 50 === 0) console.log(`... ${i}/${conversations.length} conversas processadas`)
  }

  const agg = {
    totalConversas: results.length,
    totalMensagens: results.reduce((s, r) => s + r.totalMessages, 0),
    totalCliente: results.reduce((s, r) => s + r.clientMessages, 0),
    totalHumana: results.reduce((s, r) => s + r.humanMessages, 0),
    convComIntervencao: results.filter((r) => r.hadHumanIntervention).length,
    convSemIntervencao: results.filter((r) => !r.hadHumanIntervention).length,
    handoffDetectadoCorretamente: results.filter((r) => r.hadHumanIntervention && r.handoffDetected).length,
    handoffDetectadoDenominador: results.filter((r) => r.hadHumanIntervention).length,
    humanTurnsProcessedByCrm: results.reduce((s, r) => s + r.humanTurnsProcessedByCrm, 0),
    humanTurnsTotal: results.reduce((s, r) => s + r.humanTurnsTotal, 0),
    conversasComViolacao: results.filter((r) => r.violationsTalkOverHuman > 0).length,
    totalViolacoes: results.reduce((s, r) => s + r.violationsTalkOverHuman, 0),
    totalCrashes: results.reduce((s, r) => s + r.crashes, 0),
    conversasComDuplicacao: results.filter((r) => r.persistedMessageCount !== r.expectedMessageCount).length,
  }

  const scratchDir = process.env.BATTERY_OUT_DIR || path.resolve(__dirname, 'out')
  fs.mkdirSync(scratchDir, { recursive: true })
  fs.writeFileSync(path.join(scratchDir, 'structural-battery-results.json'), JSON.stringify({ agg, results }, null, 2))

  console.log('\n=== RESUMO BATERIA ESTRUTURAL (1 — handoff/CRM/supressão, sem custo de IA) ===')
  console.log(JSON.stringify(agg, null, 2))

  const violating = results.filter((r) => r.violationsTalkOverHuman > 0)
  if (violating.length) {
    console.log('\n⚠️ Conversas com bot falando por cima do humano:')
    for (const r of violating) console.log(`  - ${r.file}: ${r.violationsTalkOverHuman} violação(ões)`)
  }
  const crashed = results.filter((r) => r.crashes > 0)
  if (crashed.length) {
    console.log('\n⚠️ Conversas com crash:')
    for (const r of crashed) console.log(`  - ${r.file}: ${r.crashMessages.join(' | ')}`)
  }
  const dup = results.filter((r) => r.persistedMessageCount !== r.expectedMessageCount)
  if (dup.length) {
    console.log('\n⚠️ Conversas com contagem de mensagens inesperada (possível duplicação/perda):')
    for (const r of dup) console.log(`  - ${r.file}: esperado ${r.expectedMessageCount}, persistido ${r.persistedMessageCount}`)
  }

  await prisma.$disconnect()
}

main().catch((err) => {
  console.error('Falha na bateria estrutural:', err)
  process.exit(1)
})
