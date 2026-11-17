/** Класс сбоя MCP: транспорт/протокол (повтор осмыслен) или ошибка инструмента. */
export class McpError extends Error {
  constructor(
    message: string,
    readonly kind: 'transport' | 'protocol' | 'tool',
    readonly code: string | null = null,
  ) {
    super(message);
    this.name = 'McpError';
  }
}
