import { describe, expect, it } from 'vitest';

import { assistantToolLabel } from './assistant-tool-label.js';

/** Подпись вызова: сырой id после выполнения не должен показываться (18.11). */
describe('assistantToolLabel', () => {
  it('человеческий title из каталога не трогается', () => {
    expect(assistantToolLabel('tasks.list', 'Задачи: список')).toBe('Задачи: список');
  });

  it('Exa: сырой id и fallback превращаются в «Интернет: поиск/страница»', () => {
    expect(assistantToolLabel('ext.exa.web_search_exa')).toBe('Интернет: поиск');
    expect(assistantToolLabel('ext.exa.web_search_exa', 'ext.exa.web_search_exa')).toBe(
      'Интернет: поиск',
    );
    expect(assistantToolLabel('ext.exa.web_fetch_exa', null)).toBe('Интернет: страница');
  });

  it('прочие MCP-серверы: имя сервера и инструмента, без префикса ext.', () => {
    expect(assistantToolLabel('ext.git-mcp.echo', 'ext.git-mcp.echo')).toBe('git mcp: echo');
  });
});
