const timers = new Map()

/**
 * Agrupa chamadas rápidas em sequência pra uma mesma chave (ex: chat do
 * WhatsApp) — útil porque clientes reais mandam várias mensagens seguidas
 * em vez de um parágrafo só. Só roda `fn` depois de `delayMs` de silêncio.
 */
export function debounce(key, fn, delayMs) {
  const existing = timers.get(key)
  if (existing) clearTimeout(existing)
  const handle = setTimeout(() => {
    timers.delete(key)
    fn()
  }, delayMs)
  timers.set(key, handle)
}
