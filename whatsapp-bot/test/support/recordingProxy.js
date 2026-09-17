import http from 'node:http'

// Proxy HTTP local transparente pra api.openai.com — repassa a requisição
// (headers de auth incluídos) e devolve a resposta real, sem alterar nada.
// Usado só na bateria de custo real (real-api battery), pra medir o
// `usage` (tokens de verdade) de cada chamada sem precisar tocar em
// src/ai.js — o SDK já lê OPENAI_BASE_URL do ambiente sozinho, então só
// apontamos pra cá.
// Descoberto rodando a bateria com custo real: mesmo SEM esse proxy, indo
// direto pra api.openai.com, ~10-15% das chamadas nesse ambiente voltam
// com "404 status code (no body)" de forma intermitente (reproduzido com
// chamadas idênticas em sequência — não é erro de conteúdo/payload). O SDK
// da OpenAI só faz retry automático em erro de conexão/408/409/429/5xx —
// 404 não entra nesse conjunto, então sem isso aqui a chamada falha direto.
// Retry só nesse proxy (camada de teste) mantém src/ai.js e
// src/conversationHandler.js exatamente como rodam em produção — ver
// relatório, seção "Falhas/Limitações" pra recomendação de retry também no
// bot de produção.
const TRANSIENT_RETRY_STATUSES = new Set([404])
const MAX_UPSTREAM_ATTEMPTS = 4
const RETRY_DELAY_MS = 400

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export function startRecordingProxy() {
  const calls = [] // { url, model, usage, status, attempts }
  const retryLog = [] // { url, attempt, status }

  async function forwardWithRetry(req, raw) {
    let lastRes = null
    let lastText = null
    for (let attempt = 1; attempt <= MAX_UPSTREAM_ATTEMPTS; attempt++) {
      const upstreamRes = await fetch(`https://api.openai.com${req.url}`, {
        method: req.method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: req.headers['authorization'] ?? '',
        },
        body: raw.length ? raw : undefined,
      })
      const text = await upstreamRes.text()
      lastRes = upstreamRes
      lastText = text
      if (!TRANSIENT_RETRY_STATUSES.has(upstreamRes.status)) return { res: upstreamRes, text }
      retryLog.push({ url: req.url, attempt, status: upstreamRes.status })
      if (attempt < MAX_UPSTREAM_ATTEMPTS) await sleep(RETRY_DELAY_MS * attempt)
    }
    return { res: lastRes, text: lastText }
  }

  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      const raw = Buffer.concat(chunks)
      try {
        const { res: upstreamRes, text } = await forwardWithRetry(req, raw)
        let usage = null
        let model = null
        try {
          const parsed = JSON.parse(text)
          usage = parsed.usage ?? null
          model = parsed.model ?? null
        } catch {
          // resposta não-JSON (erro bruto da OpenAI) — deixa passar sem contabilizar usage
        }
        calls.push({ url: req.url, model, usage, status: upstreamRes.status })
        res.writeHead(upstreamRes.status, { 'Content-Type': upstreamRes.headers.get('content-type') || 'application/json' })
        res.end(text)
      } catch (err) {
        res.writeHead(502, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: `recordingProxy: ${err.message}` } }))
      }
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      server.unref()
      const { port } = server.address()
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        calls,
        retryLog,
        close: () => new Promise((r) => server.close(r)),
      })
    })
  })
}

// gpt-4o-mini, preço público por 1M tokens (conferir contra
// https://openai.com/api/pricing/ antes de reportar como definitivo — ver
// ressalva no relatório).
export const GPT_4O_MINI_PRICE_PER_1M = { input: 0.15, output: 0.6 }

export function estimateCostUsd(calls, price = GPT_4O_MINI_PRICE_PER_1M) {
  let promptTokens = 0
  let completionTokens = 0
  for (const c of calls) {
    if (!c.usage) continue
    promptTokens += c.usage.prompt_tokens ?? 0
    completionTokens += c.usage.completion_tokens ?? 0
  }
  const cost = (promptTokens / 1_000_000) * price.input + (completionTokens / 1_000_000) * price.output
  return { promptTokens, completionTokens, costUsd: cost }
}
