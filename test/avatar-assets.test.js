import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('profile gallery has twenty-four male and twenty-four female bundled WebP avatars under 100 KB with source attribution', async () => {
  const html = await fs.readFile(path.join(ROOT, 'public/index.html'), 'utf8');
  const ids = [...html.matchAll(/data-avatar-preset="(avatar-\d+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, 48);
  assert.equal(new Set(ids).size, 48);
  const male = [...html.matchAll(/data-avatar-gender="male"/g)];
  const female = [...html.matchAll(/data-avatar-gender="female"/g)];
  assert.equal(male.length, 24);
  assert.equal(female.length, 24);

  for (const id of ids) {
    const asset = path.join(ROOT, 'public/avatars', `${id}.webp`);
    const stat = await fs.stat(asset);
    assert.ok(stat.size > 0 && stat.size < 100 * 1024, `${id} must be a non-empty WebP below 100 KB`);
    const header = await fs.readFile(asset);
    assert.equal(header.toString('ascii', 0, 4), 'RIFF', `${id} is missing a WebP RIFF header`);
    assert.equal(header.toString('ascii', 8, 12), 'WEBP', `${id} is missing a WebP signature`);
  }

  const attribution = await fs.readFile(path.join(ROOT, 'public/avatars/ATTRIBUTION.txt'), 'utf8');
  assert.match(attribution, /CC0 1\.0 Universal/);
  assert.match(attribution, /Artbreeder_example_anime_portraits\.jpg/);
  assert.match(attribution, /Anime_Girl_GAN_generated\.jpg/);
  assert.match(attribution, /avatar-15\.webp through avatar-24\.webp/);
  assert.match(attribution, /AI-generated anime-style portraits/);
  assert.match(attribution, /Manga_Boy\.png/);
  assert.match(attribution, /Manga_school_boy\.png/);
  assert.match(attribution, /avatar-27\.webp/);
  assert.match(attribution, /avatar-34\.webp/);
  for (const id of ['avatar-25', 'avatar-26']) assert.ok(ids.includes(id), `${id} must be in the gallery`);
  for (let n = 35; n <= 48; n += 1) {
    const id = `avatar-${String(n).padStart(2, '0')}`;
    assert.ok(ids.includes(id), `${id} must be in the gallery`);
    assert.ok(attribution.includes(`${id}.webp`), `${id} must be documented in ATTRIBUTION.txt`);
  }
});
