const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
const expectedTitle = process.env.TELEGRAM_EXPECTED_CHAT_TITLE?.trim() || 'БелСтеклоЭксперт';

if (!token || !chatId) {
  console.error('Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID. No Telegram request was made.');
  process.exitCode = 2;
} else {
  const call = async (method, params = {}) => {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.ok !== true) throw new Error(`${method} failed with HTTP ${response.status}`);
    return body.result;
  };

  try {
    const me = await call('getMe');
    const chat = await call('getChat', { chat_id: chatId });
    const membership = await call('getChatMember', { chat_id: chatId, user_id: me.id });
    const member = ['creator', 'administrator', 'member', 'restricted'].includes(membership.status);
    const canSend = member && membership.status !== 'left' && membership.status !== 'kicked'
      && membership.can_send_messages !== false;
    const titleMatches = chat.title === expectedTitle;
    const ready = titleMatches && member && canSend;
    console.log(JSON.stringify({
      ok: ready,
      bot: { id: String(me.id), username: me.username || null },
      destination: { title: chat.title || null, title_matches: titleMatches, type: chat.type || null },
      membership: membership.status,
      can_send_messages: canSend,
      checks: ['getMe', 'getChat', 'getChatMember'],
      send_message_called: false,
    }, null, 2));
    if (!ready) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Telegram preflight failed.');
    process.exitCode = 1;
  }
}
