import fs from 'fs'
import pkg from 'whatsapp-web.js'
const { Client, LocalAuth } = pkg
import qrcode from 'qrcode-terminal'

const WAWEB_CONSOLE_LOG = 'waweb-console.log'
const logPage = (line) => {
  fs.appendFileSync(WAWEB_CONSOLE_LOG, `[${new Date().toISOString()}] ${line}\n`)
}

// Anexa aos eventos da PÁGINA (não do client whatsapp-web.js) assim que o
// Puppeteer expõe pupPage — para capturar o que o WhatsApp Web realmente
// loga/falha entre o loading_screen:100% e o LOGOUT, já que o LOGOUT em si
// é só a lib observando um framenavigated para "post_logout=1" (ver
// node_modules/whatsapp-web.js/src/Client.js linha ~496) — o motivo real
// do servidor derrubar a sessão só aparece aqui, não no evento 'disconnected'.
async function attachPageDiagnostics() {
  while (!client.pupPage) {
    await new Promise((r) => setTimeout(r, 200))
  }
  const page = client.pupPage

  page.on('console', (msg) => {
    logPage(`[console:${msg.type()}] ${msg.text()}`)
  })
  page.on('pageerror', (err) => {
    logPage(`[pageerror] ${err.message}${err.stack ? '\n' + err.stack : ''}`)
  })
  page.on('requestfailed', (req) => {
    logPage(`[requestfailed] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`)
  })
  page.on('response', (res) => {
    if (res.status() >= 400) {
      logPage(`[response ${res.status()}] ${res.request().method()} ${res.url()}`)
    }
  })

  logPage('=== diagnóstico de página anexado (console/pageerror/requestfailed/response>=400) ===')
}

// Enquanto testamos, o bot só pode ler/responder esse contato — o WhatsApp
// conectado é o número real da empresa, usado por clientes de verdade.
const ALLOWED_CONTACT = '5571993341731@c.us'

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: 'auth_info' }),
  authTimeoutMs: 300000,
  puppeteer: {
    headless: true, // Fase 3a: replica o headless nativo do coleta_produtos (era false + Xvfb)
    // sem executablePath: usa o Chrome que o Puppeteer já baixou (linux-146.0.7680.31),
    // em vez do Chromium do snap do sistema (152.x) — evita descompasso de versão do protocolo CDP
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      // DevTools remoto só em loopback — acesso externo via túnel SSH, sem abrir porta no firewall
      '--remote-debugging-port=9222',
      '--remote-debugging-address=127.0.0.1',
    ],
  },
})

client.on('qr', (qr) => {
  console.log('\nEscaneie o QR code abaixo no WhatsApp (Aparelhos conectados > Conectar aparelho):\n')
  qrcode.generate(qr, { small: true })
})

client.on('authenticated', () => {
  console.log(`[${new Date().toISOString()}] 🔐 Autenticado — sessão aceita, iniciando sincronização`)
})

client.on('loading_screen', (percent, message) => {
  console.log(`[${new Date().toISOString()}] ⏳ Carregando: ${percent}% - ${message}`)
})

client.on('ready', () => {
  console.log('✅ Conectado ao WhatsApp!')
})

client.on('auth_failure', (msg) => {
  console.log('❌ Falha de autenticação:', msg)
})

client.on('disconnected', async (reason) => {
  console.log(`[${new Date().toISOString()}] Desconectado:`, reason)
  await client.destroy()
  process.exit(1)
})

client.on('message', async (msg) => {
  if (msg.fromMe) return
  if (msg.from !== ALLOWED_CONTACT) return // ignora qualquer outro contato (clientes reais)

  console.log(`📩 Mensagem de ${msg.from}: ${msg.body}`)
  if (msg.body) {
    await msg.reply(`Recebi: "${msg.body}"`)
  }
})

attachPageDiagnostics()
client.initialize()
