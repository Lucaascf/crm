// Bateria 3 (seções 6-8, com custo real — rodar só via
// test/support/setupRealApiTestDb.js): replay TURNO A TURNO (não só o
// resultado final) de uma AMOSTRA de conversas reais, usando
// src/conversationHandler.js de verdade (mesma função de produção) com a
// API real da OpenAI — valida que o pipeline completo (extração real +
// geração de resposta real + bloqueio de handoff) se comporta certo
// quando os dados não são mockados. Amostra pequena de propósito, pra
// controlar custo (ver relatório) — a bateria 1 (mock, grátis) já cobre
// os mesmos 383 casos pro comportamento estrutural do handoff.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConversationHandler } from '../../src/conversationHandler.js'
import { makeFakeWaClient, makeFakeMessage } from '../support/fakeWaClient.js'
import { prisma } from '../../src/db.js'
import { isHumanHandoffActive } from '../../src/clientState.js'
import { loadConversations, groupIntoTurns } from './loadConversations.js'
import { getMockOpenAi } from '../support/mockOpenAiSingleton.js'
import { estimateCostUsd } from '../support/recordingProxy.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SAMPLE_SIZE = Number(process.env.BATTERY3_SAMPLE_SIZE || 15)

function pickSample(conversations, n) {
  // Amostra espalhada (stride) em vez das N primeiras, pra pegar
  // diversidade de tamanho/conteúdo em vez de um viés de ordem alfabética
  // de arquivo.
  const stride = Math.max(1, Math.floor(conversations.length / n))
  const sample = []
  for (let i = 0; i < conversations.length && sample.length < n; i += stride) {
    sample.push(conversations[i])
  }
  return sample
}

async function runOne(conv, index, proxy) {
  const chatId = `battery3-${index}-${conv.contato}@c.us`
  const waClient = makeFakeWaClient()
  const handler = createConversationHandler(waClient, { botEnabledForAll: true, log: () => {} })
  const turns = groupIntoTurns(conv.messages)

  const result = {
    file: conv.file,
    contato: conv.contato,
    turns: turns.length,
    violationsTalkOverHuman: 0,
    crashes: 0,
    crashMessages: [],
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
    if (!clientId) continue

    const beforeState = await prisma.client.findUnique({ where: { id: clientId } })
    const handoffActiveBeforeTurn = isHumanHandoffActive(beforeState)
    const sentCountBefore = waClient.sent.length

    try {
      await handler.processConversationTurn(clientId)
    } catch (err) {
      result.crashes++
      result.crashMessages.push(`processConversationTurn: ${err.message}`)
    }

    const sentCountAfter = waClient.sent.length
    if (handoffActiveBeforeTurn && sentCountAfter > sentCountBefore) {
      result.violationsTalkOverHuman += sentCountAfter - sentCountBefore
    }
  }

  if (clientId) {
    const finalClient = await prisma.client.findUnique({ where: { id: clientId } })
    result.finalCrmState = {
      name: finalClient.name,
      nameConfirmed: finalClient.nameConfirmed,
      originAddress: finalClient.originAddress,
      destinationAddress: finalClient.destinationAddress,
      propertyType: finalClient.propertyType,
      movingNotes: finalClient.movingNotes,
      stairsOrElevator: finalClient.stairsOrElevator,
      truckAccess: finalClient.truckAccess,
      movingDate: finalClient.movingDate,
      vistoriaResolved: finalClient.vistoriaResolved,
      vistoriaType: finalClient.vistoriaType,
      collectingVistoriaMedia: finalClient.collectingVistoriaMedia,
      awaitingBudget: finalClient.awaitingBudget,
    }
    result.botMessagesSent = waClient.sent.map((s) => s.text)
  }

  return result
}

async function main() {
  const all = loadConversations()
  const sample = pickSample(all, SAMPLE_SIZE)
  const proxy = getMockOpenAi()
  const results = []

  let i = 0
  for (const conv of sample) {
    i++
    console.log(`... amostra ${i}/${sample.length}: ${conv.file} (${conv.messages.length} mensagens)`)
    results.push(await runOne(conv, i, proxy))
  }

  const cost = estimateCostUsd(proxy.calls)
  const outDir = process.env.BATTERY_OUT_DIR || path.resolve(__dirname, 'out')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'turn-by-turn-sample-results.json'), JSON.stringify({ cost, results }, null, 2))

  console.log('\n=== RESUMO BATERIA 3 — replay turno a turno (API real, amostra) ===')
  console.log(`Conversas amostradas: ${results.length}`)
  console.log(`Violações (bot falou por cima do humano): ${results.reduce((s, r) => s + r.violationsTalkOverHuman, 0)}`)
  console.log(`Crashes: ${results.reduce((s, r) => s + r.crashes, 0)}`)
  console.log(`Chamadas reais feitas: ${proxy.calls.length} (retries por 404 transitório: ${proxy.retryLog?.length ?? 0})`)
  console.log(`Custo estimado (gpt-4o-mini): US$ ${cost.costUsd.toFixed(4)}`)
}

main().catch((err) => {
  console.error('Falha na bateria turno a turno:', err)
  process.exit(1)
})
