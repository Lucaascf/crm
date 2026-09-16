import puppeteer from 'puppeteer'
import fs from 'fs'

// Observador SOMENTE LEITURA — conecta ao Chromium já aberto do teste
// (index.chrome-test.js) via CDP, sem reiniciar, sem novo login, sem
// fechar nada. Ao final, disconnect() (não close()) solta o processo
// original intacto.
const port = fs.readFileSync('chrome_test_auth/session/DevToolsActivePort', 'utf-8').split('\n')[0]
const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${port}` })

const pages = await browser.pages()
const page = pages.find((p) => p.url().includes('whatsapp')) || pages[0]
console.log(`[INSPECT] Anexado à página: ${page.url()}`)

page.on('console', (msg) => console.log(`[console:${msg.type()}] ${msg.text()}`))
page.on('pageerror', (err) => console.log(`[pageerror] ${err.message}`))
page.on('requestfailed', (req) => console.log(`[requestfailed] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`))
page.on('response', (res) => {
  if (res.status() >= 400) console.log(`[response ${res.status()}] ${res.request().method()} ${res.url()}`)
})

console.log('[INSPECT] Observando por 25s (janela original NÃO será tocada)...')
await new Promise((r) => setTimeout(r, 25000))

console.log('[INSPECT] Desconectando (browser original continua rodando)')
browser.disconnect()
