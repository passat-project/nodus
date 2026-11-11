import { z } from 'zod';

/** Конфиг gateway на старте (I7: zod на границах, секреты — только env). */
const gatewayEnvSchema = z.object({
  GATEWAY_PORT: z.coerce.number().int().positive().default(3002),
  /** Интерфейс, на котором слушает gateway. Дефолт 0.0.0.0 — прод/Docker и
   *  прежнее поведение; песочница live-stack сужает до 127.0.0.1 (#675):
   *  наружу должен быть виден только web. */
  GATEWAY_HOST: z.string().min(1).default('0.0.0.0'),
  /** Тот же секрет, что у apps/api (HS256 access-токенов token.service). */
  JWT_SECRET: z.string().min(32),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  /** READ-ONLY доступ к Postgres api: членство бесед, профили (исключение I3, README). */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?/ }),
});

export type GatewayConfig = z.infer<typeof gatewayEnvSchema>;

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return gatewayEnvSchema.parse(env);
}
