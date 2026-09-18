import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export function provenance() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
  const files = ['src/ai.js', 'src/extractionPolicy.js', 'src/apiRetry.js', 'src/conversationHandler.js', 'test/battery/sample.js', 'test/battery/loadConversations.js']
  return {
    generatedAt: new Date().toISOString(),
    model: 'gpt-4o-mini',
    codeHash: createHash('sha256').update(files.map((file) => `${file}\n${fs.readFileSync(path.join(root, file), 'utf8')}`).join('\n')).digest('hex'),
    metricWarning: 'Preenchimento e flags não medem acurácia sem respostas de referência. Custos são estimados por tokens.',
  }
}
