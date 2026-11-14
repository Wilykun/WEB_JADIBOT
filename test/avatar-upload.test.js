import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readAvatarUpload } from '../server/avatar-upload.js';

function request(body, contentType) {
  const req = Readable.from([body]);
  req.headers = { 'content-type': contentType };
  return req;
}

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(16)]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(16)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);

test('accepts supported image signatures and returns a safe extension', async () => {
  for (const [mime, bytes, extension] of [
    ['image/png', png, 'png'],
    ['image/jpeg', jpeg, 'jpg'],
    ['image/webp', webp, 'webp'],
  ]) {
    const result = await readAvatarUpload(request(bytes, `${mime}; charset=binary`));
    assert.equal(result.mime, mime);
    assert.equal(result.extension, extension);
    assert.deepEqual(result.image, bytes);
  }
});

test('rejects unsupported types and mismatched image content', async () => {
  await assert.rejects(readAvatarUpload(request(png, 'application/octet-stream')), { status: 415 });
  await assert.rejects(readAvatarUpload(request(png, 'image/jpeg')), { status: 400 });
  await assert.rejects(readAvatarUpload(request(Buffer.from('not an image'), 'image/webp')), { status: 400 });
});

test('rejects an image over the configured upload limit', async () => {
  const req = request(Buffer.alloc(24), 'image/png');
  await assert.rejects(readAvatarUpload(req, 16), { status: 413 });
});
