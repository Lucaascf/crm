import fs from 'fs'
import pkg from 'whatsapp-web.js'
const { Client, LocalAuth } = pkg

// Teste ISOLADO — Chromium REAL, com interface gráfica visível via VNC
// (Xvfb :98 + x11vnc, separados do coleta_produtos e de qualquer outro
// serviço). Sessão própria em chrome_test_auth/, separada de auth_info/
// (bot de produção, whatsapp-web.js) e de baileys_auth/ (teste Baileys,
// que continua rodando intocado). Objetivo único: ver se o LOGOUT de
// ~3min06s se repete com pareamento manual, via QR real na tela.
const LOG_FILE = 'chrome-test.log'

const ts = () => new Date().toTimeString().slice(0, 8)
const log = (line) => {
  const out = `[${ts()}] ${line}`
  console.log(out)
  fs.appendFileSync(LOG_FILE, out + '\n')
}

// Sem isso, um erro de protocolo do Puppeteer (ex: página navegou no meio
// de uma injeção) derruba o processo inteiro sem deixar rastro no log —
// foi exatamente o que aconteceu no restart anterior.
process.on('unhandledRejection', (err) => {
  log(`[ERRO FATAL] Promise rejeitada sem tratamento: ${err?.message ?? err}`)
})

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: 'chrome_test_auth' }),
  puppeteer: {
    headless: false, // janela real, renderizada no display :98 (visível via VNC)
    executablePath: '/root/.cache/puppeteer/chrome/linux-146.0.7680.31/chrome-linux64/chrome',
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1280,720',
      '--window-position=0,0',
    ],
  },
})

client.on('qr', () => {
  log('[QR] QR disponível na janela — escaneie visualmente via VNC')
})

client.on('authenticated', () => {
  log('[AUTENTICADO] Sessão aceita pelo WhatsApp')
})

client.on('ready', () => {
  log('[READY] WhatsApp Web conectado e pronto')
})

client.on('auth_failure', (msg) => {
  log(`[ERRO] Falha de autenticação: ${msg}`)
})

client.on('disconnected', async (reason) => {
  log(`[DESCONECTADO] Motivo: ${reason}`)
  await client.destroy()
  process.exit(1)
})

client.on('message', (msg) => {
  log(`[MENSAGEM] de ${msg.from}: ${JSON.stringify(msg.body)}`)
})

// handleSIGINT/SIGTERM/SIGHUP ficam false (acima) de propósito — evita dois
// handlers (o do Puppeteer e o nosso) tentando fechar o Chrome ao mesmo
// tempo, o que deixa a sessão suja. Esse é o ÚNICO ponto que fecha o
// Chromium ao receber um sinal, garantindo que matar o processo Node
// também mata o Chromium filho, sem órfão.
const shutdown = async (signal) => {
  log(`[CHROME] ${signal} recebido — encerrando Chromium de forma limpa...`)
  try {
    await client.destroy()
  } catch (err) {
    log(`[ERRO] Falha ao encerrar Chromium: ${err.message}`)
  }
  process.exit(0)
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

log('[CHROME] Iniciando teste — Chromium visível via Xvfb :98 / VNC :5901')
client.initialize().then(() => {
  client.pupBrowser.on('disconnected', () => {
    log('[ERRO] Processo do Chromium encerrou inesperadamente')
  })
})
