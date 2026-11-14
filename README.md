<p align="center">
  <img src="assets/elin-chan.jpg" width="320" alt="Elin Chan — Penyihir Abu">
</p>

<h1 align="center">ReactionSw — ReadSW Console</h1>

<p align="center">
  Panel web buat baca story WhatsApp otomatis + kirim reaksi.<br>
  Tiga mode: <b>Read Only</b> · <b>ReadSW + ReactionSW</b> · <b>Online 24 Jam</b>
</p>

<p align="center">
  <a href="https://readsw.24h.sh/"><img src="https://img.shields.io/badge/Panel_Live-readsw.24h.sh-00C853?style=for-the-badge&logo=google-chrome&logoColor=white" alt="Panel Live"></a>
  <a href="https://app.buddy.works/ukosamasomoni9140/-/create-project"><img src="https://img.shields.io/badge/Run_on_Buddy-FF6B35?style=for-the-badge&logo=rocket&logoColor=white" alt="Run on Buddy"></a>
</p>

<p align="center">
  <a href="https://wa.me/6289688206739"><img src="https://img.shields.io/badge/WhatsApp-25D366?style=for-the-badge&logo=whatsapp&logoColor=white" alt="WhatsApp"></a>
  <a href="https://t.me/Wilykun1994"><img src="https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram"></a>
  <a href="https://facebook.com/wily.kun.1"><img src="https://img.shields.io/badge/Facebook-1877F2?style=for-the-badge&logo=facebook&logoColor=white" alt="Facebook"></a>
</p>

---

## ✨ Yang Baru — Sabtu, 14 Nov 2026

- **15.10 WIB — Detail member 2 kolom di mobile.** Item detail kini berdampingan dua kolom di HP (Email + Status, WhatsApp + Nomor, dst) — pas dengan ukuran layar, tidak lagi satu baris penuh ke bawah.
- **15.02 WIB — Kartu Fitur Akun berdampingan di mobile.** Tiga kartu fitur (ReadSW, ReactionSW, Online 24 Jam) kini tampil berdampingan tiga kolom di HP, bukan lagi menumpuk ke bawah.
- **14.54 WIB — Daftar Info Update kini realtime.** Daftar pembaruan kini dibaca langsung dari file — entri baru langsung tampil di halaman tanpa deploy ulang.
- **14.00 WIB — Chip Mode aktif di daftar member.** Setiap kartu member kini menampilkan mode bot yang aktif, tepat di antara chip Bot WhatsApp dan Runtime bot.
- **13.34 WIB — Daftar member diurutkan ikut runtime bot.** Member yang baru jalan atau baru restart di atas, runtime terlama di bawah, dan yang botnya tidak berjalan di paling bawah. Judul seksi berubah jadi “Member”.
- **12.28 WIB — Detail member kini lengkap.** Detail member menampilkan email yang disensor (contoh bang****@gmail.com) dan nomor tersamarkan, bukan lagi “—” atau “Belum aktif”.
- **12.19 WIB — Menu Fitur Bot selalu tampil.** Member yang WhatsApp-nya belum tertaut tetap bisa membuka Fitur Bot dan mengatur mode dulu; worker berjalan otomatis setelah akun tertaut.
- **12.03 WIB — Nomor tersamarkan format baru.** Nomor tampil seperti 62896****8411 — akhiran selalu 4 digit — dan diperbarui otomatis begitu WhatsApp tersambung.

Pembaruan lengkap + jam live ada di halaman **Info Update** di panel (bisa dibuka admin maupun member).

---

## 🚀 Jalankan di Buddy — pindah akun tinggal klik

Kredit trial habis / mau ganti akun? Tinggal klik tombol **Run on Buddy** di atas:

1. Klik tombol → login Buddy (atau daftar akun baru — gratis).
2. Pilih repo **Wilykun/WEB_JADIBOT** → project + pipeline terbentuk otomatis dari `.buddy/buddy.yml`.
3. Buka Sandbox → jalankan `npm start` → panel live di link publik Buddy (mis. `readsw.24h.sh` — atur domain di pengaturan Sandbox).

Tidak ada yang perlu diedit manual — pipeline, mode, dan data akun ikut dari repo.

## 💻 Jalankan Lokal

Persyaratan: Node.js 20+.

```bash
npm install
npm start
```

Buka `http://localhost:3000`. `npm start` menjalankan `start-ptero.sh` — cek Node.js 20+, pasang dependensi bila `node_modules` belum ada, lalu ulang server setelah crash. Untuk pengembangan: `npm run dev`. Cek sintaks: `npm run check`.

## 🎛️ Fitur

- **Pendaftaran + login** — username, email, kata sandi; akun dapat ID acak; sesi pairing per akun di `DATA_AKUN/<username>/`.
- **3 mode bot** — Read Only (cuma tandai dibaca), ReadSW + ReactionSW (tandai + kirim reaksi sesuai preferensi), Online 24 Jam (preferensi presence).
- **Pairing code Baileys** — masukkan nomor (digit + kode negara), kode muncul di panel dan dimasukkan di WhatsApp: Perangkat Tertaut → Tautkan Perangkat → Tautkan dengan nomor telepon. Kode cuma tampil ke sesi pemilik, maksimal 3 menit, tidak masuk log.
- **Auto-start** — akun baru tanpa preferensi tersimpan langsung jalan mode ReadSW + ReactionSW setelah pairing sukses (emoji 💚, reaksi aktif, jeda acak 1–20 dtk). Preferensi tersimpan tidak ditimpa.
- **Info Update realtime** — halaman pembaruan dibaca dari `public/info-updates.json`, refresh tiap 60 dtk; entri baru tinggal tambah ke file itu, terbaru di paling atas.
- **Backup & pemulihan (admin)** — unduh backup terenkripsi (AES-256-GCM) dari panel; simpan ZIP + kata sandinya di luar Sandbox.
- **Privasi** — nomor dimasking (`62896****8411`), email disensor (`bang****@gmail.com`), media/isi story tidak diunduh atau disimpan. Log cuma metadata.
- **Avatar** — 4 avatar anime WebP lokal atau unggah sendiri (dipotong persegi, WebP 512×512, maks 100 KB).
- **Halaman publik** — `/privacy`, `/dmca`, `/terms`. Footer jam WIB realtime.

## 📦 Data & Backup

- Akun, hash kata sandi, sesi web, dan log pairing ada di `data/store.json`; kunci sesi web di `data/.session-secret`.
- Kredensial WhatsApp (Baileys) tiap akun di `DATA_AKUN/<username>/session.json`. Folder `DATA_AKUN`, `DATA_KUNJUNGAN`, `DATA_STALKER` di-backup berkala ke repo ini.
- **Jangan commit / bagikan berkas auth.** Bila sesi hilang, akun harus pairing ulang — session.json tidak bisa dipulihkan.
- Admin dibuat saat startup dari properti `admin` di `config.json`, atau variabel `BOOTSTRAP_ADMIN_*` (email, username, password min 12 karakter, nama opsional). Jaga kerahasiaan `config.json`.

## 🔒 Catatan Keamanan

- File auth berisi private key jangka panjang — simpan `DATA_AKUN` di disk persisten yang privat, jangan di `/tmp`.
- ZIP source sengaja tidak membawa `session.json` WhatsApp aktif.
- Repo sumber pernah mencatat token/secret di Git — perlakukan yang pernah bocor sebagai sudah bocor dan rotasi sebelum deployment.
- Baileys `7.0.0-rc14` adalah library komunitas, bukan dari WhatsApp. Pairing code = WhatsApp Web, bukan Mobile API. Tanda dilihat + reaksi terlihat oleh pemilik story. Pakai akun sendiri dan patuhi syarat layanan WhatsApp.

## 📚 Dokumentasi

- Struktur proyek: [docs/PROJECT-STRUCTURE.md](docs/PROJECT-STRUCTURE.md)
- Pairing code Baileys: https://baileys.wiki/authentication/pairing-code
- Pengelolaan sesi: https://baileys.wiki/authentication/session-management
- Migrasi Baileys v7: https://whiskey.so/migrate-latest
- Repo Baileys: https://github.com/WhiskeySockets/Baileys
