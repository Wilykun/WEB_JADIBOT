# Rencana ReadSW Console

## Pendekatan
Gunakan source Node.js yang diunggah sebagai aplikasi web terkelola dengan server container pada port 3000. Panel publik dilayani dari `public/`, endpoint aplikasi dan pairing dari `server/`, dan `npm start` menjadi entrypoint produksi. Secret dipindahkan ke environment terlindungi; `.env`, `data/`, `DATA_AKUN/`, dan kredensial WhatsApp tidak disimpan di source checkpoint.

## Persistence dan publikasi
Aplikasi memerlukan proses persisten untuk worker Baileys dan penyimpanan privat untuk akun, log, preferensi, serta auth session. Deployment publik harus menggunakan mode hosting persisten/volume yang sesuai; bila tidak tersedia, pairing dan sesi produksi tidak boleh diaktifkan.

## Struktur
- `public/`: UI, CSS, avatar, halaman legal, dan route manifest.
- `server/`: HTTP server, autentikasi panel, pairing Baileys, worker story, auth adapter, dan logging.
- `data/`: store lokal runtime, dibuat saat startup dan tidak dikomit.
- `DATA_AKUN/`: mirror akun dan auth/session runtime, privat dan tidak dikomit.
- `Dockerfile`: instalasi dependency dan entrypoint `npm start`.

## Desain
Gaya yang dipertahankan adalah dashboard gelap berorientasi utilitas dari source pengguna: informasi padat namun responsif, aksen hijau yang mengisyaratkan ReadSW, dan interaksi eksplisit untuk pairing/worker agar status operasional mudah dipahami.
