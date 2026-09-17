// Fake do Client do whatsapp-web.js — implementa só os métodos que
// src/conversationHandler.js chama no objeto waClient (sendMessage,
// getContactById, getContactLidAndPhone). Nunca toca rede/WhatsApp real —
// é isso que garante que a bateria de testes não manda mensagem real pra
// cliente nenhum (ver seção 15 do pedido).
export function makeFakeWaClient() {
  let counter = 0
  const sent = [] // { chatId, text, id }

  return {
    sent,
    async sendMessage(chatId, text) {
      counter += 1
      const id = { _serialized: `wamid.FAKE_${process.pid}_${Date.now()}_${counter}` }
      sent.push({ chatId, text, id: id._serialized })
      return { id }
    },
    async getContactById(chatId) {
      return { number: chatId.split('@')[0], pushname: null, name: null }
    },
    async getContactLidAndPhone(ids) {
      return ids.map((id) => ({ pn: `${id.split('@')[0]}0@c.us` }))
    },
  }
}

// Fabrica uma Message fake do whatsapp-web.js com só os campos/métodos que
// conversationHandler.js usa (fromMe, from, to, body, hasMedia, type, id,
// getChat, getContact) — o suficiente pra exercitar handleIncomingMessage
// de ponta a ponta sem uma sessão WhatsApp real.
let msgCounter = 0
export function makeFakeMessage({ fromMe, chatId, botOwnId = 'BOT_OWN_ID@c.us', text, waMessageId, isGroup = false }) {
  msgCounter += 1
  return {
    fromMe,
    from: fromMe ? botOwnId : chatId,
    to: fromMe ? chatId : botOwnId,
    body: text,
    hasMedia: false,
    type: 'chat',
    id: { _serialized: waMessageId ?? `wamid.IN_${process.pid}_${Date.now()}_${msgCounter}` },
    async getChat() {
      return { isGroup }
    },
    async getContact() {
      return { pushname: null, name: null }
    },
  }
}
