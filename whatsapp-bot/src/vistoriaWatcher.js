import { prisma } from './db.js'
import { recordMessage } from './clientState.js'

const POLL_INTERVAL_MS = 8_000

function formatDateBR(date) {
  return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

function buildProposalMessage(appointment) {
  const dateStr = formatDateBR(appointment.date)
  const timeStr = appointment.time ? ` às ${appointment.time}` : ''
  return `Consegui confirmar a vistoria pra ${dateStr}${timeStr}. Pode ser esse horário?`
}

/**
 * A cada POLL_INTERVAL_MS, procura vistorias que o Luciano já confirmou no
 * site (confirmedByUser=true) mas que o cliente ainda não recebeu a
 * proposta — manda a mensagem perguntando se o horário funciona.
 */
export function startVistoriaWatcher(waClient) {
  const tick = async () => {
    let ready
    try {
      ready = await prisma.appointment.findMany({
        where: { type: 'VISTORIA', confirmedByUser: true, proposalSentAt: null },
        include: { client: true },
      })
    } catch (err) {
      console.log(`[${new Date().toISOString()}] [vistoriaWatcher] falha ao consultar vistorias: ${err.message}`)
      return
    }

    for (const appointment of ready) {
      const chatId = appointment.client?.whatsappChatId
      if (!chatId) continue
      try {
        const text = buildProposalMessage(appointment)
        await waClient.sendMessage(chatId, text)
        await recordMessage(appointment.clientId, 'OUT', text)
        await prisma.appointment.update({
          where: { id: appointment.id },
          data: { proposalSentAt: new Date() },
        })
        console.log(`[${new Date().toISOString()}] 🏠 Proposta de vistoria enviada pro cliente ${appointment.clientId}`)
      } catch (err) {
        console.log(`[${new Date().toISOString()}] [vistoriaWatcher] falha ao enviar proposta (appointment ${appointment.id}): ${err.message}`)
      }
    }
  }

  const interval = setInterval(tick, POLL_INTERVAL_MS)
  return () => clearInterval(interval)
}
