/**
 * Алерты в Telegram о сбоях контент-конвейера.
 *
 * Требование владельца (13.08.2026): если публикация статей падает — сообщать
 * в Telegram, а не только в лог контейнера. Логи живут внутри контейнера и
 * пропадают при пересоздании, поэтому молчаливый сбой ночного батча замечали
 * только по отсутствию статей на сайте.
 *
 * Токен и чат берём из уже настроенных переменных: сначала алерт-бот GMA,
 * затем пара TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID, которую прокидывает cron.
 */
import axios from 'axios';

function creds(): { token: string; chat: string } | null {
  const token = process.env.GMA_TG_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN || '';
  const chat = process.env.GMA_TG_ALERT_CHAT || process.env.TELEGRAM_CHAT_ID || '';
  return token && chat ? { token, chat } : null;
}

/**
 * Отправляет уведомление о сбое. Никогда не бросает: алерт не должен ронять
 * то, о чём он сообщает.
 */
export async function alertTelegram(text: string): Promise<void> {
  const c = creds();
  if (!c) {
    console.warn('[Alert] Telegram не настроен (GMA_TG_BOT_TOKEN/GMA_TG_ALERT_CHAT) — только лог');
    return;
  }
  try {
    await axios.post(`https://api.telegram.org/bot${c.token}/sendMessage`, {
      chat_id: c.chat,
      text: text.slice(0, 3900),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }, { timeout: 15000, proxy: false });
  } catch (e: any) {
    console.warn('[Alert] Telegram не принял сообщение:', e?.message?.slice(0, 120));
  }
}

/** Готовый шаблон для сбоев публикации статей. */
export async function alertPublishFailure(what: string, details: string): Promise<void> {
  await alertTelegram(
    `🔴 <b>100zem: сбой публикации</b>\n${what}\n\n${details}`.slice(0, 3900),
  );
}
