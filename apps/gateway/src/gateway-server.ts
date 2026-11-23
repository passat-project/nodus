import { createServer, type Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type { Redis } from 'ioredis';
import { REALTIME_EVENTS } from '@nodus/contracts';

import { createAccessTokenVerifier, type AccessTokenVerifier } from './auth.ts';
import { ChatEventsConsumer } from './fanout.ts';
import { buildHealthPayload } from './health-payload.ts';
import type { MembershipStore, UserStatusReader } from './membership.ts';
import { PresenceTracker } from './presence.ts';
import { createTokenRevokedChecker, type TokenRevokedChecker } from './revoked.ts';
import { registerRoomHandlers, userRoom } from './rooms.ts';
import { TypingThrottler } from './typing.ts';

export interface GatewayDeps {
  jwtSecret: string;
  store: MembershipStore & UserStatusReader;
  redis: Redis;
  /** Имя consumer group стрима (тесты подставляют изолированное). */
  consumerGroup?: string;
  /** Проверка стоп-листа access-токенов на хендшейке (#101); по умолчанию —
   *  по тому же Redis. `null` — выключить (тесты/изолированные сборки). */
  isTokenRevoked?: TokenRevokedChecker | null;
}

export interface GatewayServer {
  httpServer: HttpServer;
  io: Server;
  consumer: ChatEventsConsumer;
  /** Запуск консьюмера стрима (после listen). Идемпотентен. */
  startFanout(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Сборка WS-gateway (используется main.ts и интеграционными тестами):
 * HTTP только для /health; всё остальное — Socket.IO (auth-хендшейк →
 * user-комната + presence → обработчики комнат/typing → fanout стрима).
 */
export function createGatewayServer(deps: GatewayDeps): GatewayServer {
  // Заполняется ниже (консьюмеру нужен io): /health отвечает только после
  // того, как сервер начал слушать, — к этому моменту ссылка установлена.
  let consumer: ChatEventsConsumer | null = null;
  const httpServer = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      // Здоровье = способность доставлять события (AUD-021): нет соединения
      // с Redis или чтение потока не удаётся дольше порога → 503.
      const healthy = consumer ? consumer.isHealthy() : true;
      res.writeHead(healthy ? 200 : 503, { 'content-type': 'application/json' });
      res.end(JSON.stringify(buildHealthPayload(healthy)));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });

  const io = new Server(httpServer);
  const verify: AccessTokenVerifier = createAccessTokenVerifier(deps.jwtSecret);
  const isTokenRevoked = deps.isTokenRevoked ?? createTokenRevokedChecker(deps.redis);
  const typing = new TypingThrottler(io, deps.store);
  const presence = new PresenceTracker(deps.store, io);

  io.use((socket, next) => {
    // Middleware socket.io ждёт void: промис проверки разворачиваем сами.
    // 'unauthorized' — токен не годен или учётка деактивирована (#320: access-
    // JWT живёт до 15 мин, статус перечитывается на каждом хендшейке) —
    // клиент делает refresh, у деактивированного он не проходит;
    // 'unavailable' — сбой БД: хендшейк закрыт (fail-closed), клиент
    // повторяет с экспонентой, без шторма refresh.
    void (async () => {
      const identity = await verify(socket.handshake.auth?.token);
      if (!identity) return next(new Error('unauthorized'));
      // Стоп-лист access-токенов (#333/#101): деактивация, смена ролей, выпуск
      // reset-ссылки. Старый токен не должен пустить обратно в WS после того,
      // как HTTP уже отвечает 401. Redis недоступен — fail-open внутри чека.
      if (await isTokenRevoked(identity.userId, identity.issuedAtSeconds)) {
        return next(new Error('unauthorized'));
      }
      let active: boolean;
      try {
        active = await deps.store.isActiveUser(identity.userId);
      } catch (error: unknown) {
        console.error('[gateway] user status check failed:', error);
        return next(new Error('unavailable'));
      }
      if (!active) return next(new Error('unauthorized'));
      socket.data.userId = identity.userId;
      next();
    })().catch((error: unknown) => {
      // Страховка: неожиданный сбой проверки — отказ, а не unhandled
      // rejection (Node роняет процесс — gateway лёг бы для всех).
      console.error('[gateway] handshake check failed:', error);
      next(new Error('unauthorized'));
    });
  });

  io.on('connection', (socket: Socket) => {
    // Обработчики регистрируются СИНХРОННО: клиент может прислать conv:join
    // раньше, чем завершится async-подготовка (user-комната, presence с
    // PG-запросом) — незарегистрированное событие теряется безвозвратно.
    registerRoomHandlers(socket, deps.store);
    socket.on(REALTIME_EVENTS.TYPING, (payload: unknown) => {
      void typing.handle(socket, payload);
    });
    socket.on('disconnect', () => {
      presence.disconnect(socket);
      typing.forget(socket.data.userId as string);
    });
    void (async () => {
      await socket.join(userRoom(socket.data.userId as string));
      await presence.connect(socket);
    })().catch((error: unknown) => {
      console.error('[gateway] connection setup failed:', error);
      socket.disconnect(true);
    });
  });

  const consumerInstance = new ChatEventsConsumer(deps.redis, io, deps.store, {
    group: deps.consumerGroup,
  });
  consumer = consumerInstance;

  return {
    httpServer,
    io,
    consumer: consumerInstance,
    startFanout() {
      return consumerInstance.start();
    },
    async close() {
      await consumer.stop();
      // io.close() закрывает и привязанный httpServer; явный close ниже —
      // страховка (на уже закрытом сервере колбэк получит ошибку — игнор).
      await io.close();
      await new Promise<void>((resolve) => {
        httpServer.close(() => {
          resolve();
        });
      });
    },
  };
}
