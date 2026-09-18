import { provenance } from './provenance.js'
import { pickSample, cosmeticEqual } from './sample.js'
// Bateria 4 (seção 12, custo real — rodar só via
// test/support/setupRealApiTestDb.js): valida de verdade (API real, não
// mock) se temperature=0 tornou extractClientInfo/extractMovingDate
// determinísticos — roda CADA chamada duas vezes com o MESMO input
// (mesmo histórico, mesmo estado atual) e compara. Amostra pequena de
// propósito (custo real, 2x as chamadas de uma bateria já cara).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractClientInfo, extractMovingDate } from '../../src/ai.js'
import { loadConversations } from './loadConversations.js'
import { getMockOpenAi } from '../support/mockOpenAiSingleton.js'
import { estimateCostUsd } from '../support/recordingProxy.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SAMPLE_SIZE = Number(process.env.BATTERY4_SAMPLE_SIZE || 10)

const BASE_CLIENT_STATE = {
  nameConfirmed: false, name: null, originAddress: null, destinationAddress: null,
  propertyType: null, movingNotes: null, stairsOrElevator: null, truckAccess: null,
  vistoriaResolved: false, vistoriaType: null,
}


function diffKeys(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const diffs = []
  for (const k of keys) {
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) diffs.push({ field: k, run1: a[k], run2: b[k], cosmetic: cosmeticEqual(a[k], b[k]) })
  }
  return diffs
}

async function main() {
  const all = loadConversations()
  const sample = pickSample(all, SAMPLE_SIZE)
  const proxy = getMockOpenAi()
  const results = []

  let i = 0
  for (const conv of sample) {
    i++
    const history = conv.messages.map((m) => ({ direction: m.fromMe ? 'OUT_HUMAN' : 'IN', text: m.text }))
    if (history.length === 0) continue
    console.log(`... determinismo ${i}/${sample.length}: ${conv.file}`)

    const extract1 = await extractClientInfo(BASE_CLIENT_STATE, history)
    const extract2 = await extractClientInfo(BASE_CLIENT_STATE, history)
    const date1 = await extractMovingDate(history)
    const date2 = await extractMovingDate(history)

    results.push({
      file: conv.file,
      extractionStable: diffKeys(extract1, extract2).length === 0,
      extractionDiffs: diffKeys(extract1, extract2),
      dateStable: date1 === date2,
      date1,
      date2,
    })
  }

  const stableCount = results.filter((r) => r.extractionStable && r.dateStable).length
  const contentUnstableCount = results.filter((r) => !r.dateStable || r.extractionDiffs.some((d) => !d.cosmetic)).length
  const cost = estimateCostUsd(proxy.calls)

  const outDir = process.env.BATTERY_OUT_DIR || path.resolve(__dirname, 'out')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'determinism-results.json'), JSON.stringify({ provenance: provenance(), cost, stableCount, contentUnstableCount, requestedSampleSize: SAMPLE_SIZE, total: results.length, results }, null, 2))

  console.log('\n=== RESUMO BATERIA 4 — determinismo com API real ===')
  console.log(`Conversas testadas 2x: ${results.length}`)
  console.log(`Estáveis (extração E data idênticas nas 2 rodadas): ${stableCount}/${results.length}`)
  console.log(`Custo estimado (gpt-4o-mini): US$ ${cost.costUsd.toFixed(4)}`)
  for (const r of results) {
    if (!r.extractionStable || !r.dateStable) {
      console.log(`⚠️ Instável em ${r.file}:`, JSON.stringify(r.extractionDiffs), `data: ${r.date1} vs ${r.date2}`)
    }
  }
}

main().catch((err) => {
  console.error('Falha na bateria de determinismo:', err)
  process.exit(1)
})
