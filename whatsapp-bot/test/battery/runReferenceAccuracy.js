import { provenance } from './provenance.js'
// Casos de referência anotados pelo agente a partir do texto; não são revisão humana.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractClientInfo } from '../../src/ai.js'
import { isUnknown } from '../../src/extractionPolicy.js'
import { getMockOpenAi } from '../support/mockOpenAiSingleton.js'
import { estimateCostUsd } from '../support/recordingProxy.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const real = (dataset, file) => JSON.parse(fs.readFileSync(path.join(root, dataset, file), 'utf8')).mensagens
  .filter((m) => m.texto?.trim()).map((m) => ({ direction: m.remetente === 'Cliente' ? 'IN' : 'OUT_HUMAN', text: m.texto }))
const replay = process.env.REFERENCE_REPLAY_RESULTS ? JSON.parse(fs.readFileSync(process.env.REFERENCE_REPLAY_RESULTS, 'utf8')) : null
const cases = [
  { id: 'export/557188435065.json', history: real('export', '557188435065.json'), expected: { clientName: null, clientNickname: null, truckAccess: 'unknown', propertyType: 'Apartamento', vistoriaType: 'presencial' } },
  { id: 'export-marcia/34853659607188.json', history: real('export-marcia', '34853659607188.json'), expected: { clientName: 'Renata Ribeiro Oliveira', clientNickname: null, truckAccess: 'unknown', commercialNotes: null }, contains: { originAddress: ['Silveira Martins', '1731', 'Cabula'], destinationAddress: ['Edgard Loureiro', 'Resgate'], movingNotes: ['hospitalar', 'geladeira'] } },
  { id: 'synthetic/commercial', history: [{ direction: 'IN', text: 'Vou levar um sofá. Posso pagar R$ 3.000 em 3 vezes?' }], contains: { movingNotes: ['sofá'], commercialNotes: ['3'] }, excludes: { movingNotes: ['3.000', 'parcel', 'pagamento'] }, expected: { truckAccess: 'unknown', clientName: null } },
  { id: 'synthetic/correction', client: { originAddress: 'Rua A, 10', clientNickname: 'Bia', truckAccess: 'Sim, nos dois.' }, history: [{ direction: 'IN', text: 'Corrigindo a origem: Rua B, 20. Pode me chamar de Bia. O caminhão não consegue parar no destino, só na origem.' }], contains: { originAddress: ['Rua B', '20'] }, expected: { clientNickname: 'Bia' }, oneOf: { truckAccess: ['Só na origem.', 'Origem: consegue parar. Destino: não consegue parar.'] } },
]
const results = []
for (const c of cases) {
  try {
    const extracted = replay ? replay.results.find((r) => r.id === c.id).extracted : await extractClientInfo(c.client || {}, c.history)
    const checks = []
    for (const [field, expected] of Object.entries(c.expected || {})) {
      const actual = extracted[field]
      const passed = expected === 'unknown' ? isUnknown(actual) || actual === 'Origem: ainda não informado. Destino: ainda não informado.' : actual === expected
      checks.push({ field, expected, actual, passed })
    }
    for (const [field, alternatives] of Object.entries(c.oneOf || {})) {
      checks.push({ field, alternatives, actual: extracted[field], passed: alternatives.includes(extracted[field]) })
    }
    for (const mode of ['contains', 'excludes']) for (const [field, fragments] of Object.entries(c[mode] || {})) {
      const actual = extracted[field] || ''
      checks.push({ field, mode, fragments, actual, passed: fragments.every((part) => actual.toLowerCase().includes(part.toLowerCase()) === (mode === 'contains')) })
    }
    results.push({ id: c.id, checks, passed: checks.every((c) => c.passed), extracted })
  } catch (error) { results.push({ id: c.id, passed: false, error: error.message }) }
}
const report = { provenance: provenance(), annotation: 'agent-reviewed-text; human validation pending', replayedResponses: Boolean(replay), responseProvenance: replay?.responseProvenance || replay?.provenance || null, cost: replay ? replay.cost : estimateCostUsd(getMockOpenAi().calls), total: results.length, passed: results.filter((r) => r.passed).length, results }
const out = process.env.BATTERY_OUT_DIR || path.join(root, 'test/battery/out/adjustments')
fs.mkdirSync(out, { recursive: true })
fs.writeFileSync(path.join(out, 'reference-accuracy-results.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ total: report.total, passed: report.passed, cost: report.cost }))
if (report.passed !== report.total) process.exitCode = 1
