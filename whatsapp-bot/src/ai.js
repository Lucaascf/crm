import OpenAI from 'openai'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
const MODEL = 'gpt-4o-mini'

// Mantido em sincronia manual com PROPERTY_TYPES em src/lib/constants.ts do
// app do CRM (projeto separado, sem build step compartilhado).
const PROPERTY_TYPES = [
  'Apartamento',
  'Casa',
  'Kitnet/Studio',
  'Sala comercial',
  'Escritório',
  'Depósito/Galpão',
  'Outro',
]

const EXTRACTION_SYSTEM_PROMPT = `Você lê a conversa de WhatsApp de uma empresa de mudanças (Trevo Mudanças) com um cliente e mantém atualizado o cadastro do cliente.

Você recebe o estado atual dos campos e o histórico completo da conversa (IN = cliente, OUT = empresa). Devolva os campos ATUALIZADOS, considerando tudo que já foi dito na conversa inteira, não só a última mensagem.

Regras:
- Se um campo já tinha valor e nada mudou, repita o valor que já tinha.
- Se o cliente corrigiu ou completou uma informação (ex: "esqueci de colocar duas bicicletas"), funda com o que já existia em vez de substituir.
- "clientName" é o nome completo do cliente, só quando ELE MESMO disser (ex: "meu nome é...", "aqui quem fala é..."). Nunca invente a partir do nome salvo no WhatsApp. Se ainda não disse, null.
- "movingNotes" é a relação de itens/observações gerais da mudança (o que vai ser transportado, restrições, particularidades). Mantenha como uma lista/texto corrido acumulando tudo que foi mencionado.
- "stairsOrElevator" descreve se tem escada ou elevador na origem e no destino (ex: "Origem: 2 lances de escada. Destino: elevador de serviço"). Se só um dos dois endereços foi respondido, deixe isso implícito no texto em vez de inventar o outro.
- "truckAccess" descreve se o caminhão consegue parar na porta dos dois endereços (ex: "Sim, nos dois" ou "Só na origem, no destino precisa descarregar a 50m").
- "propertyType" só pode ser um destes valores, ou null: ${PROPERTY_TYPES.join(', ')}.
- "movingDate" no formato YYYY-MM-DD. Se o cliente disse só o dia da semana ou uma data relativa, converta usando a data de hoje como referência. Se ainda não foi combinada, null.
- "vistoriaDate"/"vistoriaTime": só preenche se o cliente marcou um dia/horário pra uma vistoria (visita presencial ou por vídeo). Se não foi falado sobre vistoria ainda, ou se o cliente disse que prefere só mandar fotos/lista em vez de vistoria, deixe null.
- "vistoriaResolved" é true quando o assunto "vistoria" já foi resolvido de qualquer jeito: o cliente marcou uma data/horário, OU disse que prefere mandar fotos/vídeo em vez de vistoria, OU já mandou fotos/vídeo na conversa. Continua false se o assunto ainda nem foi levantado ou o cliente ainda não respondeu sobre isso.
- Nunca invente informação que não foi dita na conversa.`

const REPLY_SYSTEM_PROMPT = `Você é o Luciano, atendente da Trevo Mudanças e Transportes, respondendo pelo WhatsApp da empresa.

Seu jeito de escrever (baseado em conversas reais dele):
- Direto e casual, nunca formal ou em lista numerada.
- Mensagens curtas. Prefere mandar 2-3 mensagens curtas a um parágrafo grande.
- Cumprimenta rápido ("Bom dia" / "Boa tarde" / "Boa noite") e, se for o primeiro contato de verdade, se apresenta ("Me chamo Luciano") e pergunta o nome completo do cliente antes de mais nada.
- Pergunta uma ou duas coisas por vez, nunca despeja a lista toda de uma vez.
- Quase não usa emoji.
- Nunca promete valor de orçamento — isso é decidido pela equipe depois, você só coleta as informações da mudança.
- Pode pedir fotos ou vídeo dos móveis/ambientes uma vez, no meio da conversa, pra ajudar a equipe a orçar melhor — mas isso não é obrigatório pra seguir em frente, e não peça de novo se o cliente já mandou ou ignorou.
- A pergunta sobre vistoria (se quer visita presencial, por vídeo, ou prefere só mandar fotos/lista) vem por último, depois de já saber endereços, tipo de imóvel, itens, escada/elevador e data. Se o cliente topar vistoria, pergunte o dia e horário que prefere.

Você recebe a conversa até agora e a lista do que ainda falta saber sobre a mudança. Escreva a(s) próxima(s) mensagem(ns) pra pedir isso ao cliente, no tom do Luciano — só o próximo item da lista, não todos de uma vez. Se o cliente acabou de responder algo, reconheça antes de perguntar o próximo item. Responda só com o texto da mensagem, sem aspas ou formatação extra.`

function historyToText(messages) {
  return messages
    .map((m) => `${m.direction === 'IN' ? 'Cliente' : 'Empresa'}: ${m.text}`)
    .join('\n')
}

/**
 * Extrai/atualiza os campos de mudança do Client a partir do histórico
 * completo da conversa. Devolve só os campos extraíveis (não mexe em
 * budgetValue, status etc — isso é decidido por humano ou por outra rotina).
 */
export async function extractClientInfo(client, messages) {
  const currentState = {
    clientNameConfirmed: client.nameConfirmed ? client.name : null,
    originAddress: client.originAddress,
    destinationAddress: client.destinationAddress,
    movingDate: client.movingDate ? client.movingDate.toISOString().slice(0, 10) : null,
    movingTime: client.movingTime,
    propertyType: client.propertyType,
    movingNotes: client.movingNotes,
    stairsOrElevator: client.stairsOrElevator,
    truckAccess: client.truckAccess,
    vistoriaResolved: client.vistoriaResolved,
  }

  const today = new Date().toISOString().slice(0, 10)

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Hoje é ${today}.\n\nEstado atual dos campos:\n${JSON.stringify(currentState, null, 2)}\n\nConversa completa:\n${historyToText(messages)}`,
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'client_moving_info',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            clientName: { type: ['string', 'null'] },
            originAddress: { type: ['string', 'null'] },
            destinationAddress: { type: ['string', 'null'] },
            movingDate: { type: ['string', 'null'] },
            movingTime: { type: ['string', 'null'] },
            propertyType: { type: ['string', 'null'], enum: [...PROPERTY_TYPES, null] },
            movingNotes: { type: ['string', 'null'] },
            stairsOrElevator: { type: ['string', 'null'] },
            truckAccess: { type: ['string', 'null'] },
            vistoriaDate: { type: ['string', 'null'] },
            vistoriaTime: { type: ['string', 'null'] },
            vistoriaResolved: { type: 'boolean' },
          },
          required: [
            'clientName',
            'originAddress',
            'destinationAddress',
            'movingDate',
            'movingTime',
            'propertyType',
            'movingNotes',
            'stairsOrElevator',
            'truckAccess',
            'vistoriaDate',
            'vistoriaTime',
            'vistoriaResolved',
          ],
          additionalProperties: false,
        },
      },
    },
  })

  return JSON.parse(completion.choices[0].message.content)
}

/**
 * Gera a próxima mensagem a mandar pro cliente, pedindo o que ainda falta,
 * no tom do Luciano.
 */
export async function generateReply(messages, missingFields) {
  const missingLabels = missingFields.map((f) => f.label).join(', ')

  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: REPLY_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Conversa até agora:\n${historyToText(messages)}\n\nAinda falta saber (na ordem, pergunte só o próximo): ${missingLabels}.`,
      },
    ],
  })

  return completion.choices[0].message.content.trim()
}

const VISTORIA_RESPONSE_SYSTEM_PROMPT = `Você está lendo o fim de uma conversa de WhatsApp de uma empresa de mudanças. A empresa acabou de propor um dia/horário específico de vistoria pro cliente e perguntou se funciona.

Analise a última resposta do cliente:
- "accepted" = true se ele confirmou/aceitou esse horário.
- "accepted" = false se ele recusou ou pediu outro horário.
- Se ele recusou mas já sugeriu um novo dia/horário na mesma mensagem, preencha "newDate" (YYYY-MM-DD) e "newTime". Senão, deixe os dois null.`

/**
 * Classifica se o cliente aceitou o horário de vistoria proposto (ou já
 * sugeriu outro no lugar).
 */
export async function classifyVistoriaResponse(messages) {
  const today = new Date().toISOString().slice(0, 10)
  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      { role: 'system', content: VISTORIA_RESPONSE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Hoje é ${today}.\n\nFim da conversa:\n${historyToText(messages.slice(-8))}`,
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'vistoria_response',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            accepted: { type: 'boolean' },
            newDate: { type: ['string', 'null'] },
            newTime: { type: ['string', 'null'] },
          },
          required: ['accepted', 'newDate', 'newTime'],
          additionalProperties: false,
        },
      },
    },
  })

  return JSON.parse(completion.choices[0].message.content)
}
