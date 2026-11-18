// Pengaturan bot Telegram untuk backup: token + chat ID diperiksa langsung
// ke api.telegram.org (getMe lalu getChat) sebelum disimpan, supaya yang
// tersimpan sudah terbukti bisa dipakai kirim. Fungsi di sini murni agar
// aturannya bisa dites tanpa bot sungguhan: fetch dan alamat API bisa disuntik.
import fs from 'node:fs/promises';

export const TELEGRAM_API_BASE = 'https://api.telegram.org';
export const TELEGRAM_TOKEN_FORMAT = /^\d{5,}:[A-Za-z0-9_-]{20,}$/;
export const TELEGRAM_CHAT_ID_FORMAT = /^-?\d{5,}$/;

export function isTelegramBotTokenFormat(token) {
  return TELEGRAM_TOKEN_FORMAT.test(String(token || '').trim());
}

export function isTelegramChatIdFormat(chatId) {
  return TELEGRAM_CHAT_ID_FORMAT.test(String(chatId || '').trim());
}

export async function validateTelegramConfig(botToken, chatId, fetchImpl = fetch, apiBase = TELEGRAM_API_BASE) {
  const token = String(botToken || '').trim();
  const chat = String(chatId || '').trim();
  const result = { tokenValid: false, tokenError: null, chatValid: false, chatError: null, botUsername: null };
  if (!isTelegramBotTokenFormat(token)) {
    result.tokenError = 'Format token tidak valid. Token bot bentuknya angka, titik dua, lalu kode dari @BotFather.';
    return result;
  }
  if (!isTelegramChatIdFormat(chat)) {
    result.chatError = 'Format chat ID tidak valid. Chat ID hanya angka (boleh diawali tanda minus).';
  }
  let me;
  try {
    const response = await fetchImpl(`${apiBase}/bot${token}/getMe`, { signal: AbortSignal.timeout(15_000) });
    me = await response.json().catch(() => ({}));
    if (!response.ok || !me.ok) {
      result.tokenError = response.status === 401 || /unauthorized/i.test(String(me?.description || ''))
        ? 'Token tidak valid. Periksa lagi token dari @BotFather.'
        : 'Token tidak dapat diperiksa. Coba lagi nanti.';
      return result;
    }
  } catch {
    result.tokenError = 'Tidak dapat menghubungi Telegram. Periksa koneksi lalu coba lagi.';
    return result;
  }
  result.tokenValid = true;
  result.botUsername = typeof me?.result?.username === 'string' ? me.result.username : null;
  if (result.chatError) return result;
  try {
    const response = await fetchImpl(`${apiBase}/bot${token}/getChat?chat_id=${encodeURIComponent(chat)}`, { signal: AbortSignal.timeout(15_000) });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.ok) {
      result.chatValid = true;
      return result;
    }
    const reason = String(body?.description || '');
    if (/chat not found/i.test(reason)) result.chatError = 'Chat tidak ditemukan. Pastikan chat ID benar dan bot sudah di-/start di Telegram.';
    else if (/blocked/i.test(reason)) result.chatError = 'Bot diblokir di Telegram. Buka blokirnya dulu, lalu coba lagi.';
    else if (/forbidden/i.test(reason)) result.chatError = 'Bot tidak bisa mengirim ke chat ini. Pastikan bot sudah di-/start.';
    else result.chatError = reason ? `Telegram menolak chat ini: ${reason}` : 'Chat ini tidak dapat dipakai. Periksa lagi chat ID-nya.';
  } catch {
    result.chatError = 'Tidak dapat menghubungi Telegram untuk memeriksa chat. Token sudah tersimpan; coba periksa chat lagi nanti.';
  }
  return result;
}

export async function readStoredTelegramConfig(file) {
  const empty = { botToken: '', chatId: '', botUsername: null, chatValid: false, validatedAt: null };
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
    return {
      botToken: String(parsed?.botToken || '').trim(),
      chatId: String(parsed?.chatId || '').trim(),
      botUsername: typeof parsed?.botUsername === 'string' ? parsed.botUsername : null,
      chatValid: parsed?.chatValid === true,
      validatedAt: typeof parsed?.validatedAt === 'string' ? parsed.validatedAt : null,
    };
  } catch {
    return empty;
  }
}
