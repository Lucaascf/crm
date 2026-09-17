import { prisma } from './db.js'

// Esse número de WhatsApp é usado só pelo Luciano — todo cliente novo
// captado pelo bot fica na conta dele (ver plano de implementação).
const OWNER_EMAIL = 'luciano'

const isEmpty = (value) => value === null || value === undefined || value === ''

// Decisão de produto (confirmada com o Lucas em 2026-09-17): depois que um
// humano manda uma mensagem manualmente, o bot fica em silêncio (não gera
// nem envia resposta automática) por HUMAN_HANDOFF_COOLDOWN_MS de
// inatividade DO HUMANO. Se o humano mandar outra mensagem, o cooldown
// reinicia. Se o cooldown expirar sem nova mensagem humana, a PRÓXIMA
// mensagem do cliente já é respondida normalmente pelo bot — não existe
// reativação automática "no meio" do cooldown, nem botão manual de reversão
// nesta entrega.
export const HUMAN_HANDOFF_COOLDOWN_MS = 2 * 60 * 60 * 1000 // 2 horas

// Handoff persiste em Client.lastHumanMessageAt (banco) — não em memória —
// então sobrevive a reinícios do processo do bot (ver relatório, seção
// "Reinício do processo").
export function isHumanHandoffActive(client) {
  if (!client.lastHumanMessageAt) return false
  return Date.now() - new Date(client.lastHumanMessageAt).getTime() < HUMAN_HANDOFF_COOLDOWN_MS
}

/**
 * Reconfirma com dado FRESCO do banco que ainda é seguro mandar uma
 * resposta automática — chamar de novo bem antes de qualquer
 * sendAndRecord, depois de qualquer chamada de IA (que pode levar
 * segundos). Sem isso, um turno que começou a decidir com handoffActive
 * ainda false pode acabar mandando mensagem DEPOIS que uma mensagem humana
 * chegou e ativou o handoff no meio do processamento — a extração/geração
 * de resposta não é instantânea, e o handoff é justamente sobre reagir a
 * eventos que podem acontecer enquanto isso roda. Encontrado na prática
 * rodando a bateria de teste com a API real (com latência de verdade); o
 * mock nunca expôs isso por responder rápido demais pra dar tempo de uma
 * corrida acontecer.
 */
export async function isSafeToAutoReply(clientId) {
  const fresh = await prisma.client.findUnique({ where: { id: clientId } })
  return Boolean(fresh) && !isHumanHandoffActive(fresh)
}

// stairsOrElevator/truckAccess vêm da IA no formato "Origem: X. Destino: Y.",
// e quando um dos dois lados ficou ambíguo/não respondido ela escreve
// explicitamente "ainda não informado" em vez de adivinhar (ver ai.js) — um
// campo com esse texto não conta como resolvido, tem que voltar pra lista de
// perguntas até o cliente confirmar os dois lados.
const isFullyConfirmed = (value) => !isEmpty(value) && !value.toLowerCase().includes('ainda não informado')

// Campos que bloqueiam o "pronto pra orçar".
export const REQUIRED_FIELDS = [
  { key: 'nameConfirmed', label: 'nome completo do cliente', check: (c) => c.nameConfirmed === true },
  { key: 'originAddress', label: 'endereço de origem' },
  { key: 'destinationAddress', label: 'endereço de destino' },
  { key: 'propertyType', label: 'tipo de imóvel (apartamento, casa, etc)' },
  { key: 'movingNotes', label: 'relação dos itens que serão transportados' },
  {
    key: 'stairsOrElevator',
    label: 'se há escada ou elevador na origem e no destino',
    check: (c) => isFullyConfirmed(c.stairsOrElevator),
  },
  {
    key: 'truckAccess',
    label: 'se o caminhão consegue parar na porta dos dois locais',
    check: (c) => isFullyConfirmed(c.truckAccess),
  },
  { key: 'movingDate', label: 'data prevista da mudança' },
  {
    key: 'vistoriaResolved',
    label: 'se quer uma vistoria presencial ou prefere mandar fotos e vídeo dos itens',
    check: (c) => c.vistoriaResolved === true,
  },
]

let ownerUserIdCache = null
async function getOwnerUserId() {
  if (ownerUserIdCache) return ownerUserIdCache
  const owner = await prisma.user.findUnique({ where: { email: OWNER_EMAIL } })
  if (!owner) {
    throw new Error(`Usuário dono das conversas do bot não encontrado (email="${OWNER_EMAIL}").`)
  }
  ownerUserIdCache = owner.id
  return ownerUserIdCache
}

/**
 * Acha o Client pelo whatsappChatId (id bruto do whatsapp-web.js). Se não
 * existir, procura por número de telefone (caso o cliente já tenha sido
 * cadastrado manualmente) antes de criar um novo.
 */
export async function findOrCreateClient({ whatsappChatId, phoneNumber, contactName }) {
  const existing = await prisma.client.findUnique({ where: { whatsappChatId } })
  if (existing) return existing

  const byPhone = phoneNumber
    ? await prisma.client.findFirst({ where: { whatsapp: phoneNumber } })
    : null
  if (byPhone) {
    return prisma.client.update({
      where: { id: byPhone.id },
      data: { whatsappChatId },
    })
  }

  const userId = await getOwnerUserId()
  try {
    return await prisma.client.create({
      data: {
        userId,
        // Nome do WhatsApp é só um placeholder inicial — o bot pede o nome de
        // verdade na conversa e marca nameConfirmed quando o cliente confirma.
        name: contactName || phoneNumber || whatsappChatId,
        whatsapp: phoneNumber || whatsappChatId,
        whatsappChatId,
        status: 'NOVO_CONTATO',
        historyEntries: {
          create: { text: 'Cliente cadastrado automaticamente pelo bot do WhatsApp.' },
        },
      },
    })
  } catch (err) {
    // Corrida: duas mensagens do mesmo chat novo (ex: cliente e humano quase
    // juntos) passaram pelo findUnique acima antes de qualquer uma criar o
    // Client — a segunda esbarra na constraint única de whatsappChatId.
    // Em vez de derrubar o processamento dessa mensagem, busca o registro
    // que a outra chamada acabou de criar.
    if (err.code === 'P2002') {
      const race = await prisma.client.findUnique({ where: { whatsappChatId } })
      if (race) return race
    }
    throw err
  }
}

export function isDuplicateWaMessageError(err) {
  return err?.code === 'P2002'
}

// waMessageId de mensagens que O PRÓPRIO BOT mandou (via sendAndRecord em
// index.js, budgetWatcher.js ou vistoriaWatcher.js — os três pontos que
// mandam mensagem automática) — compartilhado entre eles porque
// whatsapp-web.js ecoa toda mensagem enviada pela conta de volta como
// evento 'message_create' com fromMe=true, e sem isso o handler principal
// (em index.js) confundiria a própria mensagem do bot com uma intervenção
// humana. Serve só de atalho rápido; a defesa definitiva contra a corrida é
// a constraint única de waMessageId no banco (ver isDuplicateWaMessageError).
export const botSentMessageIds = new Set()

export async function recordMessage(clientId, direction, text, waMessageId = null) {
  return prisma.message.create({
    data: { clientId, direction, text, waMessageId },
  })
}

/**
 * Envia uma mensagem automática do bot e registra no CRM, marcando o
 * waMessageId em botSentMessageIds pra o handler de mensagens (index.js)
 * não confundir o eco dessa mensagem com uma intervenção humana. Usado
 * pelos três lugares que mandam mensagem automática: o handler principal
 * (index.js), budgetWatcher.js e vistoriaWatcher.js.
 */
export async function sendAndRecord(waClient, whatsappChatId, clientId, text) {
  const sent = await waClient.sendMessage(whatsappChatId, text)
  const waMessageId = sent?.id?._serialized ?? null
  if (waMessageId) botSentMessageIds.add(waMessageId)
  await recordMessage(clientId, 'OUT', text, waMessageId)
}

export async function markHumanHandoff(clientId) {
  return prisma.client.update({
    where: { id: clientId },
    data: { lastHumanMessageAt: new Date() },
  })
}

export async function getConversationHistory(clientId) {
  return prisma.message.findMany({
    where: { clientId },
    orderBy: { createdAt: 'asc' },
  })
}

export function getMissingRequiredFields(client) {
  return REQUIRED_FIELDS.filter((f) => (f.check ? !f.check(client) : isEmpty(client[f.key])))
}
