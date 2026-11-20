import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.resolve(ROOT, '..', '..', 'bin');

const restartSh = await fs.readFile(path.join(BIN, 'restart-panel.sh'), 'utf8');
const watchSh = await fs.readFile(path.join(BIN, 'watch-readsw.sh'), 'utf8');
const checkSh = await fs.readFile(path.join(BIN, 'check-readsw.sh'), 'utf8');

test('restart panel mematikan panel lama dulu sebelum menyalakan yang baru', () => {
  assert.ok(restartSh.includes('pkill -f "^node server/index.js"'), 'panel lama harus dimatikan dulu');
  assert.ok(restartSh.includes(':3000'), 'port 3000 harus dicek bebas sebelum start');
  assert.ok(restartSh.includes('flock -n 9'), 'dua restart tidak boleh jalan bersamaan');
  assert.ok(restartSh.includes('PANEL HIDUP LAGI'), 'restart harus mencatat hasilnya');
});

test('watchlog dan cron recovery memakai restart-panel.sh, bukan start node langsung', () => {
  assert.ok(watchSh.includes('restart-panel.sh'), 'watchlog harus memakai restart-panel.sh');
  assert.ok(checkSh.includes('restart-panel.sh'), 'cron recovery harus memakai restart-panel.sh');
  assert.ok(!watchSh.includes('node server/index.js >>'), 'watchlog tidak boleh start node langsung lagi');
  assert.ok(!checkSh.includes('node server/index.js >>'), 'cron recovery tidak boleh start node langsung lagi');
});
