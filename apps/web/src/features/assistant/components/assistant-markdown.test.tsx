// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ui } from '@nodus/contracts';

const bridge = vi.hoisted(() => ({ openCardFromHref: vi.fn() }));

vi.mock('./assistant-tool-rows.js', () => ({
  openCardFromHref: bridge.openCardFromHref,
}));

import { AssistantMarkdown } from './assistant-markdown.js';

/**
 * Markdown-ответ ассистента (ADR-0045, #897): GFM читается, а НЕДОВЕРЕННЫЙ
 * текст не исполняется — ни один XSS-вектор из письма/сообщения не должен
 * стать элементом DOM или ссылкой с опасным протоколом.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AssistantMarkdown: GFM', () => {
  it('рендерит жирный, списки, таблицу и код-блок', () => {
    const { container } = render(
      <AssistantMarkdown
        text={
          '**Итог:** просрочено 3 задачи\n\n- одна\n- две\n\n| № | Срок |\n| - | - |\n| 7 | 31.10 |\n\n```ts\nconst a = 1;\n```'
        }
      />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('Итог:');
    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.querySelector('table')).toBeTruthy();
    expect(container.querySelector('pre code')?.textContent).toContain('const a = 1;');
  });

  it('оборванный код-блок (стрим прервался) рендерится частично и не падает', () => {
    const { container } = render(<AssistantMarkdown text={'Ответ:\n\n```json\n{"a": 1'} />);
    expect(container.querySelector('pre')).toBeTruthy();
    expect(container.textContent).toContain('{"a": 1');
  });

  it('половина строки таблицы не ломает рендер', () => {
    const { container } = render(<AssistantMarkdown text={'| № | Срок |\n| - | - |\n| 7 | 31'} />);
    expect(container.querySelector('table')).toBeTruthy();
  });
});

describe('AssistantMarkdown: санитайзер (XSS-векторы не исполняются)', () => {
  it('сырой HTML не становится элементами DOM', () => {
    const { container } = render(
      <AssistantMarkdown
        text={
          '<img src=x onerror="alert(1)">\n\n<script>alert(2)</script>\n\n<iframe src="https://evil"></iframe>'
        }
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.innerHTML).not.toContain('onerror');
  });

  it('javascript:-ссылка остаётся текстом без href', () => {
    const { container } = render(
      <AssistantMarkdown text={'[нажми](javascript:alert(1)) и [data](data:text/html,<b>x</b>)'} />,
    );
    for (const anchor of container.querySelectorAll('a')) {
      expect(anchor.getAttribute('href') ?? '').not.toMatch(/javascript:|data:/i);
    }
  });

  it('заголовки, цитата и разделитель рендерятся спокойными стилями', () => {
    const { container } = render(
      <AssistantMarkdown
        text={
          '# Большой заголовок\n\n## Средний\n\n### Малый\n\n> цитата\n\n---\n\nнумерованный:\n\n1. первый\n2. второй'
        }
      />,
    );
    expect(container.querySelector('h3')?.textContent).toBe('Большой заголовок');
    expect(container.querySelectorAll('h3')).toHaveLength(2);
    expect(container.querySelector('h4')?.textContent).toBe('Малый');
    expect(container.querySelector('blockquote')?.textContent).toContain('цитата');
    expect(container.querySelector('hr')).toBeTruthy();
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
  });

  it('внутренняя ?cards=-ссылка открывает карточку мостом, без новой вкладки', () => {
    bridge.openCardFromHref.mockClear();
    const href = '?cards=task:11111111-1111-4111-8111-111111111111';
    render(<AssistantMarkdown text={`Открыть [задачу](${href})`} />);
    const link = screen.getByRole('link', { name: 'задачу' });
    expect(link.getAttribute('target')).toBeNull();
    fireEvent.click(link);
    expect(bridge.openCardFromHref).toHaveBeenCalledWith(href);
  });

  it('недоверенный href с cards= не считается карточкой: чужой вид, не-UUID, внешний URL', () => {
    bridge.openCardFromHref.mockClear();
    for (const href of [
      '?cards=task:../directory/users',
      '?cards=admin:11111111-1111-4111-8111-111111111111',
      'https://evil.example/?cards=task:11111111-1111-4111-8111-111111111111',
    ]) {
      render(<AssistantMarkdown text={`[ссылка](${href})`} />);
      const link = screen.getByRole('link', { name: 'ссылка' });
      expect(link.getAttribute('target'), href).toBe('_blank');
      fireEvent.click(link);
      expect(bridge.openCardFromHref, href).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it('markdown-изображения не рендерятся (нет автозагрузки внешнего URL)', () => {
    const { container } = render(
      <AssistantMarkdown text={'![график](https://tracker.example/beacon.png?task=42)'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.innerHTML).not.toContain('tracker.example');
  });

  it('внешняя http-ссылка открывается в новой вкладке с noopener', () => {
    render(<AssistantMarkdown text={'Смотри [источник](https://example.com/a)'} />);
    const link = screen.getByRole('link', { name: 'источник' });
    expect(link.getAttribute('href')).toBe('https://example.com/a');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});

describe('AssistantMarkdown: код-блок', () => {
  it('кнопка «Копировать» кладёт текст блока в буфер', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<AssistantMarkdown text={'```\nстрока 1\nстрока 2\n```'} />);
    fireEvent.click(screen.getByRole('button', { name: ui.assistant.markdownCopy }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    // Подтверждение копирования — текст и галочка, а не молчание кнопки.
    expect(await screen.findByText(ui.assistant.markdownCopied)).toBeTruthy();
    expect(String((writeText.mock.calls[0] as unknown as [string])[0])).toContain('строка 1');
  });
});
