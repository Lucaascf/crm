import OpenAI from 'openai'
import { withApiRetry } from './apiRetry.js'
import { stabilizeExtraction } from './extractionPolicy.js'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0 })
const MODEL = 'gpt-4o-mini'

// Uma camada de retry: erros permanentes (inclusive 404) exigem diagnóstico.
function createCompletion(params) {
  return withApiRetry(() => openai.chat.completions.create(params), {
    onRetry: (info) => console.warn('[ai] Nova tentativa de API', info),
    onFailure: (info) => console.error('[ai] Falha definitiva de API', info),
  })
}

// Nenhuma chamada abaixo definia `temperature`, o que deixa o default da
// API (1.0) — foi identificado que isso faz campos como vistoriaResolved
// mudarem de valor entre duas execuções com o MESMO input/histórico. Pra
// extração, classificação e atualização estruturada (tudo que devolve
// json_schema aqui) isso é puramente ruim: não há criatividade desejável
// nessas tarefas, só queremos o resultado mais determinístico possível dado
// o mesmo texto. 0 é o mínimo aceito pela API (não elimina 100% da
// variância do modelo, mas reduz drasticamente). generateReply() é a única
// exceção de propósito — é geração de texto em tom natural (o "jeito do
// Luciano"), não extração, então mantém o default.
const DETERMINISTIC_TEMPERATURE = 0

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
- "clientName" é o nome completo do cliente, só quando ELE MESMO disser (ex: "meu nome é...", "aqui quem fala é..."). Nunca invente a partir do nome salvo no WhatsApp. Se ainda não disse, null. Um apelido oferecido como alternativa ao nome (ex: "pode me chamar de Zé", "me chama de Bob") NÃO conta como resposta — continua null até ele dizer o nome de verdade.
- "clientNickname" é o apelido que o cliente ofereceu como alternativa ao nome, se algum (ex: "pode me chamar de Zé" → "Zé"; "me chama de Bob" → "Bob"), mesmo que tenha dito isso na MESMA mensagem em que deu o nome completo. Null se ele nunca ofereceu apelido nenhum.
- "originAddress" e "destinationAddress" são endereços distintos (origem = de onde sai, destino = pra onde vai). Se o cliente disser os dois de uma vez, mesmo num formato curto (ex: "Salvador pro Rio", "saindo de X e indo pra Y", só as cidades sem rua/bairro), preenche os dois campos com o que ele disse pra cada lado — não precisa ser endereço completo com rua pra contar como resposta válida. Só deixe um campo null se o cliente realmente não disse nada sobre aquele lado ainda. Nunca copie o valor de um campo pro outro quando só um foi informado. NUNCA resuma, abrevie ou reduza o endereço só à cidade quando o cliente deu mais detalhes (rua, número, bairro, complemento, CEP) — copie tudo isso literalmente, cidade incluída. Só fica só com a cidade quando é só isso que o cliente disse mesmo.
- "commercialNotes" resume valores e condições comerciais mencionados, indicando quem propôs e se foram apenas propostos ou explicitamente aceitos. Não trate proposta como acordo. Null se ausentes. Valores declarados de bens para seguro continuam em movingNotes. Nunca gere ou autorize um orçamento.
- "movingNotes" é a relação de itens/observações gerais da mudança (o que vai ser transportado, restrições, particularidades). Mantenha como uma lista/texto corrido acumulando tudo que foi mencionado. NUNCA inclua aqui negociação de preço, forma de pagamento, parcelamento, nota fiscal ou combinação de valores (ex: "posso pagar uma parte no pix e outra no cartão", "a empresa vai emitir uma nota de R$X") — isso é assunto comercial, não item/observação da mudança, e não deve aparecer neste campo mesmo que o cliente mencione isso junto com os itens. Exceção: o valor declarado de um item específico pra fins de seguro/transporte (ex: "a TV vale R$2.000 pro seguro") pode ficar aqui, porque é uma característica do item, não uma negociação do preço do serviço.
- "stairsOrElevator" descreve se tem escada ou elevador na origem e no destino. SEMPRE no formato "Origem: <resposta>. Destino: <resposta>." — se um dos dois lados não ficou claro, escreve "Origem: ainda não informado." ou "Destino: ainda não informado." em vez de adivinhar. Cuidado com respostas ambíguas tipo "tem escada e elevador no destino" — isso pode significar "escada na origem, elevador no destino" OU "escada E elevador, os dois no destino" (origem não respondida); se não der pra ter certeza de qual é, trate como ambíguo e marque o lado que não ficou claro como "ainda não informado", nunca invente pra desambiguar sozinho. Exceção: se o cliente disser claramente "os dois", "escada e elevador" ou "as duas coisas" respondendo sobre UM lado específico (ex: pergunta era só sobre a origem e ele respondeu "os dois"), aí sim registra os dois pra aquele lado (ex: "Origem: escada e elevador.") — isso não é ambíguo, é uma resposta completa. Só "sim"/"tem" sozinho, sem dizer qual, é que fica ambíguo e vira "ainda não informado".
- "truckAccess" descreve só se o caminhão consegue parar na porta dos dois endereços (ex: "Sim, nos dois" ou "Só na origem, no destino precisa descarregar a 50m"). Não é sobre escada/elevador — isso vai em "stairsOrElevator", não aqui. "Só X" / "somente X" / "apenas X" é uma resposta COMPLETA pros dois lados — significa "sim em X, não no outro" (ex: cliente disse "só no destino" → "Origem: não consegue parar. Destino: consegue parar." — não deixe origem como "ainda não informado" nesse caso, já foi respondido implicitamente). Só use "ainda não informado" quando o cliente realmente não disse nada sobre aquele lado, nem mesmo implicitamente. Se o cliente disser que o problema é nos DOIS endereços (ex: "não consegue em nenhum dos dois", "tem que descarregar longe nos dois", "nenhum dos dois tem acesso"), os dois lados ficam "não consegue parar" — não presuma que um dos lados está OK só porque ele não foi citado individualmente. IMPORTANTE: se esse campo já tinha uma resposta definida (ver "estado atual dos campos") e nada de novo sobre acesso de caminhão foi dito nesta parte da conversa, repita o valor que já existia — nunca troque de volta pra "ainda não informado" só porque o assunto não veio à tona de novo nesta rodada.
- "propertyType" só pode ser um destes valores, ou null: ${PROPERTY_TYPES.join(', ')}.
- "vistoriaType" é "presencial" se o cliente topar uma vistoria presencial, ou "fotos" se ele preferir mandar fotos/vídeo dos itens em vez de vistoria. Null se ele ainda não escolheu.
- "vistoriaResolved" é true assim que o cliente escolher um dos dois (presencial ou fotos/vídeo) — não precisa de data/horário pra contar como resolvido, isso quem combina é um assistente humano depois. Continua false se o assunto ainda nem foi levantado ou o cliente ainda não respondeu sobre isso.
- Nunca invente informação que não foi dita na conversa. Menção a apartamento, andar, mudança ou orçamento NÃO confirma acesso de caminhão. Fotos/áudios sem transcrição não são evidência de acesso. Um nome usado pela Empresa para se dirigir ao cliente NÃO é um apelido oferecido pelo cliente.`

const REPLY_SYSTEM_PROMPT = `Você é o Luciano, atendente da Trevo Mudanças e Transportes, respondendo pelo WhatsApp da empresa.

Seu jeito de escrever (baseado em conversas reais dele):
- Direto e casual, nunca formal ou em lista numerada.
- Mensagens curtas. Prefere mandar 2-3 mensagens curtas a um parágrafo grande.
- Cumprimenta rápido ("Bom dia" / "Boa tarde" / "Boa noite") e, se for o primeiro contato de verdade, se apresenta ("Me chamo Luciano") e pergunta o nome completo do cliente antes de mais nada.
- IMPORTANTE: depois que o cliente diz o nome completo, NUNCA MAIS usa nenhum nome pra se referir a ele em nenhuma mensagem seguinte, nem pra confirmar o que ele acabou de responder — nem o nome completo/primeiro nome, nem um apelido que ele tenha oferecido como alternativa (ex: "pode me chamar de Zé", "me chama de Bob"), mesmo que o apelido tenha sido dito na MESMA mensagem que o nome completo. Errado: "Beleza, Lucas!" ou "Beleza, Zé! Agora preciso saber...". Certo: "Beleza! Agora preciso saber...". Isso vale pra sempre dali em diante, não só na mensagem logo depois do nome.
- Pergunta uma ou duas coisas por vez, nunca despeja a lista toda de uma vez.
- O endereço de destino é perguntado logo em seguida ao de origem (a próxima pergunta depois da origem, antes de qualquer outro assunto) — a não ser que o cliente já tenha mandado os dois endereços juntos na mesma mensagem, aí não repete a pergunta.
- A pergunta sobre tipo de imóvel sempre vem com exemplos curtos, no formato "é casa, apartamento ou outro?" (só esses três, não a lista inteira de tipos).
- Pra pedir a relação de itens da mudança: se é a primeira vez que o assunto aparece (o cliente ainda não citou nenhum item), pergunta de forma aberta pedindo a lista completa, tipo "O que você vai levar na mudança? Pode listar tudo — móveis, eletrodomésticos, caixas etc." Deixa claro que precisa ser a relação completa, não só os itens principais, porque isso é usado pra fechar o orçamento certinho. NUNCA pergunte "tem mais algum item?" ou "é só isso?" — isso é feito automaticamente pelo sistema, não por você.
- Pergunta sobre escada/elevador sempre no formato "É escada, elevador, ou os dois?" (nunca "tem escada ou elevador?" — isso convida resposta "sim/não" ambígua, já que não são excludentes).
- Se a pergunta sobre escada/elevador ou sobre acesso do caminhão continuar na lista do que falta mesmo depois do cliente já ter respondido algo sobre isso na conversa, tem dois motivos possíveis — NUNCA repete a pergunta idêntica de novo, e sim: (1) se a resposta anterior só cobriu um lado (origem ou destino), pergunta SÓ o lado que falta (ex: "E na origem, é escada, elevador, ou os dois?"); (2) se a resposta anterior foi vaga tipo "sim"/"tem" sem dizer qual, pergunta só a parte que faltou esclarecer (ex: "Elevador, escada, ou os dois?"), reconhecendo que ele já confirmou que tem alguma coisa.
- Pergunta sobre data da mudança: da PRIMEIRA vez (cliente ainda não falou nada sobre data na conversa), pergunta de forma aberta e genérica, tipo "Qual a data prevista da mudança?" — NUNCA presuma "semana que vem" ou qualquer período se o cliente não disse isso. Só depois que ELE MESMO já tiver dito um período vago (ex: ele disse "essa semana", "semana que vem" ou "mês que vem") é que você pergunta o dia específico dentro daquele MESMO período que ELE citou — repetindo o período exato que ele usou, nunca trocando por outro (ex: se ele disse "essa semana", pergunta "Qual dia dessa semana fica melhor?"; se disse "semana que vem", pergunta "Qual dia da semana que vem fica melhor?"; se disse "mês que vem", pergunta "Qual dia do mês que vem?"). Nunca invente ou troque o período que o cliente não mencionou — releia a última coisa que ELE disse sobre data antes de escrever a pergunta.
- Quase não usa emoji.
- Nunca promete valor de orçamento — isso é decidido pela equipe depois, você só coleta as informações da mudança.
- Pode pedir fotos ou vídeo dos móveis/ambientes uma vez, no meio da conversa, pra ajudar a equipe a orçar melhor — mas isso não é obrigatório pra seguir em frente, e não peça de novo se o cliente já mandou ou ignorou.
- A pergunta sobre vistoria vem por último, depois de já saber endereços, tipo de imóvel, itens, escada/elevador e data. São só duas opções: vistoria presencial, ou mandar fotos/vídeo dos itens. Nunca pergunte dia/horário de vistoria — isso quem combina é um assistente depois, não você.

Você recebe a conversa até agora e o único campo que ainda falta saber sobre a mudança nesse momento. Escreva a(s) próxima(s) mensagem(ns) pra pedir só esse campo ao cliente, no tom do Luciano — nunca adiante um assunto diferente do que foi pedido, mesmo que pareça o próximo passo natural da conversa. Se o cliente acabou de responder algo, reconheça antes de perguntar. Responda só com o texto da mensagem, sem aspas ou formatação extra.`

const WEEKDAY_NAMES_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado']

// toISOString() converte pra UTC — no Brasil (UTC-3), depois das 21h no
// horário local o dia em UTC já virou o seguinte, então usar toISOString()
// pra "hoje"/datas relativas troca o dia errado nesse intervalo. Formata
// sempre no fuso local da máquina em vez disso.
function toLocalISODate(d) {
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function mondayOf(date) {
  const d = new Date(date)
  const day = d.getDay() // 0 (dom) .. 6 (sáb)
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  return d
}

// GPT erra data relativa/dia da semana com frequência quando só recebe "hoje
// é YYYY-MM-DD" e tem que calcular de cabeça (ex: cliente disse "terça-feira"
// e ele devolveu um domingo; ou "sexta da semana que vem" e ele devolveu um
// sábado). Em vez de confiar na conta do modelo, damos a tabela pronta dos
// próximos dias com o dia da semana e a semana (esta/que vem) já resolvidos,
// pra virar só uma busca.
function buildUpcomingDatesTable(days = 35) {
  const base = new Date()
  const thisMonday = mondayOf(base)
  const nextMonday = new Date(thisMonday)
  nextMonday.setDate(nextMonday.getDate() + 7)
  const weekAfterMonday = new Date(nextMonday)
  weekAfterMonday.setDate(weekAfterMonday.getDate() + 7)
  const thirdWeekMonday = new Date(weekAfterMonday)
  thirdWeekMonday.setDate(thirdWeekMonday.getDate() + 7)

  const lines = []
  for (let i = 0; i < days; i++) {
    const d = new Date(base)
    d.setDate(base.getDate() + i)
    const iso = toLocalISODate(d)
    let label = WEEKDAY_NAMES_PT[d.getDay()]
    if (i === 0) label += ' (hoje)'
    else if (d < nextMonday) label += ' — esta semana'
    else if (d < weekAfterMonday) label += ' — semana que vem'
    else if (d < thirdWeekMonday) label += ' — semana seguinte'
    lines.push(`${iso} = ${label}`)
  }
  return lines.join('\n')
}

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
    clientNickname: client.clientNickname ?? null,
    originAddress: client.originAddress,
    destinationAddress: client.destinationAddress,
    propertyType: client.propertyType,
    movingNotes: client.movingNotes,
    commercialNotes: client.commercialNotes,
    stairsOrElevator: client.stairsOrElevator,
    truckAccess: client.truckAccess,
    vistoriaResolved: client.vistoriaResolved,
    vistoriaType: client.vistoriaType,
  }

  const completion = await createCompletion({
    model: MODEL,
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Tabela de datas (use pra resolver dia da semana/data relativa):\n${buildUpcomingDatesTable()}\n\nEstado atual dos campos:\n${JSON.stringify(currentState, null, 2)}\n\nConversa completa:\n${historyToText(messages)}`,
      },
    ],
    temperature: DETERMINISTIC_TEMPERATURE,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'client_moving_info',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            clientName: { type: ['string', 'null'] },
            clientNickname: { type: ['string', 'null'] },
            originAddress: { type: ['string', 'null'] },
            destinationAddress: { type: ['string', 'null'] },
            propertyType: { type: ['string', 'null'], enum: [...PROPERTY_TYPES, null] },
            movingNotes: { type: ['string', 'null'] },
            commercialNotes: { type: ['string', 'null'] },
            stairsOrElevator: { type: ['string', 'null'] },
            truckAccess: { type: ['string', 'null'] },
            vistoriaType: { type: ['string', 'null'], enum: ['presencial', 'fotos', null] },
            vistoriaResolved: { type: 'boolean' },
          },
          required: [
            'clientName',
            'clientNickname',
            'originAddress',
            'destinationAddress',
            'propertyType',
            'movingNotes',
            'commercialNotes',
            'stairsOrElevator',
            'truckAccess',
            'vistoriaType',
            'vistoriaResolved',
          ],
          additionalProperties: false,
        },
      },
    },
  })

  return stabilizeExtraction(client, JSON.parse(completion.choices[0].message.content))
}

const MONTH_NAMES_PT = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

// Pedir pro modelo achar a linha certa numa tabela de datas (cruzando "dia
// da semana" + "período" ditos em turnos diferentes) se mostrou pouco
// confiável em teste (ex: cliente diz "semana que vem" e depois "quarta" —
// o modelo errava o dia/semana ~80% das vezes mesmo com a tabela pronta).
// Em vez disso, o modelo só extrai os SINAIS BRUTOS do texto (dia da semana
// citado, período citado, etc — tarefa bem mais simples e confiável), e o
// cálculo da data final é 100% determinístico em código.
const MOVING_DATE_SIGNALS_SYSTEM_PROMPT = `Você lê o fim de uma conversa de WhatsApp entre uma empresa de mudanças e um cliente, especificamente a parte sobre quando vai ser a mudança.

Sua única tarefa é extrair SINAIS BRUTOS do que o cliente disse — não calcule nenhuma data, só identifique o que foi dito:

- "weekdayName": o dia da semana que o cliente citou (ex: cliente disse "quarta" ou "sexta-feira" → "quarta-feira" / "sexta-feira"), ou null se não citou nenhum.
- "period": se o cliente mencionou um período relativo — "esta semana", "semana que vem" ou "semana seguinte" — em qualquer mensagem dele sobre a data (mesmo em turno anterior). Null se não mencionou período nenhum.
- "relativeDays": se o cliente disse "daqui a N dias" ou "em N dias" (as duas formas contam igual — "daqui a 20 dias" e "em 20 dias" são a mesma coisa: relativeDays=20), esse N (número). Trate também "hoje"/"hoje mesmo" como relativeDays=0 e "amanhã" como relativeDays=1, mesmo sem a palavra "dias". NUNCA use este campo pra unidade de semana/mês (ex: "daqui a duas semanas" NÃO é relativeDays=2, é relativeWeeks=2 — preste atenção na unidade dita, não só no número). Null caso contrário.
- "relativeWeeks": se o cliente disse "daqui a N semanas" ou "em N semanas" (as duas formas contam igual), esse N (número). Null caso contrário.
- "dayOfMonth": CUIDADO — fácil de confundir com relativeDays, preste bastante atenção. "dayOfMonth" só quando o cliente está apontando um número FIXO no calendário, sempre com a palavra "dia" antes do número (ex: "dia 20", "no dia 5", "dia 20 do mês que vem"). "em N dias" / "daqui a N dias" NUNCA é dayOfMonth, mesmo quando N é um número que também poderia ser dia do calendário (ex: "em 20 dias" é relativeDays=20, NÃO dayOfMonth=20 — não existe a palavra "dia" logo antes do número ali, é "dias" depois, indicando quantidade/prazo, não uma data fixa). Null caso contrário.
- "monthName": se junto do dia do mês o cliente disse o mês (ex: "dia 5 de outubro" → "outubro"). Null caso contrário (inclusive se não disse dayOfMonth).
- "vague": true se o cliente só deu uma referência vaga, sem NENHUM dos sinais acima (ex: "semana que vem" sozinho sem dia, "não sei ainda", "talvez mês que vem", "ainda não decidi") — nesse caso todos os outros campos ficam null. Se ele citou weekdayName, relativeDays, relativeWeeks ou dayOfMonth, vague = false mesmo que também tenha mencionado um período vago.

Nunca invente um valor que o cliente não disse. Isso é só extração de texto, não é pra fazer conta de data nenhuma.`

/**
 * Resolve os sinais brutos extraídos pra uma data real — puro cálculo em
 * código, sem IA, pra não repetir o erro de pedir conta de data pro modelo.
 */
function resolveMovingDate(signals) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  if (signals.relativeDays != null || signals.relativeWeeks != null) {
    // Soma em vez de tratar como ramos exclusivos: o modelo às vezes marca
    // relativeDays=0 quando o cliente usa "hoje"/"a partir de hoje" só como
    // ponto de partida de uma contagem em semanas (ex: "umas duas semanas a
    // partir de hoje" → relativeDays=0 E relativeWeeks=2 no mesmo turno). Se
    // um ramo excluísse o outro, essa combinação perderia silenciosamente as
    // semanas e devolvia hoje. Somar os dois cobre esse caso E o caso raro de
    // o cliente combinar as duas unidades de propósito (ex: "uma semana e 2
    // dias"), sem exigir que o modelo nunca preencha os dois campos junto.
    const d = new Date(today)
    d.setDate(d.getDate() + (signals.relativeDays ?? 0) + (signals.relativeWeeks ?? 0) * 7)
    return toLocalISODate(d)
  }

  if (signals.dayOfMonth != null) {
    const monthIndex = signals.monthName ? MONTH_NAMES_PT.indexOf(signals.monthName) : today.getMonth()
    let candidate = new Date(today.getFullYear(), monthIndex, signals.dayOfMonth)
    if (!signals.monthName && candidate < today) {
      candidate = new Date(today.getFullYear(), monthIndex + 1, signals.dayOfMonth)
    }
    return toLocalISODate(candidate)
  }

  if (signals.weekdayName) {
    const targetDow = WEEKDAY_NAMES_PT.indexOf(signals.weekdayName)
    if (signals.period) {
      const offset = { 'esta semana': 0, 'semana que vem': 7, 'semana seguinte': 14 }[signals.period]
      const periodStart = mondayOf(today)
      periodStart.setDate(periodStart.getDate() + offset)
      const d = new Date(periodStart)
      d.setDate(d.getDate() + ((targetDow - periodStart.getDay() + 7) % 7))
      return toLocalISODate(d)
    }
    // Sem período dito: assume a próxima ocorrência desse dia da semana a
    // partir de hoje (inclusive).
    const d = new Date(today)
    d.setDate(d.getDate() + ((targetDow - today.getDay() + 7) % 7))
    return toLocalISODate(d)
  }

  return null
}

/**
 * Descobre a data prevista da mudança a partir da conversa. Devolve
 * YYYY-MM-DD ou null se o cliente ainda não deu um dia específico (um
 * período vago tipo "semana que vem" sozinho NÃO conta — fica null até ele
 * dizer o dia).
 */
export async function extractMovingDate(messages) {
  const completion = await createCompletion({
    model: MODEL,
    messages: [
      { role: 'system', content: MOVING_DATE_SIGNALS_SYSTEM_PROMPT },
      { role: 'user', content: `Fim da conversa:\n${historyToText(messages.slice(-12))}` },
    ],
    temperature: DETERMINISTIC_TEMPERATURE,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'moving_date_signals',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            weekdayName: { type: ['string', 'null'], enum: [...WEEKDAY_NAMES_PT, null] },
            period: { type: ['string', 'null'], enum: ['esta semana', 'semana que vem', 'semana seguinte', null] },
            relativeDays: { type: ['number', 'null'] },
            relativeWeeks: { type: ['number', 'null'] },
            dayOfMonth: { type: ['number', 'null'] },
            monthName: { type: ['string', 'null'], enum: [...MONTH_NAMES_PT, null] },
            vague: { type: 'boolean' },
          },
          required: ['weekdayName', 'period', 'relativeDays', 'relativeWeeks', 'dayOfMonth', 'monthName', 'vague'],
          additionalProperties: false,
        },
      },
    },
  })

  const signals = JSON.parse(completion.choices[0].message.content)
  return signals.vague ? null : resolveMovingDate(signals)
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// O modelo às vezes ignora a instrução de não usar o nome do cliente depois
// da primeira vez (ex: "E aí, Lucas!" em vez de "E aí!") — em vez de confiar
// só no prompt, removemos o nome de qualquer mensagem gerada como rede de
// segurança determinística.
function stripClientName(text, clientFirstName) {
  if (!clientFirstName) return text

  // \b do JS não é Unicode-aware: trata letra acentuada (é, ã, ç...) como
  // "não-palavra", o que quebra a fronteira bem no meio de nomes comuns no
  // Brasil (ex: "Zé", "André") e deixa a regra passar batido. Usa lookaround
  // com \p{L}/\p{N} (Unicode) em vez de \b pra funcionar com qualquer nome.
  const escaped = escapeRegExp(clientFirstName)
  let result = text.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'giu'), '')

  result = result
    .replace(/,\s*,/g, ',') // "Perfeito, , vou" -> "Perfeito, vou"
    .replace(/\s+,/g, ',') // "Perfeito , vou" -> "Perfeito, vou"
    .replace(/,\s*!/g, '!') // "Beleza, !" -> "Beleza!"
    .replace(/,\s*\./g, '.') // "Beleza, ." -> "Beleza."
    .replace(/,\s*\?/g, '?') // "Beleza, ?" -> "Beleza?"
    .replace(/^\s*,\s*/gm, '') // vírgula sobrando no início da linha
    .replace(/[ \t]{2,}/g, ' ')
    .trim()

  return result
}

/**
 * Gera a próxima mensagem a mandar pro cliente, pedindo o que ainda falta,
 * no tom do Luciano. Se o cliente já confirmou o nome, `clientFirstName`
 * remove qualquer menção a ele que o modelo tenha colocado por engano.
 * `clientNickname` faz o mesmo pra um apelido que o cliente tenha oferecido
 * como alternativa (ex: "pode me chamar de Zé") — o prompt já instrui a não
 * usar nem nome nem apelido, mas essa é a mesma rede de segurança
 * determinística usada pro nome, pro caso do modelo ignorar a instrução.
 */
export async function generateReply(messages, missingFields, clientFirstName = null, clientNickname = null) {
  const missingLabels = missingFields.map((f) => f.label).join(', ')

  const completion = await createCompletion({
    model: MODEL,
    messages: [
      { role: 'system', content: REPLY_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Conversa até agora:\n${historyToText(messages)}\n\nO único campo que falta perguntar agora, e só ele — não adiante nenhum outro assunto: ${missingLabels}.`,
      },
    ],
  })

  let text = stripClientName(completion.choices[0].message.content.trim(), clientFirstName)
  text = stripClientName(text, clientNickname)
  return text
}

const VISTORIA_RESPONSE_SYSTEM_PROMPT = `Você está lendo o fim de uma conversa de WhatsApp de uma empresa de mudanças. A empresa acabou de propor um dia/horário específico de vistoria pro cliente e perguntou se funciona.

Analise a última resposta do cliente:
- "accepted" = true se ele confirmou/aceitou esse horário.
- "accepted" = false se ele recusou ou pediu outro horário.
- Se ele recusou mas já sugeriu um novo dia/horário na mesma mensagem, preencha "newDate" (YYYY-MM-DD — ache a linha certa na tabela de datas fornecida e copie exatamente, nunca calcule de cabeça) e "newTime". Senão, deixe os dois null.`

/**
 * Classifica se o cliente aceitou o horário de vistoria proposto (ou já
 * sugeriu outro no lugar).
 */
export async function classifyVistoriaResponse(messages) {
  const completion = await createCompletion({
    model: MODEL,
    messages: [
      { role: 'system', content: VISTORIA_RESPONSE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Tabela de datas (use pra resolver dia da semana/data relativa):\n${buildUpcomingDatesTable()}\n\nFim da conversa:\n${historyToText(messages.slice(-8))}`,
      },
    ],
    temperature: DETERMINISTIC_TEMPERATURE,
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

const MEDIA_COMPLETE_SYSTEM_PROMPT = `Você está lendo o fim de uma conversa de WhatsApp de uma empresa de mudanças. O cliente escolheu mandar fotos/vídeo dos itens em vez de vistoria presencial, e a empresa já pediu pra ele mandar tudo.

Releia as últimas mensagens do cliente (depois do pedido de fotos/vídeo) e diga se ele já deixou claro que não tem mais nada a enviar — ex: "é só isso", "acabou", "só isso mesmo", "não tem mais nada", ou qualquer forma de dizer que terminou.

"done" = true só se ele disse isso explicitamente. Se ele só mandou mais uma foto/vídeo sem dizer que terminou, ou não respondeu nada de conclusivo, "done" = false.`

/**
 * Classifica se o cliente já sinalizou que terminou de mandar fotos/vídeo da
 * vistoria (pra decidir entre finalizar a coleta ou perguntar se tem mais
 * alguma coisa).
 */
export async function classifyMediaSubmissionComplete(messages) {
  const completion = await createCompletion({
    model: MODEL,
    messages: [
      { role: 'system', content: MEDIA_COMPLETE_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `Fim da conversa:\n${historyToText(messages.slice(-12))}`,
      },
    ],
    temperature: DETERMINISTIC_TEMPERATURE,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'media_submission_complete',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            done: { type: 'boolean' },
          },
          required: ['done'],
          additionalProperties: false,
        },
      },
    },
  })

  return JSON.parse(completion.choices[0].message.content).done
}
