import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const serverJs = await fs.readFile(path.join(ROOT, 'server', 'index.js'), 'utf8');
const appJs = await fs.readFile(path.join(ROOT, 'public', 'app.js'), 'utf8');

test('badge member: penanda akun terbaru disimpan per akun di foldernya sendiri', () => {
  assert.match(serverJs, /const MEMBER_LIST_SEEN_FILE = 'member-list-seen\.json';/);
  assert.match(serverJs, /async function readMemberListSeen\(user\)/);
  assert.match(serverJs, /async function writeMemberListSeen\(user, seen\)/);
  assert.match(serverJs, /canonicalAccountFolder\(user\)/);
  assert.match(serverJs, /if \(current && current\.createdAt === seen\.createdAt && current\.username === seen\.username\) return current;/);
});

test('badge member: endpoint baca dan simpan penanda tersedia dengan batas laju', () => {
  assert.match(serverJs, /if \(route === 'GET \/api\/member-list\/seen'\)/);
  assert.match(serverJs, /if \(route === 'POST \/api\/member-list\/seen'\)/);
  assert.match(serverJs, /allowRateLimit\(`member-list-seen:\$\{user\.id\}`, 30, 60 \* 1000\)/);
  assert.match(serverJs, /Number\.isNaN\(Date\.parse\(createdAt\)\)/);
  assert.match(serverJs, /Penanda daftar member tidak lengkap\./);
});

test('badge member: hitungan memakai akun terbaru dulu dan penanda terakhir dilihat', () => {
  assert.match(appJs, /function countNewMembers\(users, seen\)/);
  assert.match(appJs, /if \(!seen \|\| !seen\.createdAt \|\| Number\.isNaN\(Date\.parse\(seen\.createdAt\)\)\) return users\.length;/);
  assert.match(appJs, /return Number\.isFinite\(createdAt\) && createdAt > seenAt;/);
});

test('badge member: angka tampil sebagai pil hijau yang sama di menu Member', () => {
  assert.match(appJs, /function renderMemberBadge\(count\)/);
  assert.match(appJs, /document\.querySelector\('#admin-nav'\)/);
  assert.match(appJs, /badge\.className = 'nav-badge';/);
  assert.match(appJs, /badge\.textContent = count > 99 \? '99\+' : String\(count\);/);
  assert.match(appJs, /`\$\{count\} akun baru belum dilihat`/);
});

test('badge member: muat ulang memakai daftar member dan penanda milik sendiri', () => {
  assert.match(appJs, /async function refreshMemberBadge\(\)/);
  assert.match(appJs, /fetch\('\/api\/members', \{ credentials: 'same-origin' \}\)/);
  assert.match(appJs, /fetch\('\/api\/member-list\/seen', \{ credentials: 'same-origin' \}\)/);
  assert.match(appJs, /memberListSeenLoaded = true;/);
  assert.match(appJs, /renderMemberBadge\(countNewMembers\(users, seen\)\);/);
});

test('badge member: buka halaman Member menandai akun terbaru lalu menghilangkan badge', () => {
  assert.match(appJs, /async function markMemberListSeen\(users\)/);
  assert.match(appJs, /\.sort\(\(a, b\) => Date\.parse\(b\.createdAt\) - Date\.parse\(a\.createdAt\)\)\[0\];/);
  assert.match(appJs, /body: JSON\.stringify\(\{ createdAt: newest\.createdAt, username: newest\.username \}\)/);
  assert.match(appJs, /if \(page === 'admin'\) \{\n    if \(previousPage !== null\) void markMemberListSeen\(\);\n  \} else \{\n    void refreshMemberBadge\(\);\n  \}/);
});

test('badge member: mendarat otomatis di Member setelah login tidak memajukan penanda', () => {
  assert.match(appJs, /const previousPage = activeWorkspacePage;\n  activeWorkspacePage = page;/);
  assert.match(appJs, /Penanda Member hanya maju saat halaman Member dibuka dengan sengaja/);
  assert.doesNotMatch(appJs, /if \(page === 'admin'\) \{\n    void markMemberListSeen\(\);\n  \}/);
});

test('badge member: dimuat setelah login dan diperbarui realtime dari daftar yang sama', () => {
  assert.match(appJs, /void refreshInfoUpdateBadge\(\);\n  startInfoUpdateNoticePolling\(\);\n  void refreshMemberBadge\(\);/);
  assert.match(appJs, /if \(memberListSeenLoaded\) renderMemberBadge\(countNewMembers\(users, memberListSeen\)\);/);
  assert.doesNotMatch(appJs, /if \(activeWorkspacePage === 'admin'\) void markMemberListSeen\(users\);/);
});
