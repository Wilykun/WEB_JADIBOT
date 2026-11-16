FROM node:20-bookworm-slim

WORKDIR /app

# Salin package.json dulu lalu install dependensi. Repo ini tidak punya package-lock.json, jadi pakai npm install (bukan npm ci yang wajib lockfile).
COPY package.json ./
RUN npm install --omit=dev

# Salin kode panel, skrip start, dan data akun/sesi (hasil backup GitHub) agar panel langsung punya akun saat pertama jalan.
COPY scripts/patch-baileys-auth.js ./scripts/patch-baileys-auth.js
COPY app.config.ts README.md start-ptero.sh ./
COPY public ./public
COPY server ./server
COPY DATA_AKUN ./DATA_AKUN
COPY data ./data
COPY DATA_KUNJUNGAN ./DATA_KUNJUNGAN
COPY DATA_STALKER ./DATA_STALKER

# Jangan set NODE_ENV=production di sini: server mewajibkan SESSION_SECRET minimal 32 karakter saat production, sementara repo ini tidak menyimpan secret itu (data/.session-secret di-gitignore dan dibuat otomatis saat server pertama jalan). Tanpa NODE_ENV=production, server membuat secret acak sendiri saat pertama jalan dan menyimpannya ke data/.session-secret.
# Jangan set PORT di sini: Railway memberi PORT lewat env saat runtime, server sudah membaca process.env.PORT (fallback 3000).
EXPOSE 3000

CMD ["npm", "start"]
