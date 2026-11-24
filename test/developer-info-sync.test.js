import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const appJs = await fs.readFile(path.join(ROOT, 'public', 'app.js'), 'utf8');
const indexHtml = await fs.readFile(path.join(ROOT, 'public', 'index.html'), 'utf8');
const styleCss = await fs.readFile(path.join(ROOT, 'public', 'style.css'), 'utf8');

function developerSection() {
  const section = indexHtml.match(/<section id="developer"[\s\S]*?<\/section>/);
  assert.ok(section, 'halaman #developer harus ada');
  return section[0];
}

test('panel Developer sebelum login disalin dari halaman Developer di dalam panel', () => {
  assert.match(appJs, /function syncMobileInfoDeveloperPanel\(\)/);
  assert.match(appJs, /document\.querySelector\('#developer'\)/);
  assert.match(appJs, /document\.querySelector\('\[data-mobile-info-panel="developer"\]'\)/);
  assert.match(appJs, /child\.cloneNode\(true\)/);
  assert.match(appJs, /replaceChildren\(clone\)/);
  assert.match(appJs, /syncMobileInfoDeveloperPanel\(\);/);
});

test('salinan panel tidak menduplikasi id dan referensi aria', () => {
  assert.match(appJs, /querySelectorAll\('\[id\]'\)\.forEach\(\(element\) => element\.removeAttribute\('id'\)\)/);
  assert.match(appJs, /querySelectorAll\('\[aria-labelledby\]'\)\.forEach\(\(element\) => element\.removeAttribute\('aria-labelledby'\)\)/);
  assert.match(appJs, /target\.dataset\.synced === 'true'/);
});

test('halaman Developer sumber berisi semua konten yang harus sama di kedua tempat', () => {
  const section = indexHtml.match(/<section id="developer"[\s\S]*?<\/section>/);
  assert.ok(section, 'halaman #developer harus ada');
  const source = section[0];
  for (const text of [
    'Ruang Developer',
    'Comperid Bang Wily',
    'Pengembangan panel difokuskan pada pengalaman mobile yang ringkas',
    'Kenali arah pengembangan',
    'Hubungi Developer',
    'https://wa.me/6289688206739',
    'https://t.me/Wilykun1994',
    'https://www.facebook.com/wily.kun.1/',
    'Panel yang terus dirapikan',
    'Mobile first',
    'Kontrol jelas',
    'Perbaikan bertahap',
    'Jangan kirim kata sandi, kode pairing, atau data percakapan',
  ]) assert.ok(source.includes(text), `halaman #developer harus memuat: ${text}`);
});

test('panel sebelum login tetap punya cadangan isi bila JavaScript tidak jalan', () => {
  const panel = indexHtml.match(/<section class="mobile-info-panel" data-mobile-info-panel="developer"[\s\S]*?<\/section>/);
  assert.ok(panel, 'panel Developer sebelum login harus ada');
  assert.ok(panel[0].includes('Panel ini dibuat untuk membantu pengelolaan story WhatsApp'), 'cadangan isi panel harus tetap ada');
  assert.ok(panel[0].includes('syncMobileInfoDeveloperPanel'), 'cadangan panel harus menandai penggantian saat runtime');
});

test('tidak ada salinan statis kedua dari isi halaman Developer di panel sebelum login', () => {
  const panel = indexHtml.match(/<section class="mobile-info-panel" data-mobile-info-panel="developer"[\s\S]*?<\/section>/);
  assert.ok(panel);
  assert.ok(!panel[0].includes('Ruang Developer'), 'panel sebelum login tidak boleh berisi salinan statis isi halaman Developer');
  assert.ok(!panel[0].includes('Comperid Bang Wily'), 'panel sebelum login tidak boleh berisi salinan statis isi halaman Developer');
});

test('KANAL RESMI memakai spoiler per kanal dengan kata sesuai konteks dan tombol buka', () => {
  const source = developerSection();
  assert.ok(!source.includes('developer-contact-button'), 'halaman #developer tidak boleh lagi memakai tombol tautan langsung');
  const channels = [
    { key: 'whatsapp', label: 'WhatsApp', href: 'https://wa.me/6289688206739', text: 'Jalur paling cepat — chat langsung dengan developer untuk bantuan panel, saran fitur, atau laporan kendala.' },
    { key: 'telegram', label: 'Telegram', href: 'https://t.me/Wilykun1994', text: 'Kanal &amp; pesan — ikuti kabar panel dan kirim pesan ke developer lewat Telegram.' },
    { key: 'facebook', label: 'Facebook', href: 'https://www.facebook.com/wily.kun.1/', text: 'Profil publik — lihat kabar developer dan hubungi lewat Facebook.' },
  ];
  for (const channel of channels) {
    const item = source.match(new RegExp(`<details class="developer-contact-item developer-contact-${channel.key}">[\\s\\S]*?</details>`));
    assert.ok(item, `kanal ${channel.label} harus memakai details developer-contact-item`);
    assert.ok(item[0].includes('developer-contact-summary'), `kanal ${channel.label} harus punya summary`);
    assert.ok(item[0].includes('developer-contact-chevron'), `kanal ${channel.label} harus punya chevron spoiler`);
    assert.ok(item[0].includes('developer-contact-detail'), `kanal ${channel.label} harus punya isi spoiler`);
    assert.ok(item[0].includes(`<strong>${channel.label}</strong>`), `kanal ${channel.label} harus menampilkan namanya`);
    assert.ok(item[0].includes(channel.text), `kanal ${channel.label} harus memakai kata sesuai konteks`);
    assert.ok(item[0].includes(`href="${channel.href}"`), `kanal ${channel.label} harus menaut ke ${channel.href}`);
    assert.ok(item[0].includes(`Buka ${channel.label}`), `kanal ${channel.label} harus punya tombol Buka ${channel.label}`);
  }
});

test('gaya spoiler kanal tersedia dan kartu Lapor bug tetap memakai tombol langsung', () => {
  for (const rule of [
    '.developer-contact-item{', '.developer-contact-summary{', '.developer-contact-chevron{',
    '.developer-contact-item[open] .developer-contact-chevron{', '.developer-contact-detail{', '.developer-contact-open{',
  ]) assert.ok(styleCss.includes(rule), `style.css harus memuat ${rule}`);
  const infoupdate = indexHtml.match(/<section id="infoupdate"[\s\S]*?<\/section>/);
  assert.ok(infoupdate, 'halaman #infoupdate harus ada');
  assert.ok(infoupdate[0].includes('developer-contact-button'), 'kartu Lapor bug di Info Update tetap memakai tombol tautan langsung');
  assert.ok(infoupdate[0].includes('https://wa.me/6289688206739'), 'kartu Lapor bug tetap menaut ke WhatsApp');
});
