import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { saveSessionBackup, restoreSessionBackup, BACKUP_FILENAME } from '../server/pairing-manager.js';

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

test('saveSessionBackup refuses a missing session', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-empty-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  assert.equal(await saveSessionBackup(dir), false);
  await assert.rejects(fs.access(path.join(dir, BACKUP_FILENAME)));
});

test('saveSessionBackup refuses an unregistered session', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-unregistered-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeSession(dir, snapshotPayload('6289681008411:72@s.whatsapp.net', false));
  assert.equal(await saveSessionBackup(dir), false);
  await assert.rejects(fs.access(path.join(dir, BACKUP_FILENAME)));
});

test('saveSessionBackup refuses a session without me.id', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-nome-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const payload = snapshotPayload('6289681008411:72@s.whatsapp.net');
  delete payload.creds.me;
  await writeSession(dir, payload);
  assert.equal(await saveSessionBackup(dir), false);
  await assert.rejects(fs.access(path.join(dir, BACKUP_FILENAME)));
});

test('saveSessionBackup stores an identical copy of a registered session', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-save-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const payload = snapshotPayload('6289681008411:72@s.whatsapp.net');
  await writeSession(dir, payload);
  assert.equal(await saveSessionBackup(dir), true);
  const saved = JSON.parse(await fs.readFile(path.join(dir, BACKUP_FILENAME), 'utf8'));
  assert.deepEqual(saved, payload);
});

test('saveSessionBackup throttles repeat saves unless forced', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-throttle-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeSession(dir, snapshotPayload('6289681008411:72@s.whatsapp.net'));
  assert.equal(await saveSessionBackup(dir), true);
  assert.equal(await saveSessionBackup(dir), false);
  assert.equal(await saveSessionBackup(dir, { force: true }), true);
});

test('saveSessionBackup refuses to overwrite a good backup when the live file turns invalid', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-keepgood-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const good = snapshotPayload('6289681008411:72@s.whatsapp.net');
  await writeSession(dir, good);
  assert.equal(await saveSessionBackup(dir), true);
  await writeSession(dir, snapshotPayload('6289681008411:72@s.whatsapp.net', false));
  assert.equal(await saveSessionBackup(dir, { force: true }), false);
  const kept = JSON.parse(await fs.readFile(path.join(dir, BACKUP_FILENAME), 'utf8'));
  assert.deepEqual(kept, good);
});

test('restoreSessionBackup brings back the backup over a changed live session', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-restore-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const backedUp = snapshotPayload('6289681008411:72@s.whatsapp.net');
  await writeSession(dir, backedUp);
  assert.equal(await saveSessionBackup(dir), true);
  const changed = snapshotPayload('6289681008411:72@s.whatsapp.net');
  changed.keys = { 'pre-key': { 1: { public: 'BERUBAH' } } };
  await writeSession(dir, changed);
  assert.equal(await restoreSessionBackup(dir), true);
  const restored = JSON.parse(await fs.readFile(path.join(dir, 'session.json'), 'utf8'));
  assert.deepEqual(restored, backedUp);
});

test('restoreSessionBackup refuses a backup from a different device number', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-mismatch-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeSession(dir, snapshotPayload('6289681008411:72@s.whatsapp.net'));
  assert.equal(await saveSessionBackup(dir), true);
  await writeSession(dir, snapshotPayload('6285159438825:99@s.whatsapp.net'));
  assert.equal(await restoreSessionBackup(dir), false);
  const kept = JSON.parse(await fs.readFile(path.join(dir, 'session.json'), 'utf8'));
  assert.equal(kept.creds.me.id, '6285159438825:99@s.whatsapp.net');
});

test('restoreSessionBackup returns false when no backup exists', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-nobackup-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await writeSession(dir, snapshotPayload('6289681008411:72@s.whatsapp.net'));
  assert.equal(await restoreSessionBackup(dir), false);
});
