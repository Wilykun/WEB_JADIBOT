import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const footerJs = fs.readFileSync(new URL('../public/footer.js', import.meta.url), 'utf8');

test('footer realtime: angka Online/Stalker/Kunjungan diperbarui berkala tanpa muat ulang', () => {
  assert.match(footerJs, /window\.setInterval\(refreshPresence, 10000\);/);
  assert.match(footerJs, /window\.setInterval\(sendVisitorHeartbeat, 20000\);/);
  assert.match(footerJs, /fetch\('\/api\/public\/live-stats', \{ credentials: 'same-origin', cache: 'no-store' \}\)/);
  assert.match(footerJs, /document\.querySelectorAll\('\[data-live-online\]'\)\.forEach/);
  assert.match(footerJs, /document\.querySelectorAll\('\[data-live-stalker\]'\)\.forEach/);
  assert.match(footerJs, /document\.querySelectorAll\('\[data-live-visits\]'\)\.forEach/);
});

test('footer realtime: saat tab kembali dibuka, angka langsung diperbarui tanpa menunggu interval', () => {
  assert.match(footerJs, /document\.addEventListener\('visibilitychange', \(\) => \{\n    if \(document\.visibilityState === 'visible'\) void refreshPresence\(\);\n  \}\);/);
});
