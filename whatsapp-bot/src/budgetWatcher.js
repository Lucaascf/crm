import { prisma } from './db.js'
import { recordMessage } from './clientState.js'

// Intervalo de checagem — não precisa ser em tempo real, mas o site mostra
// "mandando em instantes" assim que o Luciano salva, então mantemos curto.
const POLL_INTERVAL_MS = 8_000

function formatBRL(value) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function buildBudgetMessage(client) {
  const value = formatBRL(client.budgetValue)
  let text = `Consegui fechar o valor da sua mudança: ${value}`
  if (client.budgetNotes) {
    text += `\n\nIsso inclui: ${client.budgetNotes}`
  }
  text += `\n\nQualquer dúvida estou à disposição!`
  return text
}

/**
 * A cada POLL_INTERVAL_MS, procura clientes que o bot já deixou prontos pra
 * orçar (awaitingBudget=true) e que já têm budgetValue preenchido no site
 * (pelo Luciano), mas ainda não receberam a mensagem — manda e fecha o ciclo.
 */
export function startBudgetWatcher(waClient) {
  const tick = async () => {
    let ready
    try {
      ready = await prisma.client.findMany({
        where: { awaitingBudget: true, budgetValue: { not: null }, budgetSentAt: null },
      })
    } catch (err) {
      console.log(`[${new Date().toISOString()}] [budgetWatcher] falha ao consultar clientes: ${err.message}`)
      return
    }

    for (const client of ready) {
      if (!client.whatsappChatId) continue
      try {
        const text = buildBudgetMessage(client)
        await waClient.sendMessage(client.whatsappChatId, text)
        await recordMessage(client.id, 'OUT', text)
        await prisma.client.update({
          where: { id: client.id },
          data: {
            budgetSentAt: new Date(),
            awaitingBudget: false,
            status: 'ORCAMENTO_ENVIADO',
            historyEntries: {
              create: { text: `Orçamento de ${formatBRL(client.budgetValue)} enviado automaticamente pelo bot.` },
            },
          },
        })
        console.log(`[${new Date().toISOString()}] 💰 Orçamento enviado pro cliente ${client.id}`)
      } catch (err) {
        console.log(`[${new Date().toISOString()}] [budgetWatcher] falha ao enviar orçamento pro cliente ${client.id}: ${err.message}`)
      }
    }
  }

  const interval = setInterval(tick, POLL_INTERVAL_MS)
  return () => clearInterval(interval)
}
