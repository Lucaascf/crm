import { prisma } from './db.js'

// Esse número de WhatsApp é usado só pelo Luciano — todo cliente novo
// captado pelo bot fica na conta dele (ver plano de implementação).
const OWNER_EMAIL = 'luciano'

const isEmpty = (value) => value === null || value === undefined || value === ''

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
  return prisma.client.create({
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
}

export async function recordMessage(clientId, direction, text, waMessageId = null) {
  return prisma.message.create({
    data: { clientId, direction, text, waMessageId },
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
