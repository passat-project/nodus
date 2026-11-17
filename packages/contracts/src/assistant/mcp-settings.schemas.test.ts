import { describe, expect, it } from 'vitest';

import {
  assistantMcpBodySchema,
  assistantMcpServerInputSchema,
  assistantMcpUrlSchema,
} from './mcp-settings.schemas.js';

describe('assistantMcpUrlSchema: только https без секретов в URL', () => {
  it('hosted Exa проходит', () => {
    expect(assistantMcpUrlSchema.safeParse('https://mcp.exa.ai/mcp').success).toBe(true);
  });

  it('http, логин и query отклоняются', () => {
    expect(assistantMcpUrlSchema.safeParse('http://mcp.exa.ai/mcp').success).toBe(false);
    expect(assistantMcpUrlSchema.safeParse('https://u:p@mcp.exa.ai/mcp').success).toBe(false);
    expect(assistantMcpUrlSchema.safeParse('https://mcp.exa.ai/mcp?exaApiKey=secret').success).toBe(
      false,
    );
  });

  it('пароль без логина и фрагмент тоже не проходят (секрет не уходит в URL)', () => {
    // `https://:secret@host` имеет username === '' и проходил прежнюю проверку.
    expect(assistantMcpUrlSchema.safeParse('https://:secret@mcp.exa.ai/mcp').success).toBe(false);
    expect(assistantMcpUrlSchema.safeParse('https://mcp.exa.ai/mcp#token').success).toBe(false);
  });
});

describe('assistantMcpServerInputSchema / body', () => {
  it('минимальный сервер: транспорт по умолчанию, выключенные признаки по умолчанию', () => {
    const parsed = assistantMcpServerInputSchema.parse({
      name: 'Exa',
      url: 'https://mcp.exa.ai/mcp',
    });
    expect(parsed.transport).toBe('streamable-http');
    expect(parsed.enabled).toBe(true);
    expect(parsed.defaultForSearch).toBe(false);
  });

  it('ключ на запись необязателен: сервер без ключа допустим (keyless-режим)', () => {
    const parsed = assistantMcpBodySchema.parse({
      servers: [{ name: 'Exa', url: 'https://mcp.exa.ai/mcp' }],
    });
    expect(parsed.servers[0]?.apiKey).toBeUndefined();
  });

  it('пустой список серверов допустим (реестр можно очистить)', () => {
    expect(assistantMcpBodySchema.safeParse({ servers: [] }).success).toBe(true);
  });
});
