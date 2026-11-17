// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ASSISTANT_PROVIDER_PRESETS, ui, type AssistantModel } from '@nodus/contracts';

vi.mock('./ai-provider-models.js', () => ({
  AiProviderModels: () => <div data-testid="provider-models">модели</div>,
}));

import { AiProviderDialog } from './ai-provider-dialog.js';
import type { ProviderDraft } from './ai-provider-columns.js';

/**
 * Окно провайдера (#894): создание через пресеты строками, правка полей,
 * дефолт портала (тумблер + обязательная модель), состояние ключа
 * («Заменить»/«Удалить»), адрес валидируется, отмена/ошибки не закрывают
 * окно мимо-кликом.
 */

const strings = ui.assistant.settings;

function model(overrides: Partial<AssistantModel> = {}): AssistantModel {
  return { id: 'm-1', tools: true, vision: false, enabled: true, ...overrides };
}

function provider(overrides: Partial<ProviderDraft> = {}): ProviderDraft {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiFormat: 'openai-chat',
    authType: 'bearer',
    headers: [],
    enabled: true,
    models: [model()],
    persisted: true,
    hasKey: false,
    keyHint: null,
    ...overrides,
  };
}

function renderCreate() {
  const onCreate = vi.fn();
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    <AiProviderDialog
      mode={{ kind: 'create' }}
      defaultProviderId={null}
      defaultModelId={null}
      instructions=""
      onClose={onClose}
      onCreate={onCreate}
      onApply={onApply}
    />,
  );
  return { onCreate, onApply, onClose };
}

function renderEdit(
  draft: ProviderDraft,
  options: { defaultProviderId?: string | null; defaultModelId?: string | null } = {},
) {
  const onCreate = vi.fn();
  const onApply = vi.fn();
  const onClose = vi.fn();
  render(
    <AiProviderDialog
      mode={{ kind: 'edit', provider: draft }}
      defaultProviderId={options.defaultProviderId ?? null}
      defaultModelId={options.defaultModelId ?? null}
      instructions="Будь краток"
      onClose={onClose}
      onCreate={onCreate}
      onApply={onApply}
    />,
  );
  return { onCreate, onApply, onClose };
}

function submit(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

const nameInput = () => screen.getByRole('textbox', { name: strings.name }) as HTMLInputElement;
const urlInput = () => screen.getByRole('textbox', { name: strings.baseUrl }) as HTMLInputElement;

beforeEach(() => {
  const matchMedia = (query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  });
  vi.stubGlobal('matchMedia', matchMedia);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AiProviderDialog: создание', () => {
  it('пресет по умолчанию заполняет название и адрес, блока моделей нет', () => {
    renderCreate();

    expect(screen.getByText(strings.createTitle)).toBeTruthy();
    expect(nameInput().value).toBe(ASSISTANT_PROVIDER_PRESETS[0]!.name);
    expect(urlInput().value).toBe(ASSISTANT_PROVIDER_PRESETS[0]!.baseUrl);
    expect(screen.getByRole('radiogroup', { name: strings.pickPreset })).toBeTruthy();
    expect(screen.queryByTestId('provider-models')).toBeNull();
  });

  it('выбор пресета строками подставляет его поля', () => {
    renderCreate();

    fireEvent.click(screen.getByRole('radio', { name: /OpenRouter/ }));

    expect(nameInput().value).toBe('OpenRouter');
    expect(urlInput().value).toBe('https://openrouter.ai/api/v1');
  });

  it('«Создать» отдаёт обрезанные поля и введённый ключ, затем закрывает окно', () => {
    const { onCreate, onApply, onClose } = renderCreate();
    fireEvent.change(nameInput(), { target: { value: '  Мой провайдер  ' } });
    fireEvent.change(urlInput(), { target: { value: '  https://api.example.com/v1  ' } });
    fireEvent.change(screen.getByLabelText(strings.apiKey), { target: { value: ' sk-1 ' } });

    submit(ui.common.create);

    expect(onCreate).toHaveBeenCalledWith({
      name: 'Мой провайдер',
      baseUrl: 'https://api.example.com/v1',
      authType: 'bearer',
      apiKey: 'sk-1',
    });
    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('без ключа apiKey в создание не попадает', () => {
    const { onCreate } = renderCreate();
    submit(ui.common.create);
    expect(onCreate).toHaveBeenCalled();
    expect(Object.keys(onCreate.mock.calls[0]![0] as object)).toEqual([
      'name',
      'baseUrl',
      'authType',
    ]);
  });

  it('невалидный адрес: подсказка, aria-invalid и заблокированный submit', () => {
    renderCreate();
    fireEvent.change(urlInput(), { target: { value: 'https://user:pass@api.example/v1' } });

    expect(screen.getByRole('alert').textContent).toBe(strings.urlInvalid);
    expect(urlInput().getAttribute('aria-invalid')).toBe('true');
    expect(
      (screen.getByRole('button', { name: ui.common.create }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('пустое название блокирует создание', () => {
    renderCreate();
    fireEvent.change(nameInput(), { target: { value: '   ' } });
    expect(
      (screen.getByRole('button', { name: ui.common.create }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('«Отмена» закрывает окно без создания', () => {
    const { onCreate, onClose } = renderCreate();
    submit(ui.common.cancel);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('Esc закрывает окно через onClose', () => {
    const { onClose } = renderCreate();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('AiProviderDialog: правка', () => {
  it('поля заполнены сущностью, заголовок правки, пресетов нет, модели есть', () => {
    renderEdit(provider({ name: 'Мой', baseUrl: 'https://api.example.com/v1' }));

    expect(screen.getByText(strings.editTitle)).toBeTruthy();
    expect(nameInput().value).toBe('Мой');
    expect(urlInput().value).toBe('https://api.example.com/v1');
    expect(screen.queryByRole('radiogroup', { name: strings.pickPreset })).toBeNull();
    expect(screen.getByTestId('provider-models')).toBeTruthy();
  });

  it('дефолт: тумблер сам выбирает первую включённую модель, сохранение отдаёт дефолт и правила', () => {
    const draft = provider({
      models: [model({ id: 'm-off', enabled: false }), model({ id: 'm-on' })],
    });
    const { onApply, onClose } = renderEdit(draft);
    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[1]!);

    // Модель по умолчанию обязательна — ошибки нет, выбрана первая включённая.
    expect(screen.queryByText(strings.defaultModelRequired)).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: strings.instructionsTitle }), {
      target: { value: 'Отвечай по-русски' },
    });

    submit(ui.common.save);

    expect(onApply).toHaveBeenCalledWith(
      draft.id,
      expect.objectContaining({
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        enabled: true,
        models: draft.models,
      }),
      { defaultProviderId: draft.id, defaultModelId: 'm-on' },
      'Отвечай по-русски',
    );
    expect(onClose).toHaveBeenCalled();
  });

  it('тумблер дефолта без включённых моделей требует модель и блокирует сохранение', () => {
    renderEdit(provider({ models: [model({ enabled: false })] }));
    fireEvent.click(screen.getAllByRole('switch')[1]!);

    expect(screen.getByRole('alert').textContent).toBe(strings.defaultModelRequired);
    expect(
      (screen.getByRole('button', { name: ui.common.save }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('снятие дефолта с текущего провайдера очищает пару дефолта', () => {
    const draft = provider();
    const { onApply } = renderEdit(draft, {
      defaultProviderId: draft.id,
      defaultModelId: 'm-1',
    });
    // Провайдер уже дефолтный: тумблер включён и модель подставлена.
    expect(screen.getByRole('combobox', { name: strings.defaultModel }).textContent).toBe('m-1');
    fireEvent.click(screen.getAllByRole('switch')[1]!);

    submit(ui.common.save);

    expect(onApply).toHaveBeenCalledWith(
      draft.id,
      expect.any(Object),
      { defaultProviderId: null, defaultModelId: null },
      'Будь краток',
    );
  });

  it('сохранённый ключ: «Заменить» показывает поле и новый ключ уходит в патч', () => {
    const draft = provider({ hasKey: true, keyHint: 'abcd' });
    const { onApply } = renderEdit(draft);

    expect(screen.getByText(`${strings.apiKeyStored} (…abcd)`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: strings.apiKeyReplace }));
    fireEvent.change(screen.getByLabelText(strings.apiKey), { target: { value: 'sk-new' } });

    submit(ui.common.save);

    expect(onApply.mock.calls[0]![1]).toMatchObject({ apiKey: 'sk-new', clearKey: false });
  });

  it('«Удалить ключ» помечает clearKey и скрывает признак ключа', () => {
    const draft = provider({ hasKey: true, keyHint: 'abcd' });
    const { onApply } = renderEdit(draft);

    fireEvent.click(screen.getByRole('button', { name: strings.apiKeyClear }));
    submit(ui.common.save);

    expect(onApply.mock.calls[0]![1]).toMatchObject({
      clearKey: true,
      apiKey: undefined,
      hasKey: false,
      keyHint: null,
    });
  });

  it('тумблер «Включён» и дополнительные заголовки уходят в патч', () => {
    const { onApply } = renderEdit(provider());
    fireEvent.click(screen.getAllByRole('switch')[0]!);
    fireEvent.click(screen.getByRole('button', { name: strings.addHeader }));
    fireEvent.change(screen.getAllByRole('textbox', { name: strings.headerName })[0]!, {
      target: { value: 'HTTP-Referer' },
    });
    fireEvent.change(screen.getAllByRole('textbox', { name: strings.headerValue })[0]!, {
      target: { value: 'https://nodus.by' },
    });

    submit(ui.common.save);

    expect(onApply.mock.calls[0]![1]).toMatchObject({
      enabled: false,
      headers: [{ name: 'HTTP-Referer', value: 'https://nodus.by' }],
    });
  });

  it('невалидный адрес и пустое имя блокируют сохранение', () => {
    renderEdit(provider());
    fireEvent.change(urlInput(), { target: { value: 'ftp://bad' } });
    expect(screen.getByRole('alert').textContent).toBe(strings.urlInvalid);
    expect(
      (screen.getByRole('button', { name: ui.common.save }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(urlInput(), { target: { value: 'https://api.example.com/v1' } });
    fireEvent.change(nameInput(), { target: { value: '' } });
    expect(
      (screen.getByRole('button', { name: ui.common.save }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
