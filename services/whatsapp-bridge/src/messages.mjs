const unwrap = message => {
  for (let depth = 0; depth < 8 && message; depth++) {
    const wrapped = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message.viewOnceMessageV2?.message ?? message.documentWithCaptionMessage?.message;
    if (!wrapped) return message;
    message = wrapped;
  }
  return message;
};
/** No groups, broadcasts, status, reactions, deleted-message payloads or media download. */
export function normalizeMessage(event, accountRef) {
  const jid = event?.key?.remoteJid;
  if (!jid || (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@lid')) || !event.key.id) return null;
  const message = unwrap(event.message);
  if (!message || message.protocolMessage || message.reactionMessage || message.senderKeyDistributionMessage) return null;
  const types = [['imageMessage', 'image', '[Gambar]'], ['videoMessage', 'video', '[Video]'], ['audioMessage', 'audio', '[Audio]'], ['documentMessage', 'document', '[Dokumen]'], ['stickerMessage', 'sticker', '[Stiker]']];
  let body = message.conversation ?? message.extendedTextMessage?.text;
  let type = 'text';
  if (body === undefined) {
    const kind = types.find(([field]) => message[field]);
    if (!kind) return null;
    type = kind[1];
    body = message[kind[0]].caption || kind[2];
  }
  if (typeof body !== 'string' || !body.trim()) return null;
  const alternate = event.key.remoteJidAlt;
  const phoneJid = jid.endsWith('@s.whatsapp.net') ? jid : alternate?.endsWith('@s.whatsapp.net') ? alternate : null;
  const phone = phoneJid?.split('@')[0].split(':')[0].replace(/\D/g, '') || null;
  const rawTime = event.messageTimestamp?.toNumber?.() ?? Number(event.messageTimestamp);
  if (!Number.isFinite(rawTime) || rawTime <= 0 || rawTime > 8.64e12) return null;
  return {
    p_account_ref: accountRef,
    p_chat_id: jid,
    p_message_id: event.key.id,
    p_name: event.key.fromMe ? null : event.pushName?.slice(0, 200) || null,
    p_phone: phone,
    p_body: body.slice(0, 16000),
    p_direction: event.key.fromMe ? 'outbound' : 'inbound',
    p_type: type,
    p_sent_at: new Date(rawTime * 1000).toISOString(),
  };
}
