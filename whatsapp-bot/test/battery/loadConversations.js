import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const EXPORT_DIR = path.resolve(__dirname, '../../export')

/**
 * Carrega as conversas reais exportadas de um diretório (default: export/,
 * as 383 conversas originais — export-marcia/ é o segundo dataset, 881
 * contatos, ver relatório) — formato
 * {contato, mensagens: [{remetente: "Cliente"|"Operador", texto, timestamp}]})
 * e devolve uma lista normalizada, ordenada por timestamp, filtrando
 * mensagens sem texto (ex: figurinha/mídia sem legenda no export original —
 * resolveMessageText() no bot real também descartaria essas, já que
 * msg.body viria vazio e hasMedia não é reproduzível a partir do JSON).
 */
export function loadConversations(exportDir = process.env.BATTERY_EXPORT_DIR || EXPORT_DIR) {
  const files = fs.readdirSync(exportDir).filter((f) => f.endsWith('.json')).sort()
  return files.map((file) => {
    const raw = JSON.parse(fs.readFileSync(path.join(exportDir, file), 'utf8'))
    const messages = (raw.mensagens || [])
      .filter((m) => m.texto && m.texto.trim() !== '')
      .map((m) => ({
        fromMe: m.remetente === 'Operador',
        text: m.texto,
        timestamp: new Date(m.timestamp).getTime(),
      }))
      .sort((a, b) => a.timestamp - b.timestamp)

    return { file, contato: raw.contato, messages }
  })
}

/**
 * Agrupa mensagens consecutivas do MESMO remetente (cliente OU operador)
 * num "turno" — simplificação deliberada do debounce real (que agrupa por
 * silêncio de 3s/60s, ver src/conversationHandler.js): pra bateria de
 * comportamento em massa, o que importa é testar handoff/CRM/supressão de
 * resposta quando o remetente muda, não reproduzir o timing exato do
 * debounce (lógica pré-existente, não alterada nesta entrega). Documentado
 * no relatório como simplificação metodológica.
 */
export function groupIntoTurns(messages) {
  const turns = []
  for (const msg of messages) {
    const last = turns[turns.length - 1]
    if (last && last.fromMe === msg.fromMe) {
      last.messages.push(msg)
    } else {
      turns.push({ fromMe: msg.fromMe, messages: [msg] })
    }
  }
  return turns
}
