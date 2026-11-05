/**
 * База раздачи WASM-декодеров pdf.js (#617): pdfjs-dist 6.x грузит
 * декодеры сканов (JBIG2/CCITT/JPX) по требованию с `wasmUrl`. Строка
 * общая для просмотра (`getDocument`) и плагина раздачи
 * (`vite-pdfjs-wasm.ts` — middleware dev + эмит dist); файл без node-импортов:
 * он попадает в браузерный бандл.
 */
export const PDFJS_WASM_BASE = '/pdfjs-wasm/';
