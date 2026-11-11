// Импорт с .ts-расширением осознанно: dev-режим запускает исходники напрямую
// (Node 24 type stripping), а tsc при сборке переписывает расширение на .js
// (rewriteRelativeImportExtensions).
import { loadGatewayConfig } from './config.ts';
import { createGatewayServer } from './gateway-server.ts';
import { PgMembershipStore } from './membership.ts';
import { createGatewayRedis } from './redis-connection.ts';

const config = loadGatewayConfig();
const store = new PgMembershipStore(config.DATABASE_URL);
const redis = createGatewayRedis(config.REDIS_URL);
const gateway = createGatewayServer({ jwtSecret: config.JWT_SECRET, store, redis });

gateway.httpServer.listen(config.GATEWAY_PORT, config.GATEWAY_HOST, () => {
  void gateway
    .startFanout()
    .then(() => {
      console.log(`gateway: слушает ${config.GATEWAY_HOST}:${config.GATEWAY_PORT}, fanout активен`);
    })
    .catch((error: unknown) => {
      console.error('gateway: fanout не стартовал:', error);
      process.exitCode = 1;
    });
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log(`gateway: ${signal}, останавливаюсь`);
  await gateway.close();
  redis.disconnect();
  await store.close();
}
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
