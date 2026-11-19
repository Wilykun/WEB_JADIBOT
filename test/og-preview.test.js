import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const infoUpdates = JSON.parse(readFileSync(path.join(root, 'public', 'info-updates.json'), 'utf8'));

function ogProperty(property) {
  const match = html.match(new RegExp(`<meta property="${property}" content="([^"]+)"`));
  // Atribut HTML memakai &amp; untuk &, kembalikan ke & sebelum dibandingkan.
  return match ? match[1].replace(/&amp;/g, '&') : null;
}

test('halaman utama memakai tag Open Graph dan Twitter Card untuk pratinjau tautan', () => {
  assert.equal(ogProperty('og:title'), 'ReactionSw — Panel Akun & Preferensi Bot ReadSW');
  assert.match(ogProperty('og:description') || '', /Panel akun dan preferensi bot ReadSW/);
  assert.equal(ogProperty('og:type'), 'website');
  const ogUrl = ogProperty('og:url');
  assert.ok(ogUrl && ogUrl.startsWith('https://') && ogUrl.endsWith('/'), 'og:url harus alamat absolut panel');
  const ogImage = ogProperty('og:image');
  assert.ok(ogImage && ogImage.startsWith('https://') && ogImage.endsWith('/og-image.png'), 'og:image harus alamat absolut ke gambar pratinjau');
  // Gambar pratinjau harus satu origin dengan alamat panel, kalau tidak
  // WhatsApp tidak bisa memuatnya saat tautan dibagikan.
  assert.equal(new URL(ogImage).origin, new URL(ogUrl).origin, 'og:image harus satu origin dengan og:url');
  assert.equal(ogProperty('og:image:width'), '1200');
  assert.equal(ogProperty('og:image:height'), '630');
  assert.ok(ogProperty('og:image:alt'), 'og:image:alt harus ada');
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/, 'Twitter Card harus summary_large_image supaya gambarnya besar');
  assert.match(html, /<meta name="twitter:image" content="https:\/\/[^"]+\/og-image\.png">/, 'twitter:image harus menunjuk gambar pratinjau yang sama');
});

test('gambar pratinjau og-image.png ada dan berukuran 1200x630', () => {
  const imagePath = path.join(root, 'public', 'og-image.png');
  assert.ok(existsSync(imagePath), 'public/og-image.png harus ada');
  const buffer = readFileSync(imagePath);
  // Tanda tangan PNG + lebar/tinggi dari chunk IHDR.
  assert.deepEqual([...buffer.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'file harus PNG yang valid');
  assert.equal(buffer.readUInt32BE(16), 1200, 'lebar gambar harus 1200');
  assert.equal(buffer.readUInt32BE(20), 630, 'tinggi gambar harus 630');
  assert.ok(buffer.length > 50_000, 'gambar tidak boleh kosong atau terlalu kecil');
});

test('server menyajikan /og-image.png sebagai image/png (bukan 404)', { timeout: 30_000 }, async () => {
  // Server hanya menyajikan file dari daftar aset eksplisit — gambar baru
  // wajib didaftarkan di sana, kalau tidak WhatsApp tidak bisa memuatnya
  // walau tag og:image-nya sudah benar. Cek langsung ke server yang jalan,
  // bukan cuma ke teks sumber.
  const { spawn } = await import('node:child_process');
  const { mkdtemp, mkdir, cp, symlink, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { randomBytes } = await import('node:crypto');
  const temp = await mkdtemp(path.join(tmpdir(), 'readsw-og-image-test-'));
  const project = path.join(temp, 'project');
  const dataDir = path.join(project, 'runtime-data');
  let child;
  try {
    await mkdir(project, { recursive: true });
    await cp(path.join(root, 'server'), path.join(project, 'server'), { recursive: true });
    await cp(path.join(root, 'public'), path.join(project, 'public'), { recursive: true });
    await cp(path.join(root, 'package.json'), path.join(project, 'package.json'));
    await symlink(path.join(root, 'node_modules'), path.join(project, 'node_modules'), 'dir');
    await mkdir(dataDir, { recursive: true });
    await writeFile(path.join(dataDir, 'store.json'), JSON.stringify({
      users: [], pendingRegistrations: [], bots: [], sessions: [], pairingLogs: [], loginHistory: [],
    }));
    const port = 31000 + Math.floor(Math.random() * 1000);
    const base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [path.join(project, 'server/index.js')], {
      cwd: project,
      env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PANEL_DATA_DIR: 'runtime-data', SESSION_SECRET: randomBytes(48).toString('base64url'), NODE_ENV: 'test' },
      stdio: 'ignore',
    });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`fixture server exited with code ${child.exitCode}`);
      try {
        const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) { ready = true; break; }
      } catch { /* Tunggu server fixture sebentar. */ }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, 'isolated fixture server should start');
    const image = await fetch(`${base}/og-image.png`);
    assert.equal(image.status, 200, 'og-image.png harus 200, bukan 404');
    assert.match(image.headers.get('content-type') || '', /image\/png/, 'og-image.png harus disajikan sebagai image/png');
    const bytes = Buffer.from(await image.arrayBuffer());
    assert.ok(bytes.length > 50_000, 'isi gambar harus utuh');
    assert.equal(bytes.readUInt32BE(16), 1200, 'lebar gambar yang disajikan harus 1200');
    assert.equal(bytes.readUInt32BE(20), 630, 'tinggi gambar yang disajikan harus 630');
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    await rm(temp, { recursive: true, force: true });
  }
});

test('entri Info Update pratinjau tautan bergambar tetap ada di posisi kedua puluh', () => {
  const entry = infoUpdates.updates.find((item) => item.title === 'Tautan panel kini menampilkan pratinjau bergambar saat dibagikan');
  assert.ok(entry, 'entri pratinjau tautan harus tetap ada');
  assert.equal(infoUpdates.updates.indexOf(entry), 19, 'entri pratinjau tautan kini di posisi kedua puluh');
  assert.equal(entry.tag, 'Tampilan');
  assert.match(entry.description, /thumbnail 1200×630/);
  assert.ok(html.includes('data-tag="tampilan"') && html.includes('Tautan panel kini menampilkan pratinjau bergambar saat dibagikan'), 'fallback HTML Info Update harus memuat entri pratinjau tautan');
});
