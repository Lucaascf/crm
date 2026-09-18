import http from 'node:http'

// Servidor HTTP local que fala o suficiente do protocolo da API de chat
// completions da OpenAI pra o SDK real (openai@4) funcionar sem tocar a
// API de verdade. O SDK já lê `OPENAI_BASE_URL` do ambiente sozinho (ver
// node_modules/openai/index.d.ts) — não precisamos alterar src/ai.js pra
// isso, só apontar a variável de ambiente pra cá antes dos testes.
//
// Mantém a lógica real de src/ai.js (prompts, response_format,
// temperature, parsing) rodando de ponta a ponta; só troca o que
// responde do lado de fora.
function defaultHandler(body) {
  const schemaName = body.response_format?.json_schema?.name

  if (schemaName === 'client_moving_info') {
    return JSON.stringify({
      clientName: null,
      clientNickname: null,
      originAddress: null,
      destinationAddress: null,
      propertyType: null,
      movingNotes: null,
      commercialNotes: null,
      stairsOrElevator: null,
      truckAccess: null,
      vistoriaType: null,
      vistoriaResolved: false,
    })
  }
  if (schemaName === 'moving_date_signals') {
    return JSON.stringify({
      weekdayName: null,
      period: null,
      relativeDays: null,
      relativeWeeks: null,
      dayOfMonth: null,
      monthName: null,
      vague: true,
    })
  }
  if (schemaName === 'vistoria_response') {
    return JSON.stringify({ accepted: false, newDate: null, newTime: null })
  }
  if (schemaName === 'media_submission_complete') {
    return JSON.stringify({ done: false })
  }
  // generateReply: sem response_format, é texto livre.
  return 'Oi! Só preciso de mais uma informação pra seguir com a mudança.'
}

export function startMockOpenAi() {
  let handler = defaultHandler
  const calls = []

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(404)
      res.end()
      return
    }
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      let body
      try {
        body = JSON.parse(raw)
      } catch {
        body = {}
      }
      calls.push(body)

      let content
      try {
        content = handler(body)
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: err.message } }))
        return
      }

      const payload = {
        id: 'mock-completion',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: body.model || 'gpt-4o-mini',
        choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(payload))
    })
  })

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      server.unref() // não deve, sozinho, impedir o processo de terminar
      const { port } = server.address()
      resolve({
        url: `http://127.0.0.1:${port}/v1`,
        calls,
        setHandler(fn) {
          handler = fn
        },
        resetHandler() {
          handler = defaultHandler
        },
        clearCalls() {
          calls.length = 0
        },
        close: () => new Promise((r) => server.close(r)),
      })
    })
  })
}
