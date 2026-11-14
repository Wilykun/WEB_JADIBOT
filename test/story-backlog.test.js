import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStoryBacklog } from '../server/story-backlog.js';

function story(id, participant = '6281234567890@s.whatsapp.net') {
  return {
    key: { remoteJid: 'status@broadcast', id, participant, fromMe: false },
    pushName: 'Nama Kontak',
    message: { imageMessage: { caption: 'DO NOT PERSIST THIS STORY CONTENT' } },
  };
}

async function fixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'readsw-story-backlog-'));
  const backlog = createStoryBacklog({ getAccountDir: (userId) => path.join(root, userId), ...options });
  return { root, backlog, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test('stores backlog inside each account and deduplicates story IDs', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const settings = { mode: 'readonly_readsw', autoReaction: true };
  const [first, duplicate] = await Promise.all([
    f.backlog.enqueue('account-a', story('same-id'), settings),
    f.backlog.enqueue('account-a', story('same-id'), settings),
  ]);
  const otherAccount = await f.backlog.enqueue('account-b', story('same-id'), settings);

  assert.equal(first.id, 'same-id');
  assert.equal(duplicate.id, 'same-id');
  assert.equal(otherAccount.id, 'same-id');
  assert.equal((await f.backlog.listPending('account-a')).length, 1);
  assert.equal((await f.backlog.listPending('account-b')).length, 1);

  const accountFiles = await fs.readdir(path.join(f.root, 'account-a', 'ReadSwReactionsw', 'swtrack'));
  assert.equal(accountFiles.length, 1);
  assert.equal(accountFiles[0], '6281234567890.json');
  const saved = await fs.readFile(path.join(f.root, 'account-a', 'ReadSwReactionsw', 'swtrack', accountFiles[0]), 'utf8');
  assert.equal(saved.includes('DO NOT PERSIST THIS STORY CONTENT'), false);
  assert.equal(saved.includes('imageMessage'), true);
  const track = JSON.parse(saved);
  assert.equal(track['same-id'].number, '6281234567890');
  assert.equal(track['same-id'].sender, '6281234567890@s.whatsapp.net');
  assert.equal(track['same-id'].messageKey.participant, '6281234567890@s.whatsapp.net');
  const dirs = await fs.readdir(path.join(f.root, 'account-a', 'ReadSwReactionsw'));
  assert.deepEqual(dirs.sort(), ['ceksw', 'swtrack', 'users']);
  const userFiles = await fs.readdir(path.join(f.root, 'account-a', 'ReadSwReactionsw', 'users'));
  assert.deepEqual(userFiles, ['6281234567890.json']);
  const userRecord = JSON.parse(await fs.readFile(path.join(f.root, 'account-a', 'ReadSwReactionsw', 'users', userFiles[0]), 'utf8'));
  assert.equal(userRecord.number, '6281234567890');
  assert.equal(userRecord.jid, '6281234567890@s.whatsapp.net');
  assert.equal(userRecord.statusCount, 1);
});

test('read-only entries do not become reaction work; read+reaction entries retry only reaction', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const readOnly = await f.backlog.enqueue('a', story('read-only'), { mode: 'readonly', autoReaction: false });
  assert.equal(readOnly.reactionExpected, false);
  await f.backlog.update('a', readOnly, { read: true, reactionExpected: false });
  assert.equal((await f.backlog.listPending('a', { reactionEnabled: true })).length, 0);

  const readReact = await f.backlog.enqueue('a', story('read-react', '6289876543210@s.whatsapp.net'), { mode: 'readonly_readsw', autoReaction: true });
  await f.backlog.update('a', readReact, { read: true, reactionExpected: true, lastError: 'reaction_failed' });
  assert.equal((await f.backlog.listPending('a', { reactionEnabled: false })).length, 0);
  const pendingReaction = await f.backlog.listPending('a', { reactionEnabled: true });
  assert.deepEqual(pendingReaction.map((entry) => entry.id), ['read-react']);
  await f.backlog.update('a', readReact, { reacted: true, reactionExpected: false });
  assert.equal((await f.backlog.listPending('a', { reactionEnabled: true })).length, 0);
});

test('stats count read/reaction once even if outcomes are retried', async (t) => {
  const f = await fixture();
  t.after(f.cleanup);
  const entry = await f.backlog.enqueue('a', story('stats-once'), { mode: 'readonly_readsw', autoReaction: true });
  await f.backlog.recordOutcome('a', entry, { read: true, reacted: false });
  await f.backlog.recordOutcome('a', entry, { read: true, reacted: true, emoji: '💚' });
  await f.backlog.recordOutcome('a', entry, { read: true, reacted: true, emoji: '💚' });

  const data = JSON.parse(await fs.readFile(path.join(f.root, 'a', 'ReadSwReactionsw', 'ceksw', 'swstats.json'), 'utf8'));
  const row = data[entry.number];
  assert.equal(row.number, '6281234567890');
  assert.equal(row.jid, '6281234567890@s.whatsapp.net');
  assert.equal(row.reads, 1);
  assert.equal(row.reactions, 1);
  assert.equal(data._emojiStats['💚'], 1);
});

test('expired backlog entries are not replayed', async (t) => {
  let clock = Date.parse('2026-01-01T00:00:00.000Z');
  const f = await fixture({ now: () => clock, ttlMs: 60_000 });
  t.after(f.cleanup);
  await f.backlog.enqueue('a', story('expired'), { mode: 'readonly', autoReaction: false });
  clock += 60_001;
  assert.equal((await f.backlog.listPending('a')).length, 0);
});

test('full-history status older than the backlog TTL is rejected before processing', async (t) => {
  const clock = Date.parse('2026-01-01T00:00:00.000Z');
  const f = await fixture({ now: () => clock, ttlMs: 60_000 });
  t.after(f.cleanup);
  const old = story('history-too-old');
  old.messageTimestamp = Math.floor((clock - 61_000) / 1000);
  const recent = story('history-recent', '6289876543210@s.whatsapp.net');
  recent.messageTimestamp = Math.floor((clock - 30_000) / 1000);

  assert.equal(await f.backlog.enqueue('a', old, { mode: 'readonly', autoReaction: false }), null);
  const accepted = await f.backlog.enqueue('a', recent, { mode: 'readonly', autoReaction: false });
  assert.equal(Date.parse(accepted.arrivedAt), Math.floor((clock - 30_000) / 1000) * 1000);
  assert.deepEqual((await f.backlog.listPending('a')).map((entry) => entry.id), ['history-recent']);
});
