FROM node:20-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts/patch-baileys-auth.js ./scripts/patch-baileys-auth.js
RUN npm ci --omit=dev

COPY app.config.ts README.md ./
COPY public ./public
COPY server ./server
COPY docs ./docs

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
