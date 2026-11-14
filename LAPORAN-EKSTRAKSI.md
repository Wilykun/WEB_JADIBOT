# ReadSW Console — status proyek

- **Proyek aktif:** `/home/ubuntu/ReadSW-Console-extracted`; server asli menggunakan data proyek asli.
- **Web sementara:** https://3000-ip5e4all44el8x5dcou4x-11d78c2a.sg2.manus.computer/ — berhenti saat sandbox tidur.
- **Member admin:** detail status panel/WA/worker; start, restart, dan matikan worker hanya untuk WhatsApp yang sudah tertaut. Admin tidak login sebagai member atau memasangkan WA atas nama member.
- **Ban/unban:** ban mencabut sesi panel, menghentikan worker dan Online 24 Jam, serta membatalkan pairing yang belum selesai. Tautan WA aktif tidak dihapus; login berikutnya menampilkan pemberitahuan blokir.
- **Privasi:** halaman Member tidak menampilkan kode pairing, kredensial, kata sandi, atau isi percakapan.
- **Uji:** 21 test lulus, termasuk HTTP integration di server sementara: izin admin, sesi dicabut, notifikasi login, unban, dan race antar lifecycle. Tidak ada aksi WhatsApp yang dijalankan selama pengujian.

## Backup otomatis

Satu ZIP harian berbasis Asia/Jakarta memakai pola `<Hari><Tanggal>-<Bulan><Tahun>.zip`, misalnya `Rabu11-November2026.zip`, di `/home/ubuntu/ReadSW-Console-backups/`. Watcher memperbarui ZIP setelah perubahan stabil dan mengganti arsip saat tanggal WIB berganti; hanya satu ZIP keluaran dipertahankan. `node_modules` dan `package-lock.json` dikecualikan. ZIP memuat data privat—bagikan hanya kepada pihak tepercaya.

Skrip watcher: `scripts/auto-backup.py`. Setelah sandbox tidur, jalankan kembali dengan `python3 /home/ubuntu/ReadSW-Console-extracted/scripts/auto-backup.py`.
