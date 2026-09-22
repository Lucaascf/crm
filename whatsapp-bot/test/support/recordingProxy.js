import http from 'node:http'
import crypto from 'node:crypto'

// Proxy HTTP local transparente pra api.openai.com — repassa a requisição
// (headers de auth incluídos) e devolve a resposta real, sem alterar nada.
// Usado só na bateria de custo real (real-api battery), pra medir o
// `usage` (tokens de verdade) de cada chamada sem precisar tocar em
// src/ai.js — o SDK já lê OPENAI_BASE_URL do ambiente sozinho, então só
// apontamos pra cá.
// Retry pertence à implementação de produção, nunca ao proxy de medição.
export function startRecordingProxy({ onCall = () => {}, beforeForward = async () => {} } = {}) {
  const calls = [] // { url, model, usage, status, requestId, error }
  const pendingLogicalCalls = []
  const activeByRequestHash = new Map()

  async function forwardWithRetry(req, raw) {
    const res = await fetch(`https://api.openai.com${req.url}`, {
      method: req.method,
      headers: { 'Content-Type': 'application/json', Authorization: req.headers.authorization ?? '' },
      body: raw.length ? raw : undefined,
    })
    return { res, text: await res.text() }
  }

  const server = http.createServer((req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', async () => {
      const raw = Buffer.concat(chunks)
      const requestHash = crypto.createHash('sha256').update(raw).digest('hex')
      const active = activeByRequestHash.get(requestHash) || []
      let logical = active.find((item) => item.retryPending)
      if (logical) logical.retryPending = false
      else {
        logical = pendingLogicalCalls.shift() || { callId: null, task: null, retryPending: false }
        active.push(logical)
        activeByRequestHash.set(requestHash, active)
      }
      try {
        await beforeForward({ requestHash, logicalCallId: logical.callId, task: logical.task })
        const { res: upstreamRes, text } = await forwardWithRetry(req, raw)
        let usage = null
        let model = null
        let parsed = null
        try {
          parsed = JSON.parse(text)
          usage = parsed.usage ?? null
          model = parsed.model ?? null
        } catch {
          // resposta não-JSON (erro bruto da OpenAI) — deixa passar sem contabilizar usage
        }
        const requestId = upstreamRes.headers.get('x-request-id') || null
        const retryAfter = upstreamRes.headers.get('retry-after') || null
        const rateLimit = {
          limitTokens: upstreamRes.headers.get('x-ratelimit-limit-tokens') || null,
          remainingTokens: upstreamRes.headers.get('x-ratelimit-remaining-tokens') || null,
          resetTokens: upstreamRes.headers.get('x-ratelimit-reset-tokens') || null,
          limitRequests: upstreamRes.headers.get('x-ratelimit-limit-requests') || null,
          remainingRequests: upstreamRes.headers.get('x-ratelimit-remaining-requests') || null,
          resetRequests: upstreamRes.headers.get('x-ratelimit-reset-requests') || null,
        }
        const call = {
          url: req.url,
          model,
          usage,
          status: upstreamRes.status,
          requestId,
          logicalCallId: logical.callId,
          recordedAt: new Date().toISOString(),
          retryAfter,
          rateLimit,
          requestHash,
          // Preserva a resposta estruturada original para auditoria sem
          // duplicar o prompt (as mensagens ficam no resultado por turno).
          response: parsed,
        }
        calls.push(call)
        onCall(call)
        if ([408, 409, 429].includes(upstreamRes.status) || upstreamRes.status >= 500) logical.retryPending = true
        else {
          const index = active.indexOf(logical)
          if (index >= 0) active.splice(index, 1)
          if (!active.length) activeByRequestHash.delete(requestHash)
        }
        res.writeHead(upstreamRes.status, { 'Content-Type': upstreamRes.headers.get('content-type') || 'application/json', 'x-request-id': requestId || '' })
        res.end(text)
      } catch (err) {
        const call = {
          url: req.url, model: null, usage: null, status: 502, requestId: null,
          logicalCallId: logical.callId,
          recordedAt: new Date().toISOString(), requestHash, error: err.message,
        }
        calls.push(call)
        onCall(call)
        logical.retryPending = true
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
        registerLogicalCall: (callId, task) => pendingLogicalCalls.push({ callId, task, retryPending: false }),
        close: () => new Promise((r) => server.close(r)),
      })
    })
  })
}

// gpt-4o-mini, preço público por 1M tokens (conferir contra
// https://openai.com/api/pricing/ antes de reportar como definitivo — ver
// ressalva no relatório).
export const GPT_4O_MINI_PRICE_PER_1M = { input: 0.15, cachedInput: 0.075, output: 0.6 }

export function estimateCostUsd(calls, price = GPT_4O_MINI_PRICE_PER_1M) {
  let promptTokens = 0
  let cachedPromptTokens = 0
  let completionTokens = 0
  for (const c of calls) {
    if (!c.usage) continue
    promptTokens += c.usage.prompt_tokens ?? 0
    cachedPromptTokens += c.usage.prompt_tokens_details?.cached_tokens ?? 0
    completionTokens += c.usage.completion_tokens ?? 0
  }
  const uncachedPromptTokens = promptTokens - cachedPromptTokens
  const cost = (uncachedPromptTokens / 1_000_000) * price.input
    + (cachedPromptTokens / 1_000_000) * (price.cachedInput ?? price.input)
    + (completionTokens / 1_000_000) * price.output
  return { promptTokens, cachedPromptTokens, uncachedPromptTokens, completionTokens, costUsd: cost }
}
