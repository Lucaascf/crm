// Amostra reprodutível estratificada por tamanho; vazios nunca consomem vagas.
export function pickSample(conversations, n) {
  if (!Number.isInteger(n) || n < 1) throw new Error('Tamanho da amostra deve ser inteiro positivo')
  const sorted = conversations.filter((c) => c.messages.length > 0)
    .sort((a, b) => a.messages.length - b.messages.length || a.file.localeCompare(b.file))
  const size = Math.min(n, sorted.length)
  return Array.from({ length: size }, (_, i) => sorted[Math.floor(i * (sorted.length - 1) / Math.max(1, size - 1))])
}

// Só ignora caixa, acentos, espaços e ponto final; diferenças restantes pedem revisão.
export function cosmeticEqual(a, b) {
  const normalize = (value) => typeof value === 'string'
    ? value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/\.$/, '')
    : value
  return normalize(a) === normalize(b)
}
