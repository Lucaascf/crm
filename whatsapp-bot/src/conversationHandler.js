import { prisma } from './db.js'
import {
  findOrCreateClient,
  recordMessage,
  getConversationHistory,
  getMissingRequiredFields,
  isHumanHandoffActive,
  isSafeToAutoReply,
  markHumanHandoff,
  isDuplicateWaMessageError,
  botSentMessageIds,
  sendAndRecord as sendAndRecordShared,
} from './clientState.js'
import { extractClientInfo, extractMovingDate, generateReply, classifyVistoriaResponse, classifyMediaSubmissionComplete } from './ai.js'
import { debounce } from './debounce.js'

// Depois de quanto tempo de silêncio do cliente/humano o bot processa a
// conversa — agrupa mensagens que chegam em rajada (comum em conversas
// reais) em vez de reagir a cada linha isolada.
export const REPLY_DEBOUNCE_MS = 3_000

// Enquanto o cliente está mandando fotos/vídeo da vistoria, esperamos mais
// antes de perguntar "tem mais alguma coisa?" — 3s cortaria no meio de uma
// rajada de mídia (cliente manda várias fotos, uma de cada vez).
export const VISTORIA_MEDIA_DEBOUNCE_MS = 60 * 1000

export const READY_FOR_BUDGET_MESSAGE = 'Perfeito, já tenho tudo que preciso! Vou repassar pra nossa equipe calcular o valor certinho e já te retorno por aqui.'
export const VISTORIA_PRESENCIAL_MESSAGE = 'Show! Um assistente vai entrar em contato pra marcar o dia e horário da vistoria.'
export const VISTORIA_FOTOS_REQUEST_MESSAGE = 'Beleza! Pode mandar as fotos e vídeos de tudo que vai ser transportado, por favor.'
export const VISTORIA_MEDIA_MORE_QUESTION = 'Tem mais alguma coisa que você queira mandar, ou é só isso?'
export const VISTORIA_MEDIA_DONE_MESSAGE = 'Combinado! Vou avaliar as fotos e vídeos com a equipe e te dou um retorno.'
export const ITEMS_FOLLOWUP_QUESTION = 'Tem mais alguma coisa que você vai levar, ou é só isso?'

// Áudio (.opus) fica fora de escopo — não transcrevemos. Foto/vídeo/
// documento a gente não analisa o conteúdo, mas ainda registra que chegou,
// pra IA não ficar pedindo de novo algo que o cliente já mandou.
export function resolveMessageText(msg) {
  if (msg.body) return msg.body
  if (!msg.hasMedia) return null
  if (msg.type === 'ptt' || msg.type === 'audio') return null
  if (msg.type === 'image') return '[cliente enviou uma foto]'
  if (msg.type === 'video') return '[cliente enviou um vídeo]'
  if (msg.type === 'document') return '[cliente enviou um arquivo]'
  return null
}

// Igual ao Message#_getChatId() interno do whatsapp-web.js (não exposto
// publicamente): numa mensagem que o cliente manda, o chat é msg.from; numa
// mensagem fromMe (bot OU humano mandando pelo mesmo número), msg.to é quem
// recebe — msg.from nesse caso é a própria conta da empresa, não o cliente.
export function resolveChatId(msg) {
  return msg.fromMe ? msg.to : msg.from
}

/**
 * Monta o handler de conversas em torno de um waClient (o Client real do
 * whatsapp-web.js em produção, ou um fake nos testes) — toda a lógica de
 * negócio mora aqui, testável sem depender de uma sessão WhatsApp de
 * verdade. index.js só cria o Client real e liga o evento nele.
 */
export function createConversationHandler(waClient, { testContacts = [], botEnabledForAll = false, log = console.log, schedule = debounce } = {}) {
  const sendAndRecord = (whatsappChatId, clientId, text) => sendAndRecordShared(waClient, whatsappChatId, clientId, text)

  // Contatos que chegam como @lid (comum em produção hoje) trazem
  // contact.number igual ao próprio número do LID, não o telefone real — a
  // lib tem uma chamada dedicada pra resolver o telefone de verdade por
  // trás do LID. Recebe chatId (não msg.from direto) porque pra mensagem
  // humana (fromMe) o chat é msg.to, não msg.from — ver resolveChatId.
  async function resolveRealPhoneNumber(chatId, contact) {
    if (!chatId.endsWith('@lid')) return contact?.number || null
    try {
      const [resolved] = await waClient.getContactLidAndPhone([chatId])
      if (resolved?.pn) return resolved.pn.split('@')[0]
    } catch (err) {
      log(`[${new Date().toISOString()}] ⚠️ Falha ao resolver telefone real do LID ${chatId}: ${err.message}`)
    }
    return contact?.number || null
  }

  // Grava a mensagem (do cliente OU do operador humano) e garante que
  // existe um Client no CRM pra ela — roda pra toda mensagem, mesmo que o
  // processamento da IA seja debounced. direction: 'IN' pro cliente,
  // 'OUT_HUMAN' pro operador mandando manualmente (nunca chega aqui uma
  // mensagem que o próprio bot mandou — essa é filtrada antes, via
  // botSentMessageIds/isDuplicateWaMessageError).
  async function persistIncomingMessage(msg, chatId, text, waMessageId) {
    const contact = await waClient.getContactById(chatId).catch(() => null)
    const phoneNumber = await resolveRealPhoneNumber(chatId, contact)
    const contactName = contact?.pushname || contact?.name || null

    const clientRecord = await findOrCreateClient({
      whatsappChatId: chatId,
      phoneNumber,
      contactName,
    })
    const direction = msg.fromMe ? 'OUT_HUMAN' : 'IN'
    await recordMessage(clientRecord.id, direction, text, waMessageId)
    return clientRecord
  }

  // Responde quando o cliente reage à proposta de horário de vistoria —
  // roda mesmo se o bot já estiver quieto esperando o orçamento, porque é
  // um assunto separado (agenda, não preço).
  async function handleVistoriaResponse(clientRecord, appointment, history) {
    const result = await classifyVistoriaResponse(history)
    if (!(await isSafeToAutoReply(clientRecord.id))) return // handoff pode ter ativado enquanto classifyVistoriaResponse rodava

    if (result.accepted) {
      await prisma.appointment.update({
        where: { id: appointment.id },
        data: { clientRespondedAt: new Date(), clientAccepted: true },
      })
      const text = 'Show, vou confirmar aqui com a equipe. Nos vemos lá!'
      await sendAndRecord(clientRecord.whatsappChatId, clientRecord.id, text)
      await prisma.historyEntry.create({
        data: { clientId: clientRecord.id, text: 'Cliente confirmou o horário da vistoria.' },
      })
      return
    }

    // Recusou — volta pro estado "a confirmar" (some do painel de
    // "aguardando resposta" e o Luciano vê que precisa decidir de novo), já
    // atualizando a data/horário se o cliente sugeriu um novo na mesma
    // mensagem.
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
    await sendAndRecord(clientRecord.whatsappChatId, clientRecord.id, text)
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

  // Roda enquanto collectingVistoriaMedia=true — dispara ~1min depois da
  // última mídia recebida (ver VISTORIA_MEDIA_DEBOUNCE_MS). Só finaliza a
  // coleta se o cliente já deixou claro que não tem mais nada a mandar;
  // senão pergunta e continua esperando.
  async function handleVistoriaMediaCollection(clientRecord, history) {
    const done = await classifyMediaSubmissionComplete(history)
    if (!(await isSafeToAutoReply(clientRecord.id))) return // handoff pode ter ativado enquanto classifyMediaSubmissionComplete rodava

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

  // Roda extração + resposta pra um cliente depois do período de silêncio
  // do debounce. Se o bot já deixou o cliente esperando o orçamento
  // (awaitingBudget), fica quieto — quem assume dali pra frente é o humano
  // ou o budgetWatcher, não insiste mais pedindo informação. Exceção:
  // handoff humano ativo pula os desvios automáticos (vistoria pendente,
  // coleta de mídia, awaitingBudget) e vai direto pra extração, porque
  // nenhum deles pode gerar mensagem automática enquanto o humano estiver
  // conduzindo — mas o CRM continua sendo atualizado.
  async function processConversationTurn(clientId) {
    const clientRecord = await prisma.client.findUnique({ where: { id: clientId } })
    if (!clientRecord) return

    const handoffActive = isHumanHandoffActive(clientRecord)

    if (!handoffActive) {
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
    }

    const history = await getConversationHistory(clientId)
    const extracted = await extractClientInfo(clientRecord, history)
    const movingDateReference = history.at(-1)?.createdAt ?? new Date()
    const movingDate = await extractMovingDate(history, movingDateReference)

    // Conversa em andamento de verdade — sai de "Novo contato" assim que o
    // bot começa a trabalhar o lead, pra aparecer nas seções certas do CRM.
    const statusUpdate = clientRecord.status === 'NOVO_CONTATO' ? { status: 'EM_ATENDIMENTO' } : {}

    // Só troca o nome quando o cliente confirmou o dele de verdade na
    // conversa — nunca sobrescreve com o nome salvo no WhatsApp.
    const nameUpdate = extracted.clientName ? { name: extracted.clientName, nameConfirmed: true } : {}

    // movingCancelledAt marca só a transição pra true (não fica reescrevendo
    // a cada turno enquanto continuar cancelado) e volta a null assim que uma
    // reativação/reagendamento explícito zera movingCancelled (ver
    // extractionPolicy.js e docs/correcoes/05_CANCELAMENTOS_ESTRUTURADOS.md).
    // Isto só grava o estado estruturado — não altera handoff, cooldown nem
    // nenhuma condição de envio de mensagem do bot, que continuam adiante
    // exatamente como antes desta correção.
    const cancellationJustSet = !clientRecord.movingCancelled && extracted.movingCancelled

    const updated = await prisma.client.update({
      where: { id: clientId },
      data: {
        ...statusUpdate,
        ...nameUpdate,
        originAddress: extracted.originAddress,
        destinationAddress: extracted.destinationAddress,
        movingDate: movingDate ? new Date(`${movingDate}T00:00:00`) : clientRecord.movingDate,
        propertyType: extracted.propertyType,
        movingNotes: extracted.movingNotes,
        commercialNotes: extracted.commercialNotes,
        clientNickname: extracted.clientNickname,
        stairsOrElevator: extracted.stairsOrElevator,
        truckAccess: extracted.truckAccess,
        vistoriaResolved: extracted.vistoriaResolved,
        vistoriaType: extracted.vistoriaType,
        movingCancelled: extracted.movingCancelled,
        movingCancelledAt: extracted.movingCancelled ? (cancellationJustSet ? new Date() : clientRecord.movingCancelledAt) : null,
        cancellationEvidence: extracted.cancellationEvidence,
      },
    })

    if (handoffActive) return
    // Reconfere com dado fresco: extractClientInfo/extractMovingDate acima
    // levam segundos de verdade (API real) — tempo suficiente pra uma
    // mensagem humana chegar e ativar o handoff enquanto este turno ainda
    // decidia com base no snapshot que leu lá no topo da função.
    if (!(await isSafeToAutoReply(clientId))) return

    // Assunto vistoria acabou de ser resolvido nessa rodada — dispara a
    // mensagem certa pra cada caminho. "fotos" entra em modo de coleta e
    // para por aqui (não segue pro "tenho tudo" enquanto não terminar de
    // mandar); "presencial" só avisa e segue o fluxo normal (pode já cair
    // no "tenho tudo" logo em seguida, se essa era a última coisa
    // faltando).
    const vistoriaJustResolved = !clientRecord.vistoriaResolved && updated.vistoriaResolved
    if (vistoriaJustResolved && updated.vistoriaType === 'presencial') {
      await sendAndRecord(updated.whatsappChatId, clientId, VISTORIA_PRESENCIAL_MESSAGE)
    } else if (vistoriaJustResolved && updated.vistoriaType === 'fotos') {
      await sendAndRecord(updated.whatsappChatId, clientId, VISTORIA_FOTOS_REQUEST_MESSAGE)
      await prisma.client.update({ where: { id: clientId }, data: { collectingVistoriaMedia: true } })
      return
    }

    // Cliente citou item(ns) pela primeira vez nessa rodada — pergunta se
    // tem mais alguma coisa, só essa vez. A resposta (seja mais itens ou
    // "não") é aceita como definitiva; não voltamos a perguntar isso de
    // novo, pra não ficar insistindo mensagem após mensagem.
    const itemsJustProvided = !clientRecord.movingNotes && updated.movingNotes
    if (itemsJustProvided) {
      await sendAndRecord(updated.whatsappChatId, clientId, ITEMS_FOLLOWUP_QUESTION)
      return
    }

    const missing = getMissingRequiredFields(updated)

    if (missing.length === 0) {
      // Já foi orçado ou está em estágio pós-orçamento (agendamento,
      // pagamento, pós-venda) — isso o Luciano conduz manualmente, o bot
      // não se mete.
      if (updated.budgetSentAt || updated.budgetValue !== null) return

      await finalizeDataCollection(clientId, updated.whatsappChatId)
      return
    }

    // Manda só o campo que falta primeiro (ordem de REQUIRED_FIELDS) em vez
    // da lista toda — pedir pro modelo escolher "o próximo item" de uma
    // lista se mostrou pouco confiável. Decidir isso em código é
    // determinístico, igual já é feito com data.
    const clientFirstName = updated.nameConfirmed ? updated.name?.split(' ')[0] : null
    const reply = await generateReply(history, missing.slice(0, 1), clientFirstName, extracted.clientNickname)
    // generateReply é a chamada de IA mais demorada do turno — mesma
    // corrida do check acima, reconfere de novo bem antes de mandar.
    if (!(await isSafeToAutoReply(clientId))) return
    await sendAndRecord(updated.whatsappChatId, clientId, reply)
  }

  // Handler do evento 'message_create' — dispara pras duas direções
  // (cliente E fromMe), ao contrário de 'message' (whatsapp-web.js só emite
  // 'message' quando !fromMe — ver node_modules/whatsapp-web.js/src/Client.js).
  async function handleIncomingMessage(msg) {
    const chatId = resolveChatId(msg)
    const waMessageId = msg.id?._serialized ?? null

    if (msg.fromMe && waMessageId && botSentMessageIds.has(waMessageId)) {
      // Eco da própria mensagem que o bot mandou (via sendAndRecord) — já
      // registrada no CRM naquele momento, não é intervenção humana.
      botSentMessageIds.delete(waMessageId)
      return
    }

    const chat = await msg.getChat().catch(() => null)
    if (chat?.isGroup) return

    if (!botEnabledForAll && !testContacts.includes(chatId)) {
      // Fora da lista de teste ainda — só loga quem é, pra dar pra
      // adicionar na lista depois. Não persiste nada, não responde.
      if (!msg.fromMe) {
        const contact = await msg.getContact().catch(() => null)
        log(`[${new Date().toISOString()}] 🚫 Mensagem de contato fora da lista de teste: ${chatId} (${contact?.pushname || contact?.name || 'sem nome'})`)
      }
      return
    }

    const text = resolveMessageText(msg)
    if (!text) return // sem conteúdo útil pro bot (ex: áudio, fora de escopo)

    log(`${msg.fromMe ? '🧑‍💼 Operador' : '📩 Cliente'} em ${chatId}: ${text}`)

    let clientRecord
    try {
      clientRecord = await persistIncomingMessage(msg, chatId, text, waMessageId)
    } catch (err) {
      if (isDuplicateWaMessageError(err)) {
        // Corrida rara: o eco do próprio bot chegou antes de
        // botSentMessageIds ser populado (ver sendAndRecord) — a
        // constraint única de waMessageId barrou a duplicata. Já está
        // gravado, nada a fazer.
        return
      }
      log(`[${new Date().toISOString()}] ⚠️ Falha ao gravar mensagem no CRM: ${err.message}`)
      return
    }

    if (msg.fromMe) {
      // Mensagem humana de verdade (operador, não o bot): registra o
      // handoff — a partir daqui processConversationTurn processa a
      // conversa (extração/CRM) mas não manda resposta automática enquanto
      // durar o cooldown (ver isHumanHandoffActive).
      await markHumanHandoff(clientRecord.id)
      schedule(
        chatId,
        () =>
          processConversationTurn(clientRecord.id).catch((err) => {
            log(`[${new Date().toISOString()}] ⚠️ Falha ao processar conversa: ${err.message}`)
          }),
        REPLY_DEBOUNCE_MS,
      )
      return
    }

    const debounceMs = clientRecord.collectingVistoriaMedia ? VISTORIA_MEDIA_DEBOUNCE_MS : REPLY_DEBOUNCE_MS
    schedule(
      chatId,
      () =>
        processConversationTurn(clientRecord.id).catch((err) => {
          log(`[${new Date().toISOString()}] ⚠️ Falha ao processar conversa: ${err.message}`)
        }),
      debounceMs,
    )
  }

  return {
    handleIncomingMessage,
    processConversationTurn,
    persistIncomingMessage,
    sendAndRecord,
  }
}
