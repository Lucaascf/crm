import fs from 'fs'
import pkg from 'whatsapp-web.js'
const { Client, LocalAuth } = pkg
import qrcode from 'qrcode-terminal'
import { prisma } from './src/db.js'
import { findOrCreateClient, recordMessage, getConversationHistory, getMissingRequiredFields } from './src/clientState.js'
import { extractClientInfo, extractMovingDate, generateReply, classifyVistoriaResponse, classifyMediaSubmissionComplete } from './src/ai.js'
import { startBudgetWatcher } from './src/budgetWatcher.js'
import { startVistoriaWatcher } from './src/vistoriaWatcher.js'
import { debounce } from './src/debounce.js'

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

// Enquanto testamos o atendimento automático de ponta a ponta, o bot só
// pode ler/responder esse contato — o WhatsApp conectado é o número real da
// empresa, usado por clientes de verdade. Aceita os dois formatos: o LID
// observado de verdade em produção hoje (mensagens chegam como @lid, não
// @c.us) e o número/telefone tradicional, por segurança, caso o formato varie.
const TEST_CONTACTS = ['226289076203642@lid', '5571993341731@c.us', '245196008771798@lid', '275719838019588@lid', '1172609974471@lid']
// Liberar pra clientes reais é uma decisão separada da implementação —
// só vira true depois de validar o fluxo completo no contato de teste.
const BOT_ENABLED_FOR_ALL = process.env.BOT_ENABLED_FOR_ALL === 'true'

// Depois de quanto tempo de silêncio do cliente o bot processa a conversa —
// agrupa mensagens que chegam em rajada (comum em conversas reais) em vez de
// reagir a cada linha isolada.
const REPLY_DEBOUNCE_MS = 3_000

// Enquanto o cliente está mandando fotos/vídeo da vistoria, esperamos mais
// antes de perguntar "tem mais alguma coisa?" — 3s cortaria no meio de uma
// rajada de mídia (cliente manda várias fotos, uma de cada vez).
const VISTORIA_MEDIA_DEBOUNCE_MS = 60 * 1000

const READY_FOR_BUDGET_MESSAGE = 'Perfeito, já tenho tudo que preciso! Vou repassar pra nossa equipe calcular o valor certinho e já te retorno por aqui.'
const VISTORIA_PRESENCIAL_MESSAGE = 'Show! Um assistente vai entrar em contato pra marcar o dia e horário da vistoria.'
const VISTORIA_FOTOS_REQUEST_MESSAGE = 'Beleza! Pode mandar as fotos e vídeos de tudo que vai ser transportado, por favor.'
const VISTORIA_MEDIA_MORE_QUESTION = 'Tem mais alguma coisa que você queira mandar, ou é só isso?'
const VISTORIA_MEDIA_DONE_MESSAGE = 'Combinado! Vou avaliar as fotos e vídeos com a equipe e te dou um retorno.'
const ITEMS_FOLLOWUP_QUESTION = 'Tem mais alguma coisa que você vai levar, ou é só isso?'

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
const STUCK_TIMEOUT_MS = 30_000
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
  startBudgetWatcher(client)
  startVistoriaWatcher(client)
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

async function sendAndRecord(whatsappChatId, clientId, text) {
  await client.sendMessage(whatsappChatId, text)
  await recordMessage(clientId, 'OUT', text)
}

// Áudio (.opus) fica fora de escopo — não transcrevemos. Foto/vídeo/
// documento a gente não analisa o conteúdo, mas ainda registra que chegou,
// pra IA não ficar pedindo de novo algo que o cliente já mandou.
function resolveMessageText(msg) {
  if (msg.body) return msg.body
  if (!msg.hasMedia) return null
  if (msg.type === 'ptt' || msg.type === 'audio') return null
  if (msg.type === 'image') return '[cliente enviou uma foto]'
  if (msg.type === 'video') return '[cliente enviou um vídeo]'
  if (msg.type === 'document') return '[cliente enviou um arquivo]'
  return null
}

// Contatos que chegam como @lid (comum em produção hoje) trazem
// contact.number igual ao próprio número do LID, não o telefone real — a lib
// tem uma chamada dedicada pra resolver o telefone de verdade por trás do LID.
async function resolveRealPhoneNumber(msg, contact) {
  if (!msg.from.endsWith('@lid')) return contact?.number || null
  try {
    const [resolved] = await client.getContactLidAndPhone([msg.from])
    if (resolved?.pn) return resolved.pn.split('@')[0]
  } catch (err) {
    console.log(`[${new Date().toISOString()}] ⚠️ Falha ao resolver telefone real do LID ${msg.from}: ${err.message}`)
  }
  return contact?.number || null
}

// Grava a mensagem recebida e garante que existe um Client no CRM pra ela —
// roda pra toda mensagem, mesmo que o processamento da IA seja debounced.
async function persistIncomingMessage(msg, text) {
  const contact = await msg.getContact()
  const phoneNumber = await resolveRealPhoneNumber(msg, contact)
  const contactName = contact?.pushname || contact?.name || null

  const clientRecord = await findOrCreateClient({
    whatsappChatId: msg.from,
    phoneNumber,
    contactName,
  })
  await recordMessage(clientRecord.id, 'IN', text, msg.id?._serialized ?? null)
  return clientRecord
}

// Responde quando o cliente reage à proposta de horário de vistoria — roda
// mesmo se o bot já estiver quieto esperando o orçamento, porque é um
// assunto separado (agenda, não preço).
async function handleVistoriaResponse(clientRecord, appointment, history) {
  const result = await classifyVistoriaResponse(history)

  if (result.accepted) {
    await prisma.appointment.update({
      where: { id: appointment.id },
      data: { clientRespondedAt: new Date(), clientAccepted: true },
    })
    const text = 'Show, vou confirmar aqui com a equipe. Nos vemos lá!'
    await client.sendMessage(clientRecord.whatsappChatId, text)
    await recordMessage(clientRecord.id, 'OUT', text)
    await prisma.historyEntry.create({
      data: { clientId: clientRecord.id, text: 'Cliente confirmou o horário da vistoria.' },
    })
    return
  }

  // Recusou — volta pro estado "a confirmar" (some do painel de "aguardando
  // resposta" e o Luciano vê que precisa decidir de novo), já atualizando a
  // data/horário se o cliente sugeriu um novo na mesma mensagem.
  await prisma.appointment.update({
    where: { id: appointment.id },
    data: {
      confirmedByUser: false,
      proposalSentAt: null,
      clientRespondedAt: new Date(),
      clientAccepted: false,
      ...(result.newDate
        ? { date: new Date(`${result.newDate}T00:00:00`), time: result.newTime }
        : {}),
    },
  })
  const text = result.newDate
    ? 'Combinado, vou verificar esse novo horário com a equipe e te confirmo por aqui.'
    : 'Sem problemas! Qual dia e horário ficaria melhor pra você?'
  await client.sendMessage(clientRecord.whatsappChatId, text)
  await recordMessage(clientRecord.id, 'OUT', text)
  await prisma.historyEntry.create({
    data: { clientId: clientRecord.id, text: 'Cliente pediu outro horário pra vistoria — precisa confirmar de novo.' },
  })
}

// Fecha a etapa de coleta de dados: avisa o cliente que vai repassar pra
// equipe calcular o valor e marca awaitingBudget — dali pra frente quem
// assume é o humano ou o budgetWatcher.
async function finalizeDataCollection(clientId, whatsappChatId) {
  await sendAndRecord(whatsappChatId, clientId, READY_FOR_BUDGET_MESSAGE)
  await prisma.client.update({
    where: { id: clientId },
    data: {
      awaitingBudget: true,
      historyEntries: { create: { text: 'Bot coletou todas as informações da mudança; aguardando orçamento.' } },
    },
  })
}

// Roda enquanto collectingVistoriaMedia=true — dispara ~5min depois da
// última mídia recebida (ver VISTORIA_MEDIA_DEBOUNCE_MS). Só finaliza a
// coleta se o cliente já deixou claro que não tem mais nada a mandar; senão
// pergunta e continua esperando.
async function handleVistoriaMediaCollection(clientRecord, history) {
  const done = await classifyMediaSubmissionComplete(history)

  if (!done) {
    await sendAndRecord(clientRecord.whatsappChatId, clientRecord.id, VISTORIA_MEDIA_MORE_QUESTION)
    return
  }

  await sendAndRecord(clientRecord.whatsappChatId, clientRecord.id, VISTORIA_MEDIA_DONE_MESSAGE)
  const updated = await prisma.client.update({
    where: { id: clientRecord.id },
    data: { collectingVistoriaMedia: false },
  })

  const missing = getMissingRequiredFields(updated)
  if (missing.length === 0 && !updated.budgetSentAt && updated.budgetValue === null) {
    await finalizeDataCollection(updated.id, updated.whatsappChatId)
  }
}

// Roda extração + resposta pra um cliente depois do período de silêncio do
// debounce. Se o bot já deixou o cliente esperando o orçamento
// (awaitingBudget), fica quieto — quem assume dali pra frente é o humano ou
// o budgetWatcher, não insiste mais pedindo informação.
async function processConversationTurn(clientId) {
  const clientRecord = await prisma.client.findUnique({ where: { id: clientId } })
  if (!clientRecord) return

  const pendingVistoriaResponse = await prisma.appointment.findFirst({
    where: { type: 'VISTORIA', clientId, proposalSentAt: { not: null }, clientRespondedAt: null },
  })
  if (pendingVistoriaResponse) {
    const vistoriaHistory = await getConversationHistory(clientId)
    await handleVistoriaResponse(clientRecord, pendingVistoriaResponse, vistoriaHistory)
    return
  }

  if (clientRecord.collectingVistoriaMedia) {
    const mediaHistory = await getConversationHistory(clientId)
    await handleVistoriaMediaCollection(clientRecord, mediaHistory)
    return
  }

  if (clientRecord.awaitingBudget) return

  const history = await getConversationHistory(clientId)
  const extracted = await extractClientInfo(clientRecord, history)
  const movingDate = await extractMovingDate(history)

  // Conversa em andamento de verdade — sai de "Novo contato" assim que o bot
  // começa a trabalhar o lead, pra aparecer nas seções certas do CRM.
  const statusUpdate = clientRecord.status === 'NOVO_CONTATO' ? { status: 'EM_ATENDIMENTO' } : {}

  // Só troca o nome quando o cliente confirmou o dele de verdade na conversa
  // — nunca sobrescreve com o nome salvo no WhatsApp.
  const nameUpdate = extracted.clientName ? { name: extracted.clientName, nameConfirmed: true } : {}

  const updated = await prisma.client.update({
    where: { id: clientId },
    data: {
      ...statusUpdate,
      ...nameUpdate,
      originAddress: extracted.originAddress,
      destinationAddress: extracted.destinationAddress,
      movingDate: movingDate ? new Date(`${movingDate}T00:00:00`) : null,
      propertyType: extracted.propertyType,
      movingNotes: extracted.movingNotes,
      stairsOrElevator: extracted.stairsOrElevator,
      truckAccess: extracted.truckAccess,
      vistoriaResolved: extracted.vistoriaResolved,
      vistoriaType: extracted.vistoriaType,
    },
  })

  // Assunto vistoria acabou de ser resolvido nessa rodada — dispara a
  // mensagem certa pra cada caminho. "fotos" entra em modo de coleta e para
  // por aqui (não segue pro "tenho tudo" enquanto não terminar de mandar);
  // "presencial" só avisa e segue o fluxo normal (pode já cair no "tenho
  // tudo" logo em seguida, se essa era a última coisa faltando).
  const vistoriaJustResolved = !clientRecord.vistoriaResolved && updated.vistoriaResolved
  if (vistoriaJustResolved && updated.vistoriaType === 'presencial') {
    await sendAndRecord(updated.whatsappChatId, clientId, VISTORIA_PRESENCIAL_MESSAGE)
  } else if (vistoriaJustResolved && updated.vistoriaType === 'fotos') {
    await sendAndRecord(updated.whatsappChatId, clientId, VISTORIA_FOTOS_REQUEST_MESSAGE)
    await prisma.client.update({ where: { id: clientId }, data: { collectingVistoriaMedia: true } })
    return
  }

  // Cliente citou item(ns) pela primeira vez nessa rodada — pergunta se tem
  // mais alguma coisa, só essa vez. A resposta (seja mais itens ou "não")
  // é aceita como definitiva; não voltamos a perguntar isso de novo, pra não
  // ficar insistindo mensagem após mensagem.
  const itemsJustProvided = !clientRecord.movingNotes && updated.movingNotes
  if (itemsJustProvided) {
    await sendAndRecord(updated.whatsappChatId, clientId, ITEMS_FOLLOWUP_QUESTION)
    return
  }

  const missing = getMissingRequiredFields(updated)

  if (missing.length === 0) {
    // Já foi orçado ou está em estágio pós-orçamento (agendamento, pagamento,
    // pós-venda) — isso o Luciano conduz manualmente, o bot não se mete.
    if (updated.budgetSentAt || updated.budgetValue !== null) return

    await finalizeDataCollection(clientId, updated.whatsappChatId)
    return
  }

  // Manda só o campo que falta primeiro (ordem de REQUIRED_FIELDS) em vez da
  // lista toda — pedir pro modelo escolher "o próximo item" de uma lista se
  // mostrou pouco confiável (ex: pulava pra pergunta de data ignorando nome
  // ainda vazio, ou emendava a pergunta seguinte antes de resolver a atual).
  // Decidir isso em código é determinístico, igual já é feito com data.
  const clientFirstName = updated.nameConfirmed ? updated.name?.split(' ')[0] : null
  const reply = await generateReply(history, missing.slice(0, 1), clientFirstName, extracted.clientNickname)
  await client.sendMessage(updated.whatsappChatId, reply)
  await recordMessage(clientId, 'OUT', reply)
}

client.on('message', async (msg) => {
  if (msg.fromMe) return

  const chat = await msg.getChat().catch(() => null)
  if (chat?.isGroup) return

  if (!BOT_ENABLED_FOR_ALL && !TEST_CONTACTS.includes(msg.from)) {
    // Fora da lista de teste ainda — só loga quem é, pra dar pra adicionar
    // na TEST_CONTACTS depois. Não persiste nada, não responde.
    const contact = await msg.getContact().catch(() => null)
    console.log(
      `[${new Date().toISOString()}] 🚫 Mensagem de contato fora da lista de teste: ${msg.from} (${contact?.pushname || contact?.name || 'sem nome'})`,
    )
    return
  }

  const text = resolveMessageText(msg)
  if (!text) return // sem conteúdo útil pro bot (ex: áudio, fora de escopo)

  console.log(`📩 Mensagem de ${msg.from}: ${text}`)

  let clientRecord
  try {
    clientRecord = await persistIncomingMessage(msg, text)
  } catch (err) {
    console.log(`[${new Date().toISOString()}] ⚠️ Falha ao gravar mensagem no CRM: ${err.message}`)
    return
  }

  const debounceMs = clientRecord.collectingVistoriaMedia ? VISTORIA_MEDIA_DEBOUNCE_MS : REPLY_DEBOUNCE_MS
  debounce(
    msg.from,
    () =>
      processConversationTurn(clientRecord.id).catch((err) => {
        console.log(`[${new Date().toISOString()}] ⚠️ Falha ao processar conversa: ${err.message}`)
      }),
    debounceMs,
  )
})

attachPageDiagnostics()
client.initialize()
