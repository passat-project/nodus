/**
 * Типы mammoth (DOCX → текст): пакет не поставляет их, DefinitelyTyped
 * `@types/mammoth` не существует. Объявлен только используемый API —
 * `extractRawText({ buffer })` (#922).
 */
declare module 'mammoth' {
  export interface MammothMessage {
    type: string;
    message: string;
  }
  export interface ExtractRawTextResult {
    value: string;
    messages: MammothMessage[];
  }
  export function extractRawText(input: { buffer: Buffer }): Promise<ExtractRawTextResult>;
  const mammoth: { extractRawText: typeof extractRawText };
  export default mammoth;
}
