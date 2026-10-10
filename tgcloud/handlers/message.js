import { api } from 'sdk';

/**
 * Minimal migration smoke handler. Business handlers are added incrementally;
 * the existing Express webhook remains the production rollback path.
 */
export default async function messageHandler(message) {
  if (!message?.chat?.id || !message?.text) return;
  if (message.text === '/serverless') {
    await api.sendMessage({
      chat_id: message.chat.id,
      text: 'Telegram Serverless migration endpoint is available for testing.',
    });
  }
}
