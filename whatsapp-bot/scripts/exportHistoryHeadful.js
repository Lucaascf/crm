import fs from 'fs'
import path from 'path'
import pkg from 'whatsapp-web.js'
const { Client, LocalAuth } = pkg
import qrcode from 'qrcode-terminal'

// Script avulso pra puxar o histórico de conversas de UM número de WhatsApp
// pro mesmo formato JSON usado em whatsapp-bot/export/ (dataset da Trevo).
// Roda com sua PRÓPRIA sessão (auth_info_export/), separada da sessão do
// bot em produção (auth_info/) — escanear o QR aqui não desconecta nem
// afeta o whatsapp-bot.service, que continua rodando o número da Trevo
// normalmente. Esse script só lê histórico e escreve arquivos; não manda
// nenhuma mensagem e não fica residente depois de terminar.
//
// Uso:
//   cd whatsapp-bot
//   node scripts/exportHistory.js
// Variável opcional: EXPORT_OUTPUT_DIR (default: export-novo)

const OUTPUT_DIR = process.env.EXPORT_OUTPUT_DIR || 'export-novo'
const DELAY_BETWEEN_CHATS_MS = 400

const MEDIA_LABELS = {
  image: 'foto',
  video: 'vídeo',
  ptt: 'áudio',
  audio: 'áudio',
  document: 'documento',
  sticker: 'figurinha',
  location: 'localização',
  vcard: 'contato',
  multi_vcard: 'contato',
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function formatTimestamp(unixSeconds) {
  // Mensagens do WhatsApp vêm em UTC; o dataset original usa o horário de
  // Brasília (-03:00, sem horário de verão hoje em dia) — replica o mesmo
  // formato pra ficar compatível com o que a bateria de testes já espera.
  const date = new Date(unixSeconds * 1000)
  const brasilia = new Date(date.getTime() - 3 * 60 * 60 * 1000)
  const iso = brasilia.toISOString().replace('Z', '')
  return `${iso}-03:00`
}

function messageText(msg) {
  if (msg.hasMedia || (msg.type && msg.type !== 'chat')) {
    const label = MEDIA_LABELS[msg.type] || msg.type || 'mídia'
    const placeholder = `[mídia: ${label}]`
    return msg.body ? `${placeholder} ${msg.body}` : placeholder
  }
  return msg.body || ''
}

async function exportHistory(client) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const chats = await client.getChats()
  const targetChats = chats.filter((chat) => !chat.isGroup && chat.id.server !== 'broadcast')

  console.log(`\n📦 ${targetChats.length} conversas individuais encontradas (de ${chats.length} no total, grupos/broadcast excluídos). Exportando para ${OUTPUT_DIR}/...\n`)

  let exported = 0
  let failed = 0
  let totalMessages = 0

  for (const chat of targetChats) {
    const contato = chat.id.user
    try {
      const messages = await chat.fetchMessages({ limit: Infinity })
      const mensagens = messages
        .slice()
        .sort((a, b) => a.timestamp - b.timestamp)
        .map((msg) => ({
          remetente: msg.fromMe ? 'Operador' : 'Cliente',
          texto: messageText(msg),
          timestamp: formatTimestamp(msg.timestamp),
        }))

      fs.writeFileSync(path.join(OUTPUT_DIR, `${contato}.json`), JSON.stringify({ contato, mensagens }, null, 2))
      exported++
      totalMessages += mensagens.length
      console.log(`  ✅ ${contato} — ${mensagens.length} mensagens`)
    } catch (err) {
      failed++
      console.log(`  ❌ ${contato} — falhou: ${err.message}`)
    }
    await sleep(DELAY_BETWEEN_CHATS_MS)
  }

  console.log(`\n✅ Concluído: ${exported} conversas exportadas (${totalMessages} mensagens), ${failed} falharam.`)
  console.log(`   Arquivos em: ${path.resolve(OUTPUT_DIR)}\n`)
}

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: 'auth_info_export' }),
  authTimeoutMs: 300000,
  puppeteer: {
    headless: false,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--window-size=1280,900',
      '--start-maximized',
    ],
  },
})

client.on('qr', (qr) => {
  console.log('\nEscaneie o QR code abaixo no WhatsApp que você quer exportar (Aparelhos conectados > Conectar aparelho):\n')
  qrcode.generate(qr, { small: true })
})

client.on('authenticated', () => {
  console.log(`[${new Date().toISOString()}] 🔐 Autenticado — sincronizando...`)
})

client.on('auth_failure', (msg) => {
  console.log('❌ Falha de autenticação:', msg)
  process.exit(1)
})

client.on('ready', async () => {
  console.log('✅ Conectado ao WhatsApp!')
  try {
    await exportHistory(client)
  } catch (err) {
    console.log(`❌ Erro durante a exportação: ${err.message}`)
  } finally {
    await client.destroy()
    process.exit(0)
  }
})

client.initialize()
