import { describe, expect, it } from 'vitest';

import { PDFJS_WASM_BASE } from './src/shared/files/pdfjs-wasm-url.js';
import { pdfjsWasmAssets } from './vite-pdfjs-wasm.js';

/**
 * Плагин раздачи WASM-декодеров pdf.js (#617): middleware dev-сервера и эмит
 * ассетов сборки. Проверяем контракт обеих сторон: путь/типы/защиту от
 * мусора и попадание файлов пакета в dist.
 */

interface FakeServer {
  middlewares: { use: (fn: (req: unknown, res: unknown, next: () => void) => void) => void };
  handler: ((req: unknown, res: unknown, next: () => void) => void) | null;
}

function mount(): FakeServer {
  const server: FakeServer = { middlewares: { use: () => undefined }, handler: null };
  server.middlewares.use = (fn) => {
    server.handler = fn;
  };
  pdfjsWasmAssets().configureServer?.(server as never);
  return server;
}

function fakeRes(): {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer | null;
  setHeader: (k: string, v: string) => void;
  end: (b?: Buffer) => void;
} {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as Buffer | null,
    setHeader: (k: string, v: string) => {
      res.headers[k] = v;
    },
    end: (b?: Buffer) => {
      res.body = b ?? null;
    },
  };
  return res;
}

describe('pdfjsWasmAssets (#617)', () => {
  it('база — каталог со слэшем (контракт wasmUrl pdf.js)', () => {
    expect(PDFJS_WASM_BASE).toBe('/pdfjs-wasm/');
  });

  it('dev: jbig2.wasm отдаётся как application/wasm с байтами пакета', () => {
    const server = mount();
    expect(server.handler).not.toBeNull();
    const res = fakeRes();
    let passed = false;
    server.handler!({ url: '/pdfjs-wasm/jbig2.wasm' }, res, () => {
      passed = true;
    });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/wasm');
    // Магия WASM: 00 61 73 6d (\0asm) — файл реального декодера, не заглушка.
    expect(res.body?.subarray(0, 4)).toEqual(Buffer.from([0x00, 0x61, 0x73, 0x6d]));
  });

  it('dev: неизвестный файл — 404, чужой путь — next()', () => {
    const server = mount();
    const notFound = fakeRes();
    server.handler!({ url: '/pdfjs-wasm/unknown.wasm' }, notFound, () => undefined);
    expect(notFound.statusCode).toBe(404);

    const foreign = fakeRes();
    let passed = false;
    server.handler!({ url: '/api/v1/letters' }, foreign, () => {
      passed = true;
    });
    expect(passed).toBe(true);
    expect(foreign.statusCode).toBe(200);
  });

  it('dev: query не ломает маршрут', () => {
    const server = mount();
    const res = fakeRes();
    server.handler!({ url: '/pdfjs-wasm/openjpeg.wasm?v=1' }, res, () => undefined);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/wasm');
  });

  it('build: все файлы пакета эмитятся в pdfjs-wasm/, лицензии — нет', () => {
    const plugin = pdfjsWasmAssets();
    const emitted: { fileName: string; source: Buffer }[] = [];
    plugin.generateBundle?.call(
      {
        emitFile: (f: { fileName: string; source: Buffer }) => {
          emitted.push({ fileName: f.fileName, source: f.source });
        },
      } as never,
      {} as never,
    );
    const names = emitted.map((f) => f.fileName);
    expect(names).toContain('pdfjs-wasm/jbig2.wasm');
    expect(names).toContain('pdfjs-wasm/qcms_bg.wasm');
    expect(names.some((n) => n.includes('LICENSE'))).toBe(false);
    // Фолбэк-декодеры без WASM (jbig2_nowasm_fallback.js) — тоже в раздаче.
    expect(names).toContain('pdfjs-wasm/jbig2_nowasm_fallback.js');
  });
});
