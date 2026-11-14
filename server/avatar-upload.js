const FORMATS = [
  {
    mime: 'image/webp',
    extension: 'webp',
    matches: (image) => image.length >= 16 && image.toString('ascii', 0, 4) === 'RIFF' && image.toString('ascii', 8, 12) === 'WEBP',
  },
  {
    mime: 'image/png',
    extension: 'png',
    matches: (image) => image.length >= 8 && image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  },
  {
    mime: 'image/jpeg',
    extension: 'jpg',
    matches: (image) => image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff,
  },
];

function uploadError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export async function readAvatarUpload(req, maxBytes = 100 * 1024) {
  const mime = String(req.headers['content-type'] || '').toLowerCase().split(';')[0].trim();
  const format = FORMATS.find((candidate) => candidate.mime === mime);
  if (!format) {
    throw uploadError(415, 'Avatar harus PNG, JPG, atau WebP. Coba pilih ulang gambarnya.');
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw uploadError(413, 'Ukuran avatar setelah diproses maksimal 100 KB.');
    }
    chunks.push(chunk);
  }

  const image = Buffer.concat(chunks);
  if (!format.matches(image)) {
    throw uploadError(400, 'Isi file tidak cocok dengan format gambar yang dikirim. Pilih PNG, JPG, atau WebP yang valid.');
  }
  return { image, mime: format.mime, extension: format.extension };
}
