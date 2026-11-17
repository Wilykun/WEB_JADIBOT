// Aturan profil bot default saat WhatsApp pertama kali tertaut: Read Only +
// ReadSW aktif dan Online 24 Jam menyala. Profil yang sudah ada tidak pernah
// ditimpa, jadi pilihan member setelahnya tetap dihormati.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultBotRecord } from '../server/default-bot.js';

const storySettings = { autoReaction: true, delayMinSeconds: 1, delayMaxSeconds: 20, randomDelay: true, emojiPoolVersion: 2, emojiOptions: ['💚'], emojiPool: ['💚'] };

test('member tanpa profil mendapat profil default Read Only + ReadSW dan Online 24 Jam', () => {
  const bots = [];
  const record = createDefaultBotRecord(bots, 'user-1', storySettings, '2026-11-17T14:30:00.000Z');
  assert.ok(record, 'profil default harus dibuat');
  assert.equal(record.userId, 'user-1');
  assert.equal(record.mode, 'readonly_readsw');
  assert.equal(record.online24, true);
  assert.equal(record.autoStart, true);
  assert.equal(record.label, 'Bot saya');
  assert.equal(record.runnerStatus, 'not_connected');
  assert.equal(record.createdAt, '2026-11-17T14:30:00.000Z');
  assert.equal(record.updatedAt, '2026-11-17T14:30:00.000Z');
  assert.deepEqual(record.storySettings, storySettings);
  assert.equal(bots.length, 1);
  assert.equal(bots[0], record);
});

test('member yang sudah punya profil tidak dibuatkan profil baru', () => {
  const existing = { id: 'bot-1', userId: 'user-1', mode: 'readonly', online24: false, autoStart: false };
  const bots = [existing];
  const record = createDefaultBotRecord(bots, 'user-1', storySettings);
  assert.equal(record, null, 'profil yang sudah ada tidak boleh ditimpa');
  assert.equal(bots.length, 1);
  assert.equal(bots[0], existing);
});

test('profil member lain tidak menghalangi pembuatan profil default', () => {
  const bots = [{ id: 'bot-9', userId: 'user-9', mode: 'readonly_readsw', online24: true, autoStart: true }];
  const record = createDefaultBotRecord(bots, 'user-1', storySettings);
  assert.ok(record, 'profil untuk member lain harus tetap dibuat');
  assert.equal(bots.length, 2);
});
