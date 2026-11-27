// @vitest-environment jsdom
import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';

import type { BuilderValue } from './builder-model.js';
import { AUTOSAVE_DELAY_MS, FormSaveState, useFormAutosave } from './form-autosave.js';

const b = ui.forms.builder;

/** Значение формы с меткой: тестам важна только идентичность правки. */
type Tagged = BuilderValue<never> & { tag: string };
const value = (tag: string) => ({ items: [], tag }) as unknown as Tagged;
const tagOf = (next: unknown) => (next as Tagged).tag;

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface HarnessProps {
  save?: (next: BuilderValue<never>) => Promise<void>;
  isBlocked?: (next: BuilderValue<never>) => boolean;
  /** Кнопки-правки: метка → значение, которое они пишут в форму. */
  edits?: string[];
}

/** Рама сущности с автосохранением: `saved` — форма из кэша запроса, который
 *  мутация правит оптимистично (после ответа сервера там то же значение). */
function Harness({ save, isBlocked, edits = ['a1', 'a2'] }: HarnessProps) {
  const [saved, setSaved] = useState<BuilderValue<never>>(value('server'));
  const form = useFormAutosave<never>({
    key: 'k1',
    saved,
    delay: AUTOSAVE_DELAY_MS,
    isBlocked: isBlocked ?? (() => false),
    save: async (next) => {
      await (save ?? (async () => undefined))(next);
      setSaved(next);
    },
  });
  return (
    <>
      <span data-testid="value">{tagOf(form.value)}</span>
      <FormSaveState state={form.state} onRetry={form.retry} />
      {edits.map((tag) => (
        <button key={tag} type="button" onClick={() => form.edit(value(tag))}>
          {`edit-${tag}`}
        </button>
      ))}
      <button type="button" onClick={form.flush}>
        flush
      </button>
    </>
  );
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const settle = (action: () => void) =>
  act(async () => {
    action();
  });

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('автосохранение формы создания (#857, единая модель «Процессов»)', () => {
  it('правка уходит через задержку; серия правок — одним запросом с последним значением', async () => {
    const save = vi.fn<(next: BuilderValue<never>) => Promise<void>>(async () => undefined);
    render(<Harness save={save} />);
    // Всё сохранено: строки состояния нет.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).not.toContain(b.saving);

    fireEvent.click(screen.getByRole('button', { name: 'edit-a1' }));
    expect(screen.getByTestId('value').textContent).toBe('a1');
    expect(document.body.textContent).toContain(b.saving);
    fireEvent.click(screen.getByRole('button', { name: 'edit-a2' }));
    await advance(AUTOSAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();

    await advance(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(tagOf(save.mock.calls[0]![0])).toBe('a2');
    // Сохранено: лист показывает то же значение, строка состояния ушла.
    expect(screen.getByTestId('value').textContent).toBe('a2');
    expect(document.body.textContent).not.toContain(b.saving);
  });

  it('flush сохраняет недавнюю правку сразу — уход с вкладки', () => {
    const save = vi.fn<(next: BuilderValue<never>) => Promise<void>>(async () => undefined);
    render(<Harness save={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'edit-a1' }));
    fireEvent.click(screen.getByRole('button', { name: 'flush' }));
    expect(save).toHaveBeenCalledTimes(1);
    // Повторный flush пуст: сохранять нечего.
    fireEvent.click(screen.getByRole('button', { name: 'flush' }));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('размонтирование до задержки (смена сущности, уход из раздела) сохраняет сразу', async () => {
    const save = vi.fn<(next: BuilderValue<never>) => Promise<void>>(async () => undefined);
    const view = render(<Harness save={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'edit-a1' }));
    view.unmount();
    expect(save).toHaveBeenCalledTimes(1);
    await advance(AUTOSAVE_DELAY_MS * 2);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('ошибка держит черновик: «Не сохранилось» и «Повторить»; повтор сохраняет', async () => {
    const first = deferred();
    const save = vi
      .fn<(next: BuilderValue<never>) => Promise<void>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async () => undefined);
    render(<Harness save={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'edit-a1' }));
    await advance(AUTOSAVE_DELAY_MS);
    await settle(() => first.reject(new Error('network')));
    // Лист держит правку, строка бара — ошибка с действием.
    expect(screen.getByTestId('value').textContent).toBe('a1');
    expect(screen.getByRole('alert').textContent).toContain(b.notSaved);
    // Ошибка не запускает новых попыток сама.
    await advance(AUTOSAVE_DELAY_MS * 3);
    expect(save).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: b.retry }));
    await advance(0);
    expect(save).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.body.textContent).not.toContain(b.saving);
  });

  it('негодная правка (пустой заголовок/пояснение) не уходит: подсказка прежним текстом, сохранение ждёт', async () => {
    const save = vi.fn<(next: BuilderValue<never>) => Promise<void>>(async () => undefined);
    const isBlocked = (next: BuilderValue<never>) => tagOf(next) === 'bad';
    render(<Harness save={save} isBlocked={isBlocked} edits={['bad', 'a1']} />);
    fireEvent.click(screen.getByRole('button', { name: 'edit-bad' }));
    expect(screen.getByTestId('value').textContent).toBe('bad');
    expect(document.body.textContent).toContain(b.decorEmpty);
    await advance(AUTOSAVE_DELAY_MS * 3);
    expect(save).not.toHaveBeenCalled();
    // Следующая годная правка уходит как обычно.
    fireEvent.click(screen.getByRole('button', { name: 'edit-a1' }));
    await advance(AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain(b.decorEmpty);
  });

  it('негодную правку уходом не сохраняют: она ждёт продолжения на месте', () => {
    const save = vi.fn<(next: BuilderValue<never>) => Promise<void>>(async () => undefined);
    const isBlocked = (next: BuilderValue<never>) => tagOf(next) === 'bad';
    const view = render(<Harness save={save} isBlocked={isBlocked} edits={['bad']} />);
    fireEvent.click(screen.getByRole('button', { name: 'edit-bad' }));
    view.unmount();
    expect(save).not.toHaveBeenCalled();
  });

  it('один запрос в полёте: правка во время запроса уходит после его ответа', async () => {
    const first = deferred();
    const save = vi
      .fn<(next: BuilderValue<never>) => Promise<void>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async () => undefined);
    render(<Harness save={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'edit-a1' }));
    await advance(AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    // Пока первый запрос в полёте — вторая правка копится, не отправляется.
    fireEvent.click(screen.getByRole('button', { name: 'edit-a2' }));
    await advance(AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(b.saving);
    await settle(() => first.resolve());
    // Первый завершён: правка новее сохранённого уходит следом.
    await advance(AUTOSAVE_DELAY_MS);
    expect(save).toHaveBeenCalledTimes(2);
    expect(tagOf(save.mock.calls[1]![0])).toBe('a2');
  });

  it('правка во время запроса + уход: уходит сразу после ответа, не по таймеру', async () => {
    const first = deferred();
    const save = vi
      .fn<(next: BuilderValue<never>) => Promise<void>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async () => undefined);
    const view = render(<Harness save={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'edit-a1' }));
    await advance(AUTOSAVE_DELAY_MS);
    fireEvent.click(screen.getByRole('button', { name: 'edit-a2' }));
    view.unmount();
    expect(save).toHaveBeenCalledTimes(1);
    await settle(() => first.resolve());
    expect(save).toHaveBeenCalledTimes(2);
    expect(tagOf(save.mock.calls[1]![0])).toBe('a2');
  });

  it('черновик с ошибкой переживает уход: вернувшись, видно правку и «Не сохранилось»', async () => {
    const save = vi.fn<(next: BuilderValue<never>) => Promise<void>>(async () => {
      throw new Error('network');
    });
    const first = render(<Harness save={save} />);
    fireEvent.click(screen.getByRole('button', { name: 'edit-a1' }));
    await advance(AUTOSAVE_DELAY_MS);
    expect(screen.getByRole('alert')).toBeTruthy();
    first.unmount();

    render(<Harness save={save} />);
    expect(screen.getByTestId('value').textContent).toBe('a1');
    expect(screen.getByRole('alert').textContent).toContain(b.notSaved);
    // Возврат сам не повторяет попытку: решение за сотрудником.
    await advance(AUTOSAVE_DELAY_MS * 3);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
