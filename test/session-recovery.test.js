import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveGoodSnapshot, restoreGoodSnapshot, GOOD_SNAPSHOT_FILENAME } from '../server/pairing-manager.js';

function snapshotPayload(meId, registered = true) {
  return {
    creds: { registered, me: { id: meId } },
    keys: { 'pre-key': { 1: { public: 'x' } } },
  };
}

async function writeSession(dir, payload) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'session.json'), JSON.stringify(payload), { mode: 0o600 });
}

test('saveGoodSnapshot refuses a missing or unregistered session', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-empty-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  assert.equal(await saveGoodSnapshot(dir), false);
  await writeSession(dir, snapshotPayload('6289681008411:72@s.whatsapp.net', false));
  assert.equal(await saveGoodSnapshot(dir), false);
  await assert.rejects(fs.access(path.join(dir, GOOD_SNAPSHOT_FILENAME)));
});

test('saveGoodSnapshot stores an identical copy of a registered session', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-save-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const payload = snapshotPayload('6289681008411:72@s.whatsapp.net');
  await writeSession(dir, payload);
  assert.equal(await saveGoodSnapshot(dir), true);
  const saved = JSON.parse(await fs.readFile(path.join(dir, GOOD_SNAPSHOT_FILENAME), 'utf8'));
  assert.deepEqual(saved, payload);
});

test('restoreGoodSnapshot brings back the healthy copy over a changed live session', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-restore-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const good = snapshotPayload('6289681008411:72@s.whatsapp.net');
  await writeSession(dir, good);
  assert.equal(await saveGoodSnapshot(dir), true);
  const corrupted = snapshotPayload('6289681008411:72@s.whatsapp.net');
  corrupted.keys = { 'pre-key': { 1: { public: 'RUSAK' } } };
  await writeSession(dir, corrupted);
  assert.equal(await restoreGoodSnapshot(dir), true);
  const restored = JSON.parse(await fs.readFile(path.join(dir, 'session.json'), 'utf8'));
  assert.deepEqual(restored, good);
});

test('restoreGoodSnapshot returns false when no healthy copy exists', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-nogood-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeSession(dir, snapshotPayload('6289681008411:72@s.whatsapp.net'));
  assert.equal(await restoreGoodSnapshot(dir), false);
});

test('restoreGoodSnapshot refuses a copy from a different device number', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-mismatch-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeSession(dir, snapshotPayload('6289681008411:72@s.whatsapp.net'));
  assert.equal(await saveGoodSnapshot(dir), true);
  await writeSession(dir, snapshotPayload('6285159438825:99@s.whatsapp.net'));
  assert.equal(await restoreGoodSnapshot(dir), false);
  const kept = JSON.parse(await fs.readFile(path.join(dir, 'session.json'), 'utf8'));
  assert.equal(kept.creds.me.id, '6285159438825:99@s.whatsapp.net');
});

test('restoreGoodSnapshot returns false for a corrupt healthy copy', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-corrupt-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeSession(dir, snapshotPayload('6289681008411:72@s.whatsapp.net'));
  await fs.writeFile(path.join(dir, GOOD_SNAPSHOT_FILENAME), '{bukan json', { mode: 0o600 });
  assert.equal(await restoreGoodSnapshot(dir), false);
});
