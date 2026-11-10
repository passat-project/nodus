# syntax=docker/dockerfile:1

# --- Стадия 1: срез монорепо под пакет (turbo prune) ---
FROM node:24-alpine AS pruner
WORKDIR /app
RUN npm install --global turbo@2.11.7
COPY . .
RUN turbo prune @nodus/api --docker

# --- Стадия 2: установка зависимостей и сборка ---
FROM node:24-alpine AS builder
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY --from=pruner /app/out/json/ .
# prepare ставит git-хуки; в образе это no-op, но файл нужен (нет .git)
COPY --from=pruner /app/scripts/install-hooks.mjs ./scripts/
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo build --filter=@nodus/api

# --- Стадия 3: рантайм ---
FROM node:24-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app ./
# Не root (#317): api пишет только в SILO/PostgreSQL, локальная ФС — read-only.
USER node
EXPOSE 3001
# Миграции — при старте контейнера (prisma-migrations: demo/prod forward-only);
# приложение поднимается только после успешных миграций.
# pnpm в runner-стадии нет — prisma CLI вызывается из node_modules пакета.
CMD ["sh", "-c", "cd apps/api && ./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
