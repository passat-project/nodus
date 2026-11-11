import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import fastifyRateLimit, { type RateLimitPluginOptions } from '@fastify/rate-limit';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyPluginCallback } from 'fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { validateEnv } from './core/config/env.schema.js';
import { registerCoreFastifyPlugins } from './core/http/register-fastify-plugins.js';
import { setupOpenApi } from './core/openapi/openapi.setup.js';
import { TokenService } from './modules/auth/token.service.js';

async function bootstrap(): Promise<void> {
  // Fail-fast: кривое окружение — понятная ошибка до старта, а не в рантайме.
  const env = validateEnv();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // traceId = UUID запроса; trustProxy — реальные IP за nginx/Cloudflare Tunnel (аудит).
      // Не `true`: доверяем только хопам из TRUST_PROXY (дефолт — приватные/
      // локальные адреса), иначе прямой клиент подделывает X-Forwarded-For.
      genReqId: () => randomUUID(),
      trustProxy: env.TRUST_PROXY,
    }),
  );
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.setGlobalPrefix('api/v1');

  // OpenAPI из кода, публикация /api/docs только для авторизованных (I2, issue #19).
  const tokenService = app.get(TokenService);
  setupOpenApi(app, (token) => tokenService.verifyAccessToken(token));

  // Сквозные плагины (cookie, multipart вложений #57) — общая точка с
  // интеграционными фикстурами (core/http/register-fastify-plugins).
  await registerCoreFastifyPlugins(app);

  // Базовый rate limit (защита от флода); брутфорс login ограничен пер-аккаунтным
  // счётчиком неудач в AuthService (Redis) — плагин считает по IP до парсинга
  // тела, что за NAT ложно блокирует весь офис. В тестах выключен.
  if (env.NODE_ENV !== 'test') {
    await app.register(fastifyRateLimit as FastifyPluginCallback<RateLimitPluginOptions>, {
      global: true,
      max: env.RATE_LIMIT_MAX,
      timeWindow: '1 minute',
      keyGenerator: (request) => request.ip,
      errorResponseBuilder: (request, context) => ({
        code: 'RATE_LIMITED',
        message: `Too many requests, retry after ${context.after}`,
        traceId: String(request.id),
      }),
    });
  }

  await app.listen(env.API_PORT, env.API_HOST);
}

void bootstrap();
