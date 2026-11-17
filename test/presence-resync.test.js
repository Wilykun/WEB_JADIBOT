import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appJs = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

function sendPresenceHeartbeatBody() {
  const match = appJs.match(/async function sendPresenceHeartbeat\(\) \{([\s\S]*?)\n\}/);
  return match ? match[1] : '';
}

test('presence resync: heartbeat yang berhasil langsung memuat ulang daftar member', () => {
  const body = sendPresenceHeartbeatBody();
  assert.match(body, /await api\('\/api\/me\/heartbeat', \{ method: 'POST', body: '\{\}' \}\);/);
  assert.match(body, /void loadAdminUsers\(\);/);
});

test('presence resync: kembali ke tab atau fokus jendela langsung sinkron ulang', () => {
  assert.match(appJs, /function resyncPresenceOnReturn\(\) \{/);
  assert.match(appJs, /document\.addEventListener\('visibilitychange', \(\) => \{\n  if \(document\.visibilityState === 'visible'\) resyncPresenceOnReturn\(\);\n\}\);/);
  assert.match(appJs, /window\.addEventListener\('focus', resyncPresenceOnReturn\);/);
  const resync = appJs.match(/function resyncPresenceOnReturn\(\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(resync, /void sendPresenceHeartbeat\(\);/);
});
