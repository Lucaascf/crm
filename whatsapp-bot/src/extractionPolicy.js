// Ausência de informação não é uma solicitação explícita de exclusão.
export function isUnknown(value) {
  return value == null || (typeof value === 'string' && /^(?:\s*|ainda n[aã]o informado[.!]?|n[aã]o informado[.!]?)$/i.test(value.trim()))
}

const UNKNOWN = 'ainda não informado'
function sides(value) {
  if (isUnknown(value)) return {}
  if (!/^\s*(Origem|Destino):/i.test(value)) return null
  const result = {}
  for (const match of String(value).matchAll(/(Origem|Destino):\s*([\s\S]*?)(?=(?:Origem|Destino):|$)/gi)) {
    result[match[1].toLowerCase() === 'origem' ? 'origin' : 'destination'] = match[2].replace(/[.\s]+$/, '')
  }
  return result
}

export function mergeSides(previous, next, strict = false) {
  const oldSides = sides(previous)
  const newSides = sides(next)
  if (!newSides) {
    if (!strict) return next
    return mergeSides(null, oldSides ? previous : null)
  }
  // Preserva respostas legadas sem estrutura quando a extração inteira sumiu.
  if (!oldSides && !isUnknown(previous) && (isUnknown(next) || (isUnknown(newSides.origin) && isUnknown(newSides.destination)))) {
    return strict ? mergeSides(null, null) : previous
  }
  const choose = (key) => isUnknown(newSides[key]) ? oldSides?.[key] || UNKNOWN : newSides[key]
  return `Origem: ${choose('origin')}. Destino: ${choose('destination')}.`
}

export function stabilizeExtraction(client, extracted) {
  const result = { ...extracted }
  for (const key of ['originAddress', 'destinationAddress', 'propertyType', 'movingNotes', 'clientNickname', 'commercialNotes']) {
    if (isUnknown(result[key]) && !isUnknown(client[key])) result[key] = client[key]
  }
  if (isUnknown(result.clientName) && client.nameConfirmed) result.clientName = client.name
  result.stairsOrElevator = mergeSides(client.stairsOrElevator, result.stairsOrElevator, true)
  result.truckAccess = mergeSides(client.truckAccess, result.truckAccess)
  if (!result.vistoriaType && client.vistoriaResolved && client.vistoriaType) {
    result.vistoriaType = client.vistoriaType
    result.vistoriaResolved = true
  }
  if (!result.vistoriaType) result.vistoriaResolved = false

  // Cancelamento explícito da mudança é sticky: uma vez confirmado
  // (client.movingCancelled true), só uma reativação/reagendamento
  // EXPLÍCITO do cliente deve reverter — nunca o modelo simplesmente
  // "esquecer" de mencionar de novo numa rodada em que o assunto não
  // voltou à tona (a mesma classe de risco que motivou a preservação
  // contra null dos demais campos acima). Distinguimos os dois casos pela
  // evidência: reativação real vem acompanhada de cancellationEvidence
  // citando a fala de reativação (ver EXTRACTION_SYSTEM_PROMPT em ai.js);
  // "false" sem evidência nenhuma é tratado como incerteza do modelo, não
  // como reativação, e o estado anterior é preservado — sem impedir o
  // cancelamento explícito nem a reativação explícita (requisitos 6 e 8
  // da correção P1.1, docs/correcoes/05_CANCELAMENTOS_ESTRUTURADOS.md).
  if (client.movingCancelled && !result.movingCancelled && !result.cancellationEvidence) {
    result.movingCancelled = true
    result.cancellationEvidence = client.cancellationEvidence ?? null
  }

  return result
}
