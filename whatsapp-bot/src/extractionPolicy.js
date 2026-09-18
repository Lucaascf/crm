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
  return result
}
