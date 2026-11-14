# TODO ReadSW Console

- [x] Source diimpor tanpa `.env`, `data/`, atau `DATA_AKUN/` sensitif dalam arsip sumber.
- [x] Aplikasi mempertahankan panel, autentikasi, pairing, worker, log privat, dan halaman legal.
- [x] Halaman Developer tersedia bagi admin/member; halaman Member dan API admin dibatasi untuk admin.
- [x] Avatar Member dan metadata akun tersinkron; layout daftar Member responsif.
- [x] Detail monitoring member; kontrol start/restart/matikan bot memakai API admin-only; tanpa impersonasi atau pairing oleh admin.
- [x] Ban/unban, alasan opsional, pencabutan sesi panel, stop worker/Online 24 Jam, dan notifikasi blokir saat login.
- [x] Uji sintaks, 21 test unit/integrasi, dan pemeriksaan HTTP berhasil; tidak ada aksi WhatsApp yang dijalankan selama uji.
- [x] Backup otomatis satu ZIP bertanggal WIB; mengecualikan `node_modules` dan `package-lock.json`.
- [ ] Environment production terlindungi diatur melalui Secrets deployment.
- [ ] Hosting persisten/volume disetujui dan diaktifkan sebelum bot produksi dijalankan.
- [ ] Checkpoint dan publikasi final berhasil.
