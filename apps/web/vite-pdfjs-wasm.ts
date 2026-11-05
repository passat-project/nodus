import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

import { PDFJS_WASM_BASE } from './src/shared/files/pdfjs-wasm-url.js';

/**
 * Статика WASM-декодеров pdf.js (#617): с 6.x JBIG2/CCITT/JPX/QCMS живут в
 * `pdfjs-dist/wasm/*.wasm` и воркер ГРУЗИТ их по требованию с `wasmUrl`
 * (getDocument). Без настройки декодирование молча падает — битональные
 * сканы (текст писем от МФУ) рендерятся мусором/чёрными боксами. Файлы —
 * часть npm-пакета (не коммитятся): dev отдаёт middleware, build эмитит их
 * в dist как ассеты с фиксированными именами (паттерн cloakpdf при
 * апгрейде pdfjs-dist 5→6, подтверждение внешним источником в gotchas).
 */

const require = createRequire(import.meta.url);
/** Папка wasm текущего (по lock-файлу) pdfjs-dist — единственный источник. */
const wasmDir = join(require.resolve('pdfjs-dist/package.json'), '..', 'wasm');

/** Маршрут раздачи — из общей с просмотрщиком базы (рассинхрон = баг). */
const routeRe = new RegExp(`^${PDFJS_WASM_BASE}([^/?]+)(?:\\?.*)?$`);

/** Список отдаваемых файлов (лицензии — не для раздачи, но и не секрет). */
function wasmFiles(): string[] {
  return readdirSync(wasmDir).filter((name) => !name.startsWith('LICENSE'));
}

function contentTypeOf(name: string): string {
  return name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript';
}

/**
 * Плагин Vite: `/pdfjs-wasm/<file>` в dev (middleware) и в build
 * (emitAssets — файлы попадают в dist, nginx раздаёт как статику).
 */
export function pdfjsWasmAssets(): Plugin {
  return {
    name: 'nodus-pdfjs-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = routeRe.exec(req.url ?? '');
        if (!match) {
          next();
          return;
        }
        const name = match[1]!;
        if (!wasmFiles().includes(name)) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', contentTypeOf(name));
        res.end(readFileSync(join(wasmDir, name)));
      });
    },
    generateBundle() {
      for (const name of wasmFiles()) {
        this.emitFile({
          type: 'asset',
          // fileName относительно dist: база начинается с '/', срезаем.
          fileName: `${PDFJS_WASM_BASE}${name}`.replace(/^\//, ''),
          source: readFileSync(join(wasmDir, name)),
        });
      }
    },
  };
}
