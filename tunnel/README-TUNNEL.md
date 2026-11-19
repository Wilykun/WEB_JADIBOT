# Tunnel readsw.my.id (versi Muse)

Panel jalan di port 3000. Tunnel ini yang bikin panel bisa dibuka lewat https://readsw.my.id

Cara kerja:
1. `tunnel/start-tunnel.sh stable` jalanin SSH tunnel ke tunnl.gg, dapat URL https://wise-moon-dffba322.tunnl.gg
2. Worker Cloudflare `readsw-tunnel` di readsw.my.id jadi proxy, terusin semua request ke URL tunnl.gg itu
3. `start-ptero.sh` otomatis jalanin tunnel ini sebelum panel jalan, jadi cukup `npm start` / `bash start-ptero.sh`

File Worker-nya (bukan di script ini, di Cloudflare): `~/workspace/pages-tunnel/proxy-worker.js`
Log tunnel: /tmp/tunnl.log
Batas tunnl.gg gratis: idle 2 jam, maks 24 jam, 5 GB/hari. Kalau mati, jalanin ulang `tunnel/start-tunnel.sh stable`.
