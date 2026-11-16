import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

function navChildren() {
  const nav = html.match(/<nav class="side-nav"[^>]*>([\s\S]*?)<\/nav>/);
  assert.ok(nav, 'harus ada <nav class="side-nav">');
  const items = [];
  const re = /<(?:a|span)[^>]*>/g;
  let m;
  while ((m = re.exec(nav[1])) !== null) {
    const tag = m[0];
    if (tag.includes('side-nav-label')) items.push({ kind: 'label', text: nav[1].slice(re.lastIndex, nav[1].indexOf('</span>', re.lastIndex)).trim() });
    else if (tag.includes('side-nav-divider')) items.push({ kind: 'divider' });
    else if (tag.startsWith('<a ')) items.push({ kind: 'link', href: tag.match(/href="#([^"]+)"/)?.[1] || '' });
  }
  return items;
}

test('menu sidebar dikelompokkan jadi 4 kategori dengan label dan garis pemisah', () => {
  const items = navChildren();
  const labels = items.filter((i) => i.kind === 'label').map((i) => i.text);
  assert.deepEqual(labels, ['Utama', 'Bot', 'Info', 'Admin'], `label kategori harus Utama, Bot, Info, Admin — dapat: ${labels.join(', ')}`);
  assert.equal(items.filter((i) => i.kind === 'divider').length, 3, 'harus ada 3 garis pemisah (di antara 4 kategori)');
  const groups = [];
  let current = [];
  for (const item of items) {
    if (item.kind === 'label' || item.kind === 'divider') {
      if (current.length) groups.push(current);
      current = [];
    } else current.push(item.href);
  }
  if (current.length) groups.push(current);
  assert.deepEqual(groups, [
    ['dashboard', 'profile'],
    ['mode', 'pairing', 'activity'],
    ['developer', 'infoupdate', 'server', 'bots', 'admin'],
    ['backup'],
  ], `isi tiap kategori harus sesuai — dapat: ${JSON.stringify(groups)}`);
});

test('label dan garis pemisah disembunyikan dari pembaca layar (hanya visual)', () => {
  const nav = html.match(/<nav class="side-nav"[^>]*>([\s\S]*?)<\/nav>/)[1];
  for (const m of nav.matchAll(/<span class="side-nav-(?:label|divider)"[^>]*>/g)) {
    assert.match(m[0], /aria-hidden="true"/, `elemen pemisah/label harus aria-hidden — ${m[0]}`);
  }
});

test('semua kait gating menu tetap ada setelah pengelompokan ulang', () => {
  for (const id of ['admin-nav', 'backup-nav', 'pairing-nav', 'private-log-nav', 'developer-nav']) {
    assert.ok(html.includes(`id="${id}"`), `nav item #${id} harus tetap ada`);
  }
  assert.ok(html.includes('id="admin-nav" class="nav-item hidden"'), 'nav Member tetap hidden secara default');
  assert.ok(html.includes('id="backup-nav" class="nav-item hidden"'), 'nav Backup tetap hidden secara default (baru ditampilkan saat login)');
  assert.ok(html.includes('id="backup-nav" class="nav-item hidden" href="#backup"'), 'nav Backup tetap menunjuk ke #backup');
});

test('item Member kini berada di grup Info, bukan lagi di grup Admin', () => {
  const items = navChildren();
  const adminIdx = items.findIndex((i) => i.kind === 'link' && i.href === 'admin');
  const backupIdx = items.findIndex((i) => i.kind === 'link' && i.href === 'backup');
  const adminLabelIdx = items.findIndex((i) => i.kind === 'label' && i.text === 'Admin');
  assert.ok(adminIdx > -1 && backupIdx > -1 && adminLabelIdx > -1, 'Member, Backup, dan label Admin harus ada');
  assert.ok(adminIdx < adminLabelIdx, 'Member harus berada sebelum label Admin (di grup Info), bukan di dalam grup Admin');
  assert.ok(backupIdx > adminLabelIdx, 'Backup harus berada setelah label Admin (satu-satunya isi grup Admin)');
});

test('gaya label dan garis pemisah ada untuk desktop, rel tertutup, dan tema terang', () => {
  assert.match(css, /\.side-nav-label\{[^}]*font-size:\s*9px/, 'label kategori harus kecil (9px) seperti label WORKSPACE');
  assert.match(css, /\.side-nav-label\{[^}]*text-transform:\s*uppercase/, 'label kategori harus huruf kapital');
  assert.match(css, /\.side-nav-divider\{[^}]*height:\s*1px/, 'garis pemisah harus setipis 1px');
  assert.match(css, /\.side-nav-divider\{[^}]*background:\s*rgba\(191,230,208/, 'garis pemisah harus garis hijau redup');
  assert.match(css, /\.sidebar:not\(\.is-open\) \.side-nav-label\{display:\s*none\}/, 'di rel ikon tertutup (mobile), label kategori harus disembunyikan');
  assert.match(css, /\.sidebar:not\(\.is-open\) \.side-nav-divider\{[^}]*width:\s*24px/, 'di rel ikon tertutup, garis pemisah harus jadi garis pendek di tengah');
  assert.match(css, /html\[data-theme="light"\] \.side-nav-label\{/, 'label kategori harus punya gaya tema terang');
  assert.match(css, /html\[data-theme="light"\] \.side-nav-divider\{/, 'garis pemisah harus punya gaya tema terang');
});
