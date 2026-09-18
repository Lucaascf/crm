import { provenance } from './provenance.js'
// Bateria 2 combinada: roda a mesma extração de CRM com API real
// (extractClientInfo + extractMovingDate, temperature=0) sobre DOIS
// datasets na mesma bateria — export/ (383 conversas originais) e
// export-marcia/ (881 contatos, dataset novo pedido pelo usuário) — e
// grava um único resultado combinado, com cada item marcado por
// `dataset`, pra dar pra gerar um relatório único cobrindo os dois.
//
// Rodar a partir de whatsapp-bot/ com a API key no ambiente, ex:
//   node --env-file=.env --import ./test/support/setupRealApiTestDb.js test/battery/runCrmAccuracyBatteryCombined.js
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

const DATASETS = [
  { name: 'export', label: 'export (383 conversas originais)', dir: path.resolve(__dirname, '../../export') },
  { name: 'export-marcia', label: 'export-marcia (881 contatos, dataset novo)', dir: path.resolve(__dirname, '../../export-marcia') },
]

async function runDataset(ds, proxy) {
  const conversations = loadConversations(ds.dir)
  const results = []
  let i = 0
  let skippedEmpty = 0

  for (const conv of conversations) {
    i++
    const history = conv.messages.map((m) => ({ direction: m.fromMe ? 'OUT_HUMAN' : 'IN', text: m.text }))
    if (history.length === 0) {
      skippedEmpty++
      continue
    }

    let extracted
    let movingDate
    try {
      extracted = await extractClientInfo(BASE_CLIENT_STATE, history)
      movingDate = await extractMovingDate(history)
    } catch (err) {
      results.push({ dataset: ds.name, file: conv.file, contato: conv.contato, messageCount: conv.messages.length, error: err.message })
      continue
    }

    results.push({
      dataset: ds.name,
      file: conv.file,
      contato: conv.contato,
      messageCount: conv.messages.length,
      extracted,
      movingDate,
      flags: heuristicFlags(extracted),
    })

    if (i % 50 === 0) console.log(`... [${ds.name}] ${i}/${conversations.length} conversas (contatos totais no diretório, incluindo vazios)`)
  }

  console.log(`[${ds.name}] concluído: ${conversations.length} contatos no diretório, ${skippedEmpty} sem mensagens de texto (pulados), ${results.length} processados/tentados`)
  return { totalContatosNoDiretorio: conversations.length, skippedEmpty, results }
}

// Reuso histórico somente quando solicitado; não valida o código atual.
const REUSE_EXPORT_RESULTS_PATH = path.resolve(__dirname, 'out/crm-accuracy-results.json')

function loadReusedExportResults() {
  const raw = JSON.parse(fs.readFileSync(REUSE_EXPORT_RESULTS_PATH, 'utf8'))
  const results = raw.results.map((r) => ({ dataset: 'export', ...r }))
  return {
    info: { label: DATASETS[0].label, dir: DATASETS[0].dir, totalContatosNoDiretorio: null, skippedEmpty: null, processedCount: results.length, reused: true, reusedFrom: REUSE_EXPORT_RESULTS_PATH },
    results,
    cost: raw.cost,
  }
}

async function main() {
  const proxy = getMockOpenAi()
  const perDataset = {}
  const allResults = []
  let reusedCost = { promptTokens: 0, completionTokens: 0, costUsd: 0 }

  for (const ds of DATASETS) {
    if (ds.name === 'export' && process.env.BATTERY_REUSE_EXPORT === 'true') {
      const reused = loadReusedExportResults()
      perDataset.export = reused.info
      allResults.push(...reused.results)
      reusedCost = reused.cost
      continue
    }
    const r = await runDataset(ds, proxy)
    perDataset[ds.name] = { label: ds.label, totalContatosNoDiretorio: r.totalContatosNoDiretorio, skippedEmpty: r.skippedEmpty, processedCount: r.results.length, reused: false }
    allResults.push(...r.results)
  }

  const freshCost = estimateCostUsd(proxy.calls)
  const cost = {
    promptTokens: reusedCost.promptTokens + freshCost.promptTokens,
    completionTokens: reusedCost.completionTokens + freshCost.completionTokens,
    costUsd: reusedCost.costUsd + freshCost.costUsd,
  }
  const flaggedCount = allResults.filter((r) => r.flags && r.flags.length > 0).length
  const errorCount = allResults.filter((r) => r.error).length

  const outDir = process.env.BATTERY_OUT_DIR || path.resolve(__dirname, 'out')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(
    path.join(outDir, 'crm-accuracy-results-combined.json'),
    JSON.stringify({ provenance: provenance(), perDataset, cost, flaggedCount, errorCount, totalConversas: allResults.length, results: allResults }, null, 2),
  )

  console.log('\n=== RESUMO BATERIA 2 COMBINADA — extração CRM com API real (export + export-marcia) ===')
  for (const [name, info] of Object.entries(perDataset)) {
    console.log(`  [${name}] contatos no diretório: ${info.totalContatosNoDiretorio} | sem mensagens (pulados): ${info.skippedEmpty} | processados: ${info.processedCount}`)
  }
  console.log(`Total processados (ambos datasets): ${allResults.length}`)
  console.log(`Conversas com erro na chamada: ${errorCount}`)
  console.log(`Conversas com flag heurística (revisar): ${flaggedCount}`)
  console.log(`Chamadas reais feitas: ${proxy.calls.length} (retries adicionais no proxy: ${proxy.retryLog?.length ?? 0})`)
  console.log(`Tokens prompt: ${cost.promptTokens} | Tokens completion: ${cost.completionTokens}`)
  console.log(`Custo estimado (gpt-4o-mini): US$ ${cost.costUsd.toFixed(4)}`)
}

main().catch((err) => {
  console.error('Falha na bateria de acurácia do CRM (combinada):', err)
  process.exit(1)
})
