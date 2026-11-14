# ReadSW Console

Panel web responsif untuk pendaftaran dan login, profil akun, preferensi tiga mode (**Read Only**, **Read Only + ReadSW**, **Online 24 Jam**), permintaan Baileys pairing code, dan log privat per akun. Pendaftaran hanya meminta username, email, dan kata sandi; username menjadi nama tampilan awal. Setiap akun diberi ID acak; sesi pairing disimpan di folder yang berbeda berdasarkan ID akun, tidak berdasarkan IP atau nomor telepon.

Profil menyediakan empat avatar anime WebP lokal ringan atau unggah gambar sendiri. Gambar unggahan dipotong persegi dan dikonversi di browser menjadi WebP 512 × 512 (maksimal 100 KB), lalu disimpan dengan izin privat pada `DATA_AKUN/<username>/avatar.webp`. Nama folder berasal dari username unik yang sudah divalidasi; gambar hanya disajikan melalui endpoint autentikasi pemilik akun.

Footer menampilkan hari, tanggal, bulan, tahun, dan jam WIB yang diperbarui realtime. Halaman publik tersedia di `/privacy`, `/dmca`, dan `/terms`. Isi kebijakan menjelaskan implementasi saat ini; tinjau kembali sebelum deployment publik, terutama bila penyimpanan, kontak resmi, atau fitur berubah.

## Struktur proyek

Backend dikelompokkan di `server/`, aset dashboard di `public/`, dan dokumentasi teknis di `docs/`. Data runtime lokal berada di `data/` dan dikecualikan dari ZIP source; detail folder serta alasan keamanan sesi ada di [panduan struktur proyek](docs/PROJECT-STRUCTURE.md).

## Status saat ini

Untuk akun baru yang belum tertaut, dashboard hanya menampilkan profil akun dan formulir **Tautkan Perangkat**. Setelah WhatsApp mengonfirmasi tautan, formulir dan pairing code disembunyikan, lalu status runner, mode, preferensi, kontrol worker, dan log ditampilkan. Sesi yang pernah tertaut tetap menampilkan konsol saat terputus atau dihentikan agar bisa disambungkan kembali atau dihapus. Setelah pendaftaran, akun harus menyelesaikan kode verifikasi acak 5 karakter yang memuat huruf besar, huruf kecil, dan angka; kapitalisasi harus sama persis. Jawaban salah langsung mengganti kode. Setelah tiga jawaban salah berturut-turut, percobaan ditahan selama 60 detik. Kode kedaluwarsa dalam 15 menit dan diperbarui otomatis saat dicoba kembali. Data pendaftaran disimpan sementara dalam `pendingRegistrations` selama maksimal 24 jam; akun permanen dan folder `DATA_AKUN/<username>` baru dibuat setelah kode benar. Pendaftaran ulang dengan username/email pending yang sama memulai ulang verifikasi.

Pairing code sungguhan dapat diminta dari panel setelah pengguna masuk, memasukkan nomor WhatsApp dalam format digit dengan kode negara, lalu mencentang konfirmasi kepemilikan dan persetujuan perilaku otomatis ReadSW. Baileys v7 menunggu event koneksi yang sesuai sebelum meminta kode. Kode ditampilkan hanya ke sesi web pemilik, ditahan di memori paling lama tiga menit, tidak disimpan ke log atau `store.json`, dan tidak dicatat ke stdout. Log story hanya menyimpan metadata aktivitas; nomor dimasking, ID story dipendekkan, dan media/isi story maupun kredensial tidak dicatat. Identitas WhatsApp dapat menjadi bagian dari berkas auth privat setelah pairing.

Untuk akun yang belum memiliki profil bot/preferensi tersimpan, pairing sukses membuat profil **Read Only + ReadSW** secara otomatis, memilih 💚, mengaktifkan reaksi, memakai jeda acak 1–20 detik, lalu langsung menjalankan worker—tidak perlu menekan tombol Aktifkan atau Start bot. Preferensi yang sudah tersimpan tidak ditimpa. Profil dapat diubah kapan saja; **Stop bot** menghentikan listener tanpa memutus sesi WhatsApp. Daftar emoji dan delay tersimpan per akun; maksimal 30 emoji Unicode. Event status `notify`/`append` yang diterima worker sekarang dicatat sebagai backlog privat per akun dan dicoba lagi saat worker tersambung kembali, selama belum kedaluwarsa 24 jam. Mode **Read Only** hanya menandai dibaca; mode **Read Only + ReadSW** dapat mencoba kembali reaksi yang belum berhasil, sesuai preferensi akun saat pemrosesan. Tanda dilihat dan reaksi adalah aktivitas yang dapat terlihat oleh pemilik story. Tombol **Restart bot** memasang ulang listener. Log menampilkan tipe story dan hasil, nama profil bila tersedia, nomor kontak yang dimasking, serta ID story yang dipendekkan. Bot tidak mengunduh atau menyimpan media atau isi story.

Sinkronisasi full history aktif pada socket pairing dan reconnect menggunakan preset **macOS Desktop**; event `messaging-history.set` disaring agar hanya status `status@broadcast` yang masuk backlog. Baileys tetap dapat memuat riwayat chat/kontak lain dan startup dapat lebih lama serta memakai lebih banyak memori; aplikasi tidak menyimpan isi/media chat non-status. Backlog hanya dapat memulihkan status yang WhatsApp/Baileys kirim dalam batch history dan yang belum melewati TTL 24 jam, sehingga hasil tetap bergantung pada ketersediaan data dari WhatsApp. Data ReadSW disimpan terpisah di `DATA_AKUN/<username>/ReadSwReactionsw/{ceksw,swtrack,users}` dan bukan di `session.json`. **Online 24 Jam** masih berupa preferensi placeholder dan bukan layanan runner 24/7. Untuk akun baru tanpa preferensi tersimpan, pairing sukses akan menjalankan mode Read Only + ReadSW otomatis; status BOT di panel menjadi indikator utama. Profil lama dan preferensinya tidak diubah.

## Menjalankan

Persyaratan: Node.js 20 atau lebih baru.

```bash
npm install
npm start
```

Buka `http://localhost:3000`. Perintah `npm start` menjalankan `start-ptero.sh`, yang memeriksa Node.js 20+, memasang dependensi bila `node_modules` belum ada, lalu mengulang server setelah crash hingga batas restart tercapai. Runner meneruskan sinyal berhenti dari Pterodactyl ke server panel; runner ini tidak mengirim notifikasi Telegram atau menggunakan PM2. Untuk pengembangan, jalankan `npm run dev`. Pemeriksaan sintaks: `npm run check`. Saat dijalankan lokal, aplikasi membaca `config.json` dari root proyek; variabel environment yang sudah disetel host memiliki prioritas. Isi properti `admin` untuk membuat akun admin saat startup. Jaga kerahasiaan `config.json` karena dapat berisi kata sandi.

Akun, hash kata sandi, sesi web, dan log pairing redacted disimpan pada `data/store.json`; kunci sesi web dibuat di `data/.session-secret`. Kredensial autentikasi WhatsApp Baileys untuk setiap akun berada pada `DATA_AKUN/<username>/session.json` dalam objek `creds` dan `keys`. File metadata login panel yang sudah disamarkan berada terpisah di `DATA_AKUN/<username>/panel-sessions.json`. Adapter memakai BufferJSON dan tulis atomik melalui file sementara lalu rename; sesi lama dari `data/whatsapp-auth/<user-id>/` dimigrasikan otomatis sekali. Kedua lokasi privat dan dikecualikan dari ZIP source; jangan commit atau bagikan berkas auth.

## Pairing code

Masukkan nomor dengan kode negara, digit saja, panjang 7–15 digit (contoh bentuk: `62812xxxxxxxx`), lalu centang pernyataan bahwa akun tersebut milikmu atau kamu berwenang menautkannya. Setelah tombol ditekan, masukkan kode yang muncul di panel itu sendiri di WhatsApp: **Perangkat Tertaut → Tautkan Perangkat → Tautkan dengan nomor telepon**. Jangan membagikan kode kepada orang lain; siapa pun yang memilikinya dapat menautkan perangkat.

Form memakai `libphonenumber-js` dengan metadata lengkap untuk mendeteksi negara/bendera dan memeriksa format nomor secara lokal saat diketik; nomor tidak dikirim ke layanan lookup pihak ketiga untuk pemeriksaan tersebut. Valid menurut metadata hanya berarti format dan rentang nomor cocok—ini **tidak membuktikan nomor memiliki akun WhatsApp atau sedang aktif**. Hanya WhatsApp yang dapat mengonfirmasi pairing akun. Metadata penomoran dapat berubah; perbarui dependensi secara berkala.

Masukkan kode persis seperti yang ditampilkan panel; jangan mengubah atau menebak formatnya. Berhasil membuat kode belum berarti perangkat telah tertaut—status berubah setelah WhatsApp menyelesaikan konfirmasi.

Aplikasi saat ini terpasang dengan Baileys `7.0.0-rc14`; branch upstream yang ditinjau mendeklarasikan `latest`, sehingga versi yang terpasang di sana dapat berbeda. Baileys adalah library komunitas yang tidak berafiliasi atau disahkan WhatsApp. Gunakan akun sendiri, secara wajar, dan patuhi syarat layanan WhatsApp. Pairing code menghubungkan perangkat WhatsApp Web; bukan Mobile API. Tanda dilihat dan reaksi emoji mengubah aktivitas akun WhatsApp dan dapat terlihat oleh kontak.

## Batas keamanan penyimpanan sesi

File auth berisi private key jangka panjang. Adapter menyimpan perubahan key ke `DATA_AKUN/<username>/session.json`; pastikan `DATA_AKUN` berada pada disk persisten dan aksesnya privat. `PANEL_DATA_DIR` (default `./data`) menyimpan akun panel dan kunci sesi web; jangan arahkan ke direktori sementara seperti `/tmp` untuk deployment yang perlu bertahan setelah restart. ZIP source sengaja tidak membawa `session.json` WhatsApp aktif. Jika media penyimpanan dihapus, akun perlu ditautkan ulang. Untuk layanan multi-user produksi, pertimbangkan penyimpanan auth database yang durable dan terenkripsi serta audit akses.

## Admin

Semua pendaftaran publik mendapat peran `user`. Admin lokal dibuat saat startup dari properti `admin` di `config.json`; deployment juga dapat menyetel variabel `BOOTSTRAP_ADMIN_*` melalui Secrets:

- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_USERNAME`
- `BOOTSTRAP_ADMIN_PASSWORD` (minimal 12 karakter)
- Opsional: `BOOTSTRAP_ADMIN_NAME`

Admin hanya dapat melihat ringkasan pengguna. Endpoint admin tidak memberi akses ke pairing code, nomor WhatsApp, log pairing, atau kredensial auth.

## Replit

Impor **folder proyek ini saja** sebagai aplikasi Node.js; jangan impor seluruh checkout repo bot. Gunakan Run command `npm start`, Node.js 20+, dan port `3000`. Atur `SESSION_SECRET` acak minimal 32 karakter, `COOKIE_SECURE=true`, `NODE_ENV=production`, dan `PANEL_DATA_DIR` ke volume/direktori persisten lewat Secrets/configuration. Tambahkan `BOOTSTRAP_ADMIN_*` melalui Secrets bila admin diperlukan. Pastikan penyimpanan persistent, backup terbatas, dan akses filesystem tidak bisa dibaca aplikasi lain. Jangan gunakan kode atau berkas sesi uji.

Jika deployment tidak menyediakan disk persisten dengan kontrol akses yang layak, jangan simpan sesi WhatsApp produksi di sana; siapkan auth store database terenkripsi terlebih dahulu. Replit dapat menjalankan server web, tetapi paket saat ini belum menjamin worker bot tetap hidup setelah restart/scale-down.

## Catatan audit repo sumber

Checkout repo sumber hanya diperiksa secara statis dan tidak dijalankan. Beberapa file sensitif tercatat di Git; nilainya tidak disalin ke proyek ini. Perlakukan token, secret, dan sesi yang pernah berada di repo publik sebagai berpotensi bocor dan rotasi sebelum deployment. Repo juga memiliki perintah admin untuk menjalankan JavaScript dan shell, sehingga saya tidak menyalakan source itu secara langsung sebagai backend multi-pengguna.

README repo sumber menyatakan skripnya tidak untuk dijual ulang tanpa izin. Pastikan penggunaan dan distribusi mengikuti ketentuan pemilik repo.

## Dokumentasi Baileys

- Pairing code: https://baileys.wiki/authentication/pairing-code
- Pengelolaan sesi: https://baileys.wiki/authentication/session-management
- Migrasi v7: https://whiskey.so/migrate-latest
- Repo resmi: https://github.com/WhiskeySockets/Baileys

## Arsip proyek pemilik
ZIP yang dibagikan untuk pemilik proyek ini mencakup `config.json`, `data/`, dan `DATA_AKUN/` agar akun panel dan data terkait tetap terbawa. Isi folder tersebut bersifat privat dan dapat mencakup kredensial; simpan ZIP dengan aman dan jangan unggah ke tempat publik. `node_modules/` tidak disertakan, sehingga jalankan `npm install` sebelum `npm start`.
