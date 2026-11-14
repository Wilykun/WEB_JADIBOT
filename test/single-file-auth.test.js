import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BufferJSON } from '@whiskeysockets/baileys';
import { useSingleFileAuthState } from '../server/single-file-auth.js';

async function withTempDir(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'readsw-auth-test-'));
  try { await fn(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}

test('persists and restores credentials and Signal keys in one session.json', async () => {
  await withTempDir(async (root) => {
    const state = await useSingleFileAuthState(root);
    state.state.creds.registered = true;
    state.state.creds.testBuffer = Buffer.from([1, 2, 3]);
    await state.state.keys.set({ session: { 'peer.0': { key: Buffer.from([4, 5, 6]), counter: 7 } } });
    await state.saveCreds();

    const file = path.join(root, 'session.json');
    const stat = await fs.stat(file);
    assert.equal(stat.mode & 0o777, 0o600);
    const restored = await useSingleFileAuthState(root);
    assert.equal(restored.state.creds.registered, true);
    assert.deepEqual(restored.state.creds.testBuffer, Buffer.from([1, 2, 3]));
    const keys = await restored.state.keys.get('session', ['peer.0']);
    assert.deepEqual(keys['peer.0'].key, Buffer.from([4, 5, 6]));
    assert.equal(keys['peer.0'].counter, 7);
  });
});

test('migrates existing multi-file credentials and keys before removing legacy files', async () => {
  await withTempDir(async (root) => {
    const legacyCreds = { registered: true, me: { id: '628000@s.whatsapp.net' } };
    const legacyKey = { key: { type: 'Buffer', data: [9, 8, 7] }, counter: 3 };
    await fs.writeFile(path.join(root, 'creds.json'), JSON.stringify(legacyCreds));
    await fs.writeFile(path.join(root, 'session-peer.0.json'), JSON.stringify(legacyKey, BufferJSON.replacer));

    const migrated = await useSingleFileAuthState(root);
    assert.equal(migrated.state.creds.registered, true);
    const keys = await migrated.state.keys.get('session', ['peer.0']);
    assert.deepEqual(keys['peer.0'].key, Buffer.from([9, 8, 7]));
    assert.equal((await fs.readdir(root)).includes('session.json'), true);
    assert.equal((await fs.readdir(root)).includes('creds.json'), false);
    assert.equal((await fs.readdir(root)).includes('session-peer.0.json'), false);

    const restored = await useSingleFileAuthState(root);
    const restoredKeys = await restored.state.keys.get('session', ['peer.0']);
    assert.deepEqual(restoredKeys['peer.0'].key, Buffer.from([9, 8, 7]));
  });
});
