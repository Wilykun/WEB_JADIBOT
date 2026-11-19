# Docker — ReadSW Console (WEB_JADIBOT)

Jalanin panel + tunnel Cloudflare pakai Docker, di PC/VPS (bukan di VM Muse — di VM ini cloudflared gagal karena jaringan cuma lewat proxy).

## Yang dibutuhkan

- Docker + Docker Compose sudah terinstall di PC/VPS
- Token tunnel Cloudflare (dari dashboard: Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared)
- Public Hostname sudah diatur di dashboard Cloudflare: `readsw.my.id` → `http://panel:3000`

## Cara jalanin

```bash
# 1. Masuk folder script
cd WEB_JADIBOT-main

# 2. Install dulu (sekali saja, di luar Docker, supaya node_modules ada kalau mau jalanin tanpa Docker)
npm install

# 3. Jalanin panel + tunnel
CLOUDFLARE_TUNNEL_TOKEN=<token-dari-cloudflare> docker compose up -d --build

# 4. Cek
docker compose ps
docker compose logs -f panel
curl http://localhost:3000/api/health
```

Buka `https://readsw.my.id`, harusnya langsung tampil halaman login panel.

## Berhenti / restart

```bash
docker compose down
docker compose up -d
```

## Catatan

- `Dockerfile` pakai Node 20, jalankan `node server/index.js` di port 3000.
- `docker-compose.yml` punya 2 service: `panel` dan `tunnel` (cloudflared).
- Data panel (`data/` dan `DATA_AKUN/`) disimpan sebagai volume, jadi tidak hilang kalau container dihapus.
- Jangan sebar token tunnel Cloudflare — itu kunci ke akun Cloudflare kamu.
- Kalau cuma mau panelnya saja tanpa tunnel Cloudflare, jalanin: `docker compose up -d panel`
