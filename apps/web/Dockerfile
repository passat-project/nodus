# syntax=docker/dockerfile:1

# --- Стадия 1: срез монорепо под пакет (turbo prune) ---
FROM node:24-alpine AS pruner
WORKDIR /app
RUN npm install --global turbo@2.11.7
COPY . .
RUN turbo prune @nodus/web --docker

# --- Стадия 2: установка зависимостей и сборка SPA ---
FROM node:24-alpine AS builder
WORKDIR /app
# Демо-сборка по умолчанию на моках (ADR-0001); боевой режим — NODUS_WEB_MOCK=false
ARG VITE_API_MOCK=true
RUN npm install --global pnpm@11.25.0
COPY --from=pruner /app/out/json/ .
# prepare ставит git-хуки; в образе это no-op, но файл нужен (нет .git)
COPY --from=pruner /app/scripts/install-hooks.mjs ./scripts/
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo build --filter=@nodus/web

# --- Стадия 3: раздача статики nginx (прокси /api и /socket.io — см. infra/nginx/web.conf) ---
FROM nginx:1.29-alpine AS runner
COPY infra/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
