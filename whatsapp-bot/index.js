import fs from 'fs'
import pkg from 'whatsapp-web.js'
const { Client, LocalAuth } = pkg
import qrcode from 'qrcode-terminal'

const WAWEB_CONSOLE_LOG = 'waweb-console.log'
const logPage = (line) => {
  fs.appendFileSync(WAWEB_CONSOLE_LOG, `[${new Date().toISOString()}] ${line}\n`)
}

// Sem isso, uma promise sem .catch() (ex: msg.reply() falhando por uma
// instabilidade de rede) derruba o processo inteiro sem deixar rastro no
// log — o systemd sobe de novo (Restart=always), mas sem saber o motivo.
process.on('unhandledRejection', (err) => {
  console.log(`[${new Date().toISOString()}] ⚠️ Promise rejeitada sem tratamento: ${err?.message ?? err}`)
})

// Anexa aos eventos da PÁGINA (não do client whatsapp-web.js) assim que o
// Puppeteer expõe pupPage — para capturar o que o WhatsApp Web realmente
// loga/falha entre o loading_screen:100% e o LOGOUT, já que o LOGOUT em si
// é só a lib observando um framenavigated para "post_logout=1" (ver
// node_modules/whatsapp-web.js/src/Client.js linha ~496) — o motivo real
// do servidor derrubar a sessão só aparece aqui, não no evento 'disconnected'.
let pupPage = null

async function attachPageDiagnostics() {
  while (!client.pupPage) {
    await new Promise((r) => setTimeout(r, 200))
  }
  const page = client.pupPage
  pupPage = page

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
// Aceita os dois formatos: o LID observado de verdade em produção hoje
// (mensagens chegam como @lid, não @c.us) e o número/telefone tradicional,
// por segurança, caso o formato varie.
const ALLOWED_CONTACTS = ['226289076203642@lid', '5571993341731@c.us']

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

// A sessão já ficou presa em "Loading your chats..." depois do
// loading_screen chegar a 100% sem nunca disparar 'ready' — foi reproduzido
// e confirmado num teste manual, e um reload da página destravou na hora.
// Aqui automatizamos isso: se não sincronizar em STUCK_TIMEOUT_MS depois do
// 100%, recarregamos a página sozinhos (bem antes do LOGOUT de ~3min06s
// que essa mesma sessão travada costumava sofrer).
const STUCK_TIMEOUT_MS = 90_000
const MAX_RELOAD_ATTEMPTS = 2
let readyFired = false
let stuckTimerArmed = false
let reloadAttempts = 0

client.on('loading_screen', (percent, message) => {
  console.log(`[${new Date().toISOString()}] ⏳ Carregando: ${percent}% - ${message}`)

  if (Number(percent) !== 100 || stuckTimerArmed) return
  stuckTimerArmed = true

  setTimeout(async () => {
    if (readyFired) return
    if (!pupPage) return

    if (reloadAttempts >= MAX_RELOAD_ATTEMPTS) {
      console.log(`[${new Date().toISOString()}] ⚠️ ${MAX_RELOAD_ATTEMPTS} reloads esgotados sem sincronizar — parando de tentar (não vou mascarar com loop infinito)`)
      return
    }

    reloadAttempts++
    console.log(`[${new Date().toISOString()}] ⚠️ Travado em 100% há ${STUCK_TIMEOUT_MS / 1000}s sem 'ready' — recarregando página (tentativa ${reloadAttempts}/${MAX_RELOAD_ATTEMPTS})`)
    try {
      await pupPage.reload({ waitUntil: 'load' })
      stuckTimerArmed = false // permite rearmar se travar em 100% de novo após o reload
    } catch (err) {
      console.log(`[${new Date().toISOString()}] ❌ Falha ao recarregar: ${err.message}`)
    }
  }, STUCK_TIMEOUT_MS)
})

client.on('ready', () => {
  readyFired = true
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

// handleSIGINT/SIGTERM/SIGHUP ficam false (acima) de propósito — evita dois
// handlers (o do Puppeteer e o nosso) tentando fechar o Chrome ao mesmo
// tempo, o que deixa a sessão suja. Esse é o ÚNICO ponto que fecha o
// Chromium ao receber um sinal, garantindo que matar o processo Node
// também mata o Chromium filho, sem órfão.
const shutdown = async (signal) => {
  console.log(`[${new Date().toISOString()}] ${signal} recebido — encerrando Chromium de forma limpa...`)
  try {
    await client.destroy()
  } catch (err) {
    console.log(`[${new Date().toISOString()}] Falha ao encerrar Chromium: ${err.message}`)
  }
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

client.on('message', async (msg) => {
  if (msg.fromMe) return
  if (!ALLOWED_CONTACTS.includes(msg.from)) return // ignora qualquer outro contato (clientes reais)

  console.log(`📩 Mensagem de ${msg.from}: ${msg.body}`)
  if (msg.body) {
    await msg.reply(`Recebi: "${msg.body}"`)
  }
})

attachPageDiagnostics()
client.initialize()
