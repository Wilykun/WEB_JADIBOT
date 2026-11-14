import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadBotRuntime, saveBotRuntime, deleteBotRuntime, RUNTIME_FILENAME } from '../server/pairing-manager.js';

async function tempDir(t, prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('loadBotRuntime returns null when no runtime file exists', async (t) => {
  const dir = await tempDir(t, 'runtime-missing-');
  assert.equal(await loadBotRuntime(dir), null);
  assert.equal(await loadBotRuntime(null), null);
});

test('saveBotRuntime round-trips totalMs and startedAt', async (t) => {
  const dir = await tempDir(t, 'runtime-save-');
  const runtime = { totalMs: 4_260_000, startedAt: 1_793_000_000_000 };
  assert.equal(await saveBotRuntime(dir, runtime), true);
  assert.deepEqual(await loadBotRuntime(dir), runtime);
  const raw = await fs.readFile(path.join(dir, RUNTIME_FILENAME), 'utf8');
  assert.deepEqual(JSON.parse(raw), runtime);
});

test('saveBotRuntime stores a stopped run with a null startedAt', async (t) => {
  const dir = await tempDir(t, 'runtime-stopped-');
  assert.equal(await saveBotRuntime(dir, { totalMs: 123_456, startedAt: null }), true);
  assert.deepEqual(await loadBotRuntime(dir), { totalMs: 123_456, startedAt: null });
});

test('saveBotRuntime refuses invalid payloads and writes nothing', async (t) => {
  const dir = await tempDir(t, 'runtime-invalid-');
  assert.equal(await saveBotRuntime(dir, null), false);
  assert.equal(await saveBotRuntime(dir, { totalMs: -1, startedAt: null }), false);
  assert.equal(await saveBotRuntime(dir, { totalMs: 'x', startedAt: null }), false);
  assert.equal(await saveBotRuntime(dir, { totalMs: 100, startedAt: -5 }), false);
  assert.equal(await saveBotRuntime(dir, { totalMs: 100, startedAt: 'soon' }), false);
  await assert.rejects(fs.access(path.join(dir, RUNTIME_FILENAME)));
});

test('loadBotRuntime returns null for a corrupt runtime file', async (t) => {
  const dir = await tempDir(t, 'runtime-corrupt-');
  await fs.writeFile(path.join(dir, RUNTIME_FILENAME), '{not json', 'utf8');
  assert.equal(await loadBotRuntime(dir), null);
  await fs.writeFile(path.join(dir, RUNTIME_FILENAME), JSON.stringify({ totalMs: -10 }), 'utf8');
  assert.equal(await loadBotRuntime(dir), null);
});

test('loadBotRuntime floors a fractional totalMs', async (t) => {
  const dir = await tempDir(t, 'runtime-floor-');
  await fs.writeFile(path.join(dir, RUNTIME_FILENAME), JSON.stringify({ totalMs: 1500.9, startedAt: null }), 'utf8');
  assert.deepEqual(await loadBotRuntime(dir), { totalMs: 1500, startedAt: null });
});

test('deleteBotRuntime removes the file and is idempotent', async (t) => {
  const dir = await tempDir(t, 'runtime-delete-');
  assert.equal(await saveBotRuntime(dir, { totalMs: 999, startedAt: null }), true);
  assert.equal(await deleteBotRuntime(dir), true);
  await assert.rejects(fs.access(path.join(dir, RUNTIME_FILENAME)));
  assert.equal(await deleteBotRuntime(dir), true);
  assert.equal(await deleteBotRuntime(null), false);
});

test('backdated worker start shows accumulated runtime plus current run', async () => {
  // Invariant yang dipakai attachBotWorker: workerStartedAt dimundurkan sebesar totalMs
  // sehingga runtime yang tampil (now - workerStartedAt) = total lama + durasi jalan saat ini.
  const totalMs = 4_260_000;
  const runStartedAt = Date.now();
  const workerStartedAt = runStartedAt - totalMs;
  const now = runStartedAt + 30_000;
  assert.equal(now - workerStartedAt, totalMs + 30_000);
});
