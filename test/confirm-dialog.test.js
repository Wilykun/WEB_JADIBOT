import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('confirmation dialogs use the panel-built modal, never the browser built-in confirm', async () => {
  const js = await fs.readFile(path.join(ROOT, 'public/app.js'), 'utf8');
  const css = await fs.readFile(path.join(ROOT, 'public/style.css'), 'utf8');

  assert.doesNotMatch(js, /window\.confirm\s*\(/, 'no call site may use the browser built-in confirm dialog');
  assert.doesNotMatch(js, /(?<![\w$.])confirm\s*\(/, 'no bare confirm( call may remain anywhere in the client code');
  assert.ok(js.includes('function showConfirm({ title, message, confirmLabel'), 'the panel must provide its own showConfirm dialog');
  assert.ok(js.includes('return new Promise((resolve)'), 'showConfirm must resolve asynchronously so callers can await the choice');
  assert.ok(js.includes(`setAttribute('role', 'alertdialog')`), 'the confirm dialog must expose the alertdialog role');
  assert.ok(js.includes(`if (event.key === 'Escape') close(false)`), 'Escape must cancel the confirm dialog');
  assert.ok(js.includes(`if (event.target === overlay) close(false)`), 'tapping the backdrop must cancel the confirm dialog');
  assert.ok(js.includes('cancelButton.focus()'), 'the safe Batal button must receive focus when the dialog opens');

  const calls = js.match(/showConfirm\(/g) || [];
  assert.ok(calls.length >= 7, `showConfirm must be defined once and called at every former confirm site (found ${calls.length})`);
  for (const title of ['Restore backup?', 'Hapus akun', 'Blokir @', 'Batalkan pairing code?', 'Hapus sesi WhatsApp?', 'Matikan bot dan nonaktifkan auto-start?']) {
    assert.ok(js.includes(title), `a confirm dialog must keep the title "${title}"`);
  }

  assert.match(css, /\.confirm-overlay\{[^}]*position:\s*fixed;[^}]*inset:\s*0/, 'the confirm overlay must cover the whole screen');
  assert.match(css, /\.confirm-overlay\{[^}]*z-index:\s*60/, 'the confirm overlay must sit above the drawer and the topbar');
  assert.match(css, /\.confirm-dialog\{[^}]*width:\s*min\(420px,100%\)/, 'the confirm dialog must fit the mobile screen');
  assert.match(css, /\.confirm-actions\{[^}]*display:\s*flex/, 'the confirm buttons must sit side by side');
  assert.match(css, /\.confirm-actions button\{[^}]*flex:\s*1/, 'the confirm buttons must share the row so both are easy to tap');
  assert.match(css, /@media\(max-width:560px\)\{\.confirm-overlay\{[^}]*padding:\s*12px\}\.confirm-dialog\{[^}]*padding:\s*16px/, 'the confirm dialog must shrink its padding on mobile');
});
