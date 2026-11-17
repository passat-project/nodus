// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ui, type AssistantModel } from '@nodus/contracts';

const h = vi.hoisted(() => ({
  loadModels: vi.fn(),
  testProvider: vi.fn(),
  loadAsync: vi.fn(),
  testAsync: vi.fn(),
}));

vi.mock('../api/ai-settings.js', () => ({
  useProviderModels: h.loadModels,
  useTestProvider: h.testProvider,
}));

import { AiProviderModels } from './ai-provider-models.js';
import type { ProviderDraft } from './ai-provider-columns.js';

/**
 * Блок «Модели» окна провайдера (#894): каталог («Загрузить модели»),
 * проверка соединения, тумблер включённости модели, удаление и ручное
 * добавление. Модели и тест доступны только сохранённому провайдеру.
 */

const strings = ui.assistant.settings;

function model(overrides: Partial<AssistantModel> = {}): AssistantModel {
  return {
    id: 'm-1',
    tools: true,
    vision: false,
    enabled: true,
    ...overrides,
  };
}

function draft(overrides: Partial<ProviderDraft> = {}): ProviderDraft {
  return {
    id: 'p-1',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiFormat: 'openai-chat',
    authType: 'bearer',
    headers: [],
    enabled: true,
    models: [],
    persisted: true,
    hasKey: false,
    keyHint: null,
    ...overrides,
  };
}

function renderModels(provider: ProviderDraft) {
  const onChange = vi.fn();
  const result = render(<AiProviderModels provider={provider} onChange={onChange} />);
  return { ...result, onChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.loadModels.mockReturnValue({ mutateAsync: h.loadAsync, isPending: false });
  h.testProvider.mockReturnValue({ mutateAsync: h.testAsync, isPending: false });
});

afterEach(cleanup);

describe('AiProviderModels: каталог и проверка соединения', () => {
  it('пустой каталог — подсказка «Моделей нет», действия на месте', () => {
    renderModels(draft());

    expect(screen.getByText(strings.modelsEmpty)).toBeTruthy();
    expect(screen.getByRole('button', { name: strings.loadModels })).toBeTruthy();
    expect(screen.getByRole('button', { name: strings.test })).toBeTruthy();
  });

  it('«Загрузить модели» сливает каталог с сохранёнными настройками модели', async () => {
    h.loadAsync.mockResolvedValue({
      models: [
        {
          id: 'm-1',
          label: 'Каталожная подпись',
          contextWindow: 128000,
          maxOutput: 4096,
          inputPricePerM: 0.5,
          outputPricePerM: 1.5,
        },
        {
          id: 'm-2',
          label: null,
          contextWindow: null,
          maxOutput: null,
          inputPricePerM: null,
          outputPricePerM: null,
        },
      ],
    });
    const { onChange } = renderModels(
      draft({
        models: [model({ id: 'm-1', label: 'Своя подпись', vision: true, enabled: false })],
      }),
    );

    fireEvent.click(screen.getByRole('button', { name: strings.loadModels }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());

    expect(h.loadAsync).toHaveBeenCalledWith('p-1');
    const models = onChange.mock.calls[0]![0].models as AssistantModel[];
    // Каталог обогащает модель, но пользовательские флаги/подпись сохраняются.
    expect(models[0]).toMatchObject({
      id: 'm-1',
      label: 'Своя подпись',
      vision: true,
      enabled: false,
      contextWindow: 128000,
      maxOutput: 4096,
      inputPricePerM: 0.5,
      outputPricePerM: 1.5,
    });
    // Новая модель каталога — включена, tools по умолчанию, без vision.
    expect(models[1]).toMatchObject({ id: 'm-2', tools: true, vision: false, enabled: true });
  });

  it('ошибка загрузки каталога — строка статуса с причиной', async () => {
    h.loadAsync.mockRejectedValue(new Error('network'));
    renderModels(draft());

    fireEvent.click(screen.getByRole('button', { name: strings.loadModels }));

    const status = await screen.findByRole('status');
    expect(status.textContent).toBe(`${strings.testFailed}: ${strings.loadModels}`);
    expect(status.className).toContain('text-destructive');
  });

  it('«Проверить»: успех показывает задержку и модель', async () => {
    h.testAsync.mockResolvedValue({
      ok: true,
      latencyMs: 42,
      model: 'm-1',
      sample: 'ok',
      errorCode: null,
      errorMessage: null,
    });
    renderModels(draft());

    fireEvent.click(screen.getByRole('button', { name: strings.test }));

    const status = await screen.findByRole('status');
    expect(h.testAsync).toHaveBeenCalledWith('p-1');
    expect(status.textContent).toBe(`${strings.testOk}: 42 ${ui.assistant.ms}, m-1`);
    expect(status.className).toContain('text-success');
  });

  it('«Проверить»: провал показывает текст/код ошибки', async () => {
    h.testAsync.mockResolvedValue({
      ok: false,
      latencyMs: 0,
      model: null,
      sample: null,
      errorCode: 'provider_auth',
      errorMessage: '401 Unauthorized',
    });
    renderModels(draft());

    fireEvent.click(screen.getByRole('button', { name: strings.test }));

    const status = await screen.findByRole('status');
    expect(status.textContent).toBe(`${strings.testFailed}: 401 Unauthorized`);
  });

  it('«Проверить»: без текста ошибки берётся код, исключение — общий текст', async () => {
    h.testAsync.mockResolvedValueOnce({
      ok: false,
      latencyMs: 0,
      model: null,
      sample: null,
      errorCode: 'provider_error',
      errorMessage: null,
    });
    const first = renderModels(draft());
    fireEvent.click(screen.getByRole('button', { name: strings.test }));
    expect((await screen.findByRole('status')).textContent).toBe(
      `${strings.testFailed}: provider_error`,
    );
    cleanup();
    first.onChange.mockClear();

    h.testAsync.mockRejectedValueOnce(new Error('boom'));
    renderModels(draft());
    fireEvent.click(screen.getByRole('button', { name: strings.test }));
    expect((await screen.findByRole('status')).textContent).toBe(strings.testFailed);
  });

  it('несохранённый провайдер: загрузка и проверка недоступны', () => {
    renderModels(draft({ persisted: false }));
    expect(
      (screen.getByRole('button', { name: strings.loadModels }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole('button', { name: strings.test }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('идёт загрузка/проверка — подписи меняются, крутится спиннер', () => {
    h.loadModels.mockReturnValue({ mutateAsync: h.loadAsync, isPending: true });
    h.testProvider.mockReturnValue({ mutateAsync: h.testAsync, isPending: true });
    const { container } = renderModels(draft());

    expect(screen.getByRole('button', { name: strings.loadingModels })).toBeTruthy();
    expect(screen.getByRole('button', { name: strings.testing })).toBeTruthy();
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });
});

describe('AiProviderModels: список моделей', () => {
  it('строка модели: id, подпись, контекст и кнопка удаления', () => {
    renderModels(
      draft({
        models: [
          model({ id: 'm-1', label: 'Основная', contextWindow: 200000 }),
          model({ id: 'm-2', enabled: false }),
        ],
      }),
    );

    expect(screen.getByText('m-1')).toBeTruthy();
    expect(screen.getByText('Основная')).toBeTruthy();
    expect(screen.getByText('200000')).toBeTruthy();
    expect(screen.queryByText(strings.modelsEmpty)).toBeNull();
  });

  it('тумблер меняет enabled только своей модели', () => {
    const { onChange } = renderModels(
      draft({ models: [model({ id: 'm-1' }), model({ id: 'm-2', enabled: false })] }),
    );

    fireEvent.click(screen.getByRole('switch', { name: `${strings.enabled}: m-1` }));

    const models = onChange.mock.calls[0]![0].models as AssistantModel[];
    expect(models[0]!.enabled).toBe(false);
    expect(models[1]!.enabled).toBe(false);
  });

  it('удаление модели убирает её из списка', () => {
    const { onChange } = renderModels(
      draft({ models: [model({ id: 'm-1' }), model({ id: 'm-2' })] }),
    );

    fireEvent.click(screen.getByRole('button', { name: `${strings.remove}: m-1` }));

    expect(onChange).toHaveBeenCalledWith({ models: [expect.objectContaining({ id: 'm-2' })] });
  });
});

describe('AiProviderModels: ручное добавление', () => {
  it('id обязателен; добавление кнопкой возвращает модель с безопасными флагами', () => {
    const { onChange } = renderModels(draft());
    fireEvent.click(screen.getByRole('button', { name: strings.addModelManually }));

    const add = screen.getByRole('button', { name: ui.common.add }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);

    fireEvent.change(screen.getByRole('textbox', { name: strings.modelId }), {
      target: { value: '  custom-model  ' },
    });
    fireEvent.click(add);

    expect(onChange).toHaveBeenCalledWith({
      models: [{ id: 'custom-model', tools: true, vision: false, enabled: true }],
    });
    // Форма закрылась после добавления.
    expect(screen.queryByRole('textbox', { name: strings.modelId })).toBeNull();
  });

  it('Enter добавляет модель, Escape закрывает форму без изменений', () => {
    const { onChange } = renderModels(draft({ models: [model({ id: 'm-1' })] }));
    fireEvent.click(screen.getByRole('button', { name: strings.addModelManually }));
    const input = screen.getByRole('textbox', { name: strings.modelId });

    fireEvent.change(input, { target: { value: 'typed-model' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith({
      models: [
        expect.objectContaining({ id: 'm-1' }),
        { id: 'typed-model', tools: true, vision: false, enabled: true },
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: strings.addModelManually }));
    const second = screen.getByRole('textbox', { name: strings.modelId });
    fireEvent.keyDown(second, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: strings.modelId })).toBeNull();
  });
});
