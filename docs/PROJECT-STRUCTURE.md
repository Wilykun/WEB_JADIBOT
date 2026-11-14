# Struktur proyek ReadSW Console

```text
ReadSW-Console/
├── server/
│   ├── index.js           # Entry point HTTP, API, akun, dan penyimpanan profil
│   ├── pairing-manager.js # Siklus koneksi WhatsApp dan worker story/status
│   └── story-log.js       # Sanitasi metadata log; nomor dan ID story dimasking
├── public/
│   ├── index.html          # Struktur dashboard
│   ├── app.js              # UI, interaksi, dan autosave per akun
│   ├── style.css           # Gaya desktop/mobile
│   └── manus-routes.json   # Daftar route website
├── docs/
│   ├── BAILEYS-NOTES.md    # Referensi API Baileys dan batasan worker
│   └── PROJECT-STRUCTURE.md
├── data/                   # Dibuat saat runtime; jangan commit/masukkan ZIP kode
├── .env.example
├── package.json
└── README.md
```

## Data sesi WhatsApp

`data/` adalah penyimpanan runtime untuk `store.json`, `.session-secret`, dan metadata sesi panel. Default `PANEL_DATA_DIR=./data` diselesaikan relatif terhadap root proyek agar tidak tanpa sengaja memakai `/tmp`. Autentikasi Baileys aktif disimpan sebagai `DATA_AKUN/<username>/session.json`; metadata sesi login panel yang disamarkan berada di `panel-sessions.json`. Backlog story ReadSW berada terpisah di `DATA_AKUN/<username>/ReadSwReactionsw/`: `swtrack/` menyimpan event status minimum per kontak sampai kedaluwarsa 24 jam, `ceksw/swstats.json` menghitung read/reaction dengan deduplikasi, dan `users/` menyimpan metadata kontak dengan ID hash. File backlog hanya menyimpan kunci pesan dan metadata tipe/nama; tidak menyimpan isi atau media status. Semua direktori akun diberi izin privat.

ZIP source dapat menyertakan metadata `DATA_AKUN` sesuai konfigurasi paket, tetapi harus mengecualikan `DATA_AKUN/*/session.json` karena file tersebut memberi akses ke akun WhatsApp. ZIP menyediakan kode panel, bukan sesi autentikasi WhatsApp aktif.
