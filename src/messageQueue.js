// Simple message queue with retry/backoff for WhatsApp sending
const queue = [];
let clientRef = null;
let sending = false;
let attempt = 0;

export function setClient(client) {
  clientRef = client;
}

export function enqueueMessage(phone, text) {
  queue.push({ phone, text });
}

async function processQueue() {
  if (sending) return;
  if (!queue.length) return;
  if (!clientRef) return;
  sending = true;
  try {
    while (queue.length) {
      const item = queue[0];
      try {
        await clientRef.sendMessage(item.phone.endsWith('@c.us') ? item.phone : item.phone + '@c.us', item.text);
        queue.shift();
        attempt = 0; // reset on success
      } catch (e) {
        attempt++;
        const wait = Math.min(30000, 1000 * attempt);
        console.warn('Falha ao enviar. Retentando em', wait, 'ms');
        setTimeout(() => { sending = false; processQueue(); }, wait);
        return;
      }
    }
  } finally {
    sending = false;
  }
}

setInterval(processQueue, 3000);
