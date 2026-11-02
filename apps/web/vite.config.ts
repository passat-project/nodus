/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// API и WebSocket проксируются на того же origin:
// dev — прокси Vite, preview (e2e в CI) — тот же прокси, docker — прокси nginx (infra/nginx/web.conf).
// Цель /api-прокси: NODUS_API_DEV_TARGET из корневого .env — живой api для
// dev-приёмки (например, локальный инстанс ветки на :3011); по умолчанию —
// NODUS_API_PORT (docker-стек, 3001). Цель /socket.io (#104): симметрично —
// NODUS_GATEWAY_DEV_TARGET (dev-gateway ветки, например :3012), иначе хост-порт
// docker-gateway (NODUS_GATEWAY_PORT, 3002).
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '../../', '');
  const apiTarget = env.NODUS_API_DEV_TARGET ?? `http://localhost:${env.NODUS_API_PORT ?? 3001}`;
  const gatewayTarget =
    env.NODUS_GATEWAY_DEV_TARGET ?? `http://localhost:${env.NODUS_GATEWAY_PORT ?? 3002}`;
  // ONLYOFFICE (#138): браузер грузит редактор с тех же корневых путей DS,
  // что и прод-nginx (infra/nginx/web.conf). Цель — хост-порт documentserver
  // (NODUS_OFFICE_PORT, 3013) или явный NODUS_OFFICE_DEV_TARGET.
  const officeTarget =
    env.NODUS_OFFICE_DEV_TARGET ?? `http://localhost:${env.NODUS_OFFICE_PORT ?? 3013}`;
  const proxy: Record<string, { target: string; changeOrigin?: boolean; ws?: boolean }> = {
    '/api': {
      target: apiTarget,
      changeOrigin: true,
    },
    '/socket.io': {
      target: gatewayTarget,
      ws: true,
    },
  };
  // Ключ с ^ — RegExp (докам vite): версионный префикс DS 302-редиректит
  // статик на /<версия>-<хэш>/web-apps/... (кэш-бастинг), корневые пути —
  // остальное; канал ко-эдитинга /doc/ — вебсокет.
  const officePaths = String.raw`^/(web-apps|sdkjs|sdkjs-plugins|fonts|dictionaries|cache|doc|converter|command|docbuilder|welcome|healthcheck|[0-9]+\.[0-9]+\.[0-9]+-[0-9a-f]+)`;
  proxy[officePaths] = {
    target: officeTarget,
    // БЕЗ changeOrigin: Host остаётся браузерным — DS строит ссылки на
    // подготовленные файлы (Editor.bin, колбэки) от увиденного хоста;
    // подменённый хост = кросс-origin и ERR_FAILED (репро #138).
    ws: true,
  };
  return {
    // VITE_*-флаги (VITE_API_MOCK) лежат в корневом .env рядом с docker-переменными.
    envDir: '../../',
    // МОКИ — ТОЛЬКО dev-сервер (command === 'serve'): любой `vite build`
    // (турбо-гейт, CI, live-stack, ручной) вшивает VITE_API_MOCK='false'.
    // Иначе гейт-сборка затирала non-mock dist песочницы, MSW стартовал на
    // preview и его service worker съедал мутации до сети (инцидент #171,
    // 04.10; gotchas «Изоляция песочницы»).
    define:
      command === 'build'
        ? { 'import.meta.env.VITE_API_MOCK': JSON.stringify('false') }
        : undefined,
    plugins: [tailwindcss(), react()],
    // #533: компонентные jsdom-тесты под параллельным `turbo test` (api+web+
    // contracts одновременно) упирались в дефолтные 5 с — notification-reader
    // изолированно идёт ~3 с. 15 с — потолок на холодный старт под нагрузкой,
    // а не оправдание медленным ассертам (Vitest: testTimeout default 5000).
    test: {
      testTimeout: 15_000,
    },
    server: {
      port: Number(env.NODUS_WEB_DEV_PORT ?? 5173),
      // Канон одного dev-сервера (#91): без strictPort vite тихо уезжает на
      // соседний порт, и владелец с агентами сидят на разных инстансах.
      strictPort: true,
      proxy,
    },
    preview: {
      port: Number(env.NODUS_WEB_PREVIEW_PORT ?? 4173),
      strictPort: true,
      proxy,
    },
  };
});
