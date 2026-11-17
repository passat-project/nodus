// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui, type AssistantToolCall } from '@nodus/contracts';

const bridge = vi.hoisted(() => ({ openCardViaBridge: vi.fn() }));

vi.mock('../../../shared/lib/card-bridge.js', () => ({
  openCardViaBridge: bridge.openCardViaBridge,
}));

import {
  AssistantEntityLinks,
  AssistantToolRows,
  formatArgs,
  openCardFromHref,
} from './assistant-tool-rows.js';

/**
 * Строки вызовов инструментов (#895): одно действие одной строкой, раскрытие
 * параметров/результата по клику, статусы running/done/error. `ui.open_entity`
 * — не строка тула, а кнопка «Открыть» под ответом; адрес `?cards=kind:id`
 * разбирается и уходит в мост карточек, внешние ссылки не открываются.
 */

let idSeq = 0;

function tool(overrides: Partial<AssistantToolCall> = {}): AssistantToolCall {
  idSeq += 1;
  return {
    id: `10000000-0000-4000-8000-${String(idSeq).padStart(12, '0')}`,
    toolId: 'tasks.list',
    title: 'Задачи: список',
    status: 'done',
    args: null,
    resultPreview: null,
    durationMs: null,
    errorCode: null,
    href: null,
    hrefLabel: null,
    ...overrides,
  };
}

beforeEach(() => {
  idSeq = 0;
  bridge.openCardViaBridge.mockClear();
});

afterEach(cleanup);

describe('AssistantToolRows: строки вызовов', () => {
  it('пустой список и только ui.open_entity — строк нет', () => {
    const { container, rerender } = render(<AssistantToolRows tools={[]} />);
    expect(container.firstChild).toBeNull();

    rerender(<AssistantToolRows tools={[tool({ toolId: 'ui.open_entity' })]} />);
    expect(container.firstChild).toBeNull();
  });

  it('параметры человеческой строкой, не JSON; раскрытие и повторное закрытие', () => {
    render(
      <AssistantToolRows
        tools={[
          tool({
            args: { limit: 20, scope: 'mine', all: true, empty: null },
            resultPreview: 'Найдено 12 задач',
          }),
        ]}
      />,
    );

    const row = screen.getByRole('button', { name: /Задачи: список/ });
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/Аргументы вызова/)).toBeNull();

    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/limit: 20 · scope: mine · all: true · empty: —/)).toBeTruthy();
    expect(screen.getByText('Найдено 12 задач')).toBeTruthy();

    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Найдено 12 задач')).toBeNull();
  });

  it('нечего раскрывать — кнопка недоступна и без aria-expanded', () => {
    render(<AssistantToolRows tools={[tool()]} />);
    const row = screen.getByRole('button', { name: /Задачи: список/ });
    expect((row as HTMLButtonElement).disabled).toBe(true);
    expect(row.getAttribute('aria-expanded')).toBeNull();
  });

  it('статусы: running — спиннер, done — галка, error — красная строка и крест', () => {
    const { container } = render(
      <AssistantToolRows
        tools={[
          tool({ title: 'Ищу задачи', status: 'running' }),
          tool({ title: 'Список задач', status: 'done' }),
          tool({ title: 'Сломалось', status: 'error' }),
        ]}
      />,
    );

    const rows = Array.from(container.querySelectorAll('.text-label'));
    expect(rows.some((el) => el.querySelector('.animate-spin'))).toBe(true);
    // Ошибка красит всю строку destructive-цветом.
    const errorRow = rows.find((el) => el.textContent?.includes('Сломалось'))!;
    expect(errorRow.className).toContain('text-destructive');
    const doneRow = rows.find((el) => el.textContent?.includes('Список задач'))!;
    expect(doneRow.className).not.toContain('text-destructive');
  });

  it('только результат без аргументов: блок раскрывается, «Аргументов» нет', () => {
    render(<AssistantToolRows tools={[tool({ resultPreview: '12 задач' })]} />);

    fireEvent.click(screen.getByRole('button', { name: /Задачи: список/ }));
    expect(screen.queryByText(/Аргументы вызова/)).toBeNull();
    expect(screen.getByText('12 задач')).toBeTruthy();
  });

  it('длительность справа в миллисекундах; без неё подписи нет', () => {
    const { rerender } = render(<AssistantToolRows tools={[tool({ durationMs: 412 })]} />);
    expect(screen.getByText(`412 ${ui.assistant.ms}`)).toBeTruthy();

    rerender(<AssistantToolRows tools={[tool()]} />);
    expect(screen.queryByText(new RegExp(ui.assistant.ms))).toBeNull();
  });
});

describe('AssistantEntityLinks: переход в карточку под ответом', () => {
  it('только ui.open_entity с href; label приклеен к кнопке', () => {
    render(
      <AssistantEntityLinks
        tools={[
          tool({ title: 'Задачи: список' }),
          tool({ toolId: 'ui.open_entity', href: null }),
          tool({
            toolId: 'ui.open_entity',
            href: '?cards=task:abc',
            hrefLabel: '№12 Проверить',
          }),
        ]}
      />,
    );

    const button = screen.getByRole('button', { name: `${ui.assistant.open}: №12 Проверить` });
    fireEvent.click(button);
    expect(bridge.openCardViaBridge).toHaveBeenCalledWith({ kind: 'task', id: 'abc' });
  });

  it('пусто — блока нет', () => {
    const { container } = render(<AssistantEntityLinks tools={[tool()]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('openCardFromHref: разбор внутреннего адреса', () => {
  it.each([
    ['?cards=task:abc', { kind: 'task', id: 'abc' }],
    ['/tasks?cards=task:abc', { kind: 'task', id: 'abc' }],
    // Последняя карточка стека: предыдущие элементы отбрасываются.
    ['?cards=project:p1,task:abc', { kind: 'task', id: 'abc' }],
  ])('%s → %o', (href, expected) => {
    openCardFromHref(href as string);
    expect(bridge.openCardViaBridge).toHaveBeenCalledWith(expected);
  });

  it.each([
    ['/tasks'], // нет параметра
    ['?cards='], // пусто
    ['?cards=broken'], // нет разделителя kind:id
    ['?cards=:abc'], // пустой вид
    ['?cards=task:'], // пустой id
  ])('%s — мост не вызывается', (href) => {
    openCardFromHref(href);
    expect(bridge.openCardViaBridge).not.toHaveBeenCalled();
  });
});

describe('formatArgs: проекция аргументов', () => {
  it('пустой объект → null', () => {
    expect(formatArgs({})).toBeNull();
  });

  it('значения: строки, числа, булевы, null/undefined, объекты', () => {
    expect(formatArgs({ q: 'письма', limit: 5, all: false, none: null, gone: undefined })).toBe(
      'q: письма · limit: 5 · all: false · none: — · gone: —',
    );
    const formatted = formatArgs({ filter: { status: 'open' } })!;
    expect(formatted).toContain('filter: {"status":"open"}');
  });

  it('длинные аргументы обрезаются до 200 символов', () => {
    expect(formatArgs({ text: 'a'.repeat(400) })!.length).toBe(200);
  });
});
