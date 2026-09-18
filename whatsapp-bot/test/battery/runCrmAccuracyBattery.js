import { provenance } from './provenance.js'
// Bateria 2 (seção 10 do pedido, custo real — rodar só via
// test/support/setupRealApiTestDb.js): pra cada uma das 383 conversas
// reais, roda extractClientInfo + extractMovingDate DE VERDADE (API real,
// temperature=0) UMA VEZ sobre o histórico completo, e guarda o resultado
// pra revisão de acurácia (comparar campo extraído vs conversa real).
//
// Por que uma chamada só por conversa (não turno a turno): rodar a
// extração incremental em CADA turno das 383 conversas custaria ~20-30x
// mais chamadas pro mesmo objetivo de avaliar a extração final — a
// bateria 3 (runTurnByTurnSample.js) cobre o comportamento INCREMENTAL
// com uma amostra menor, de propósito, pra controlar custo (ver
// relatório, seção custos).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractClientInfo, extractMovingDate } from '../../src/ai.js'
import { loadConversations } from './loadConversations.js'
import { getMockOpenAi } from '../support/mockOpenAiSingleton.js'
import { estimateCostUsd } from '../support/recordingProxy.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const BASE_CLIENT_STATE = {
  nameConfirmed: false,
  name: null,
  originAddress: null,
  destinationAddress: null,
  propertyType: null,
  movingNotes: null,
  stairsOrElevator: null,
  truckAccess: null,
  vistoriaResolved: false,
  vistoriaType: null,
}

const PRICE_LEAK_PATTERN = /r\$\s?\d|\d+\s?reais|valor d[eo] (a )?mudan[çc]a|or[çc]amento de r?\$?\s?\d/i

function heuristicFlags(extracted) {
  const flags = []
  if (extracted.movingNotes && PRICE_LEAK_PATTERN.test(extracted.movingNotes)) {
    flags.push('possivel_negociacao_vazando_para_movingNotes')
  }
  if (extracted.vistoriaResolved === true && !extracted.vistoriaType) {
    flags.push('vistoriaResolved_true_sem_vistoriaType')
  }
  if (extracted.stairsOrElevator && !/^Origem: .+\. Destino: .+\.$/s.test(extracted.stairsOrElevator)) {
    flags.push('stairsOrElevator_fora_do_formato_esperado')
  }
  return flags
}

async function main() {
  const conversations = loadConversations()
  const proxy = getMockOpenAi() // na real-api battery isso é o recordingProxy, não o mock
  const results = []
  let i = 0

  for (const conv of conversations) {
    i++
    const history = conv.messages.map((m) => ({ direction: m.fromMe ? 'OUT_HUMAN' : 'IN', text: m.text }))
    if (history.length === 0) continue

    let extracted
    let movingDate
    try {
      extracted = await extractClientInfo(BASE_CLIENT_STATE, history)
      movingDate = await extractMovingDate(history)
    } catch (err) {
      results.push({ file: conv.file, contato: conv.contato, error: err.message })
      continue
    }

    results.push({
      file: conv.file,
      contato: conv.contato,
      messageCount: conv.messages.length,
      extracted,
      movingDate,
      flags: heuristicFlags(extracted),
    })

    if (i % 25 === 0) console.log(`... ${i}/${conversations.length} conversas extraídas (API real)`)
  }

  const cost = estimateCostUsd(proxy.calls)
  const flaggedCount = results.filter((r) => r.flags && r.flags.length > 0).length
  const errorCount = results.filter((r) => r.error).length

  const outDir = process.env.BATTERY_OUT_DIR || path.resolve(__dirname, 'out')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'crm-accuracy-results.json'), JSON.stringify({ provenance: provenance(), cost, flaggedCount, errorCount, totalConversas: results.length, results }, null, 2))

  console.log('\n=== RESUMO BATERIA 2 — extração CRM com API real ===')
  console.log(`Conversas processadas: ${results.length}`)
  console.log(`Conversas com erro na chamada: ${errorCount}`)
  console.log(`Conversas com flag heurística (revisar): ${flaggedCount}`)
  console.log(`Chamadas reais feitas: ${proxy.calls.length} (retries adicionais no proxy: ${proxy.retryLog?.length ?? 0})`)
  console.log(`Tokens prompt: ${cost.promptTokens} | Tokens completion: ${cost.completionTokens}`)
  console.log(`Custo estimado (gpt-4o-mini): US$ ${cost.costUsd.toFixed(4)}`)
}

main().catch((err) => {
  console.error('Falha na bateria de acurácia do CRM:', err)
  process.exit(1)
})
