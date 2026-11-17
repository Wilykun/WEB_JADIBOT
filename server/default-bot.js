// Profil bot default yang dibuat otomatis saat WhatsApp pertama kali tertaut:
// mode Read Only + ReadSW aktif dan Online 24 Jam menyala, worker langsung jalan.
// Fungsi ini murni agar aturannya bisa dites tanpa harus menautkan WhatsApp sungguhan.
import { randomUUID } from 'node:crypto';

export function createDefaultBotRecord(bots, userId, storySettings, now = new Date().toISOString()) {
  const list = bots || [];
  if (list.some((item) => item.userId === userId)) return null;
  const record = {
    id: randomUUID(),
    userId,
    label: 'Bot saya',
    mode: 'readonly_readsw',
    storySettings,
    online24: true,
    autoStart: true,
    runnerStatus: 'not_connected',
    createdAt: now,
    updatedAt: now,
  };
  list.push(record);
  return record;
}
