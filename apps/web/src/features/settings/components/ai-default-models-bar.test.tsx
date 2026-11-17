// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui, type AiSettingsBody } from '@nodus/contracts';

import { AiDefaultModelsBar } from './ai-default-models-bar.js';
import type { ProviderDraft } from './ai-provider-columns.js';

/**
 * Полоса «Модели по умолчанию» (#917): основная модель и модель-диспетчер
 * живут в разделе «Провайдеры». Тесты держат пару «провайдер + модель»:
 * выбор провайдера подставляет его первую включённую модель, выключенные
 * модели в список не попадают, без провайдера модель недоступна.
 */

const strings = ui.assistant.settings;

function provider(overrides: Partial<ProviderDraft> = {}): ProviderDraft {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    apiFormat: 'openai-chat',
    authType: 'bearer',
    headers: [],
    enabled: true,
    models: [
      { id: 'm-main', tools: true, vision: false, enabled: true },
      { id: 'm-off', tools: true, vision: false, enabled: false },
    ],
    persisted: true,
    hasKey: true,
    keyHint: null,
    ...overrides,
  };
}

function draft(overrides: Partial<AiSettingsBody> = {}): AiSettingsBody {
  return {
    providers: [],
    defaultProviderId: null,
    defaultModelId: null,
    routerProviderId: null,
    routerModelId: null,
    instructions: '',
    ...overrides,
  };
}

beforeEach(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

afterEach(() => {
  cleanup();
});

describe('AiDefaultModelsBar (#917)', () => {
  it('показывает выбранную основную пару и выключенный диспетчер', () => {
    render(
      <AiDefaultModelsBar
        draft={draft({
          defaultProviderId: '11111111-1111-4111-8111-111111111111',
          defaultModelId: 'm-main',
        })}
        providers={[provider()]}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText(`${strings.defaultTitle}:`)).toBeTruthy();
    expect(screen.getByText(`${strings.routerTitle}:`)).toBeTruthy();
    const comboboxes = screen.getAllByRole('combobox');
    expect(comboboxes.map((item) => item.textContent)).toEqual([
      'OpenRouter',
      'm-main',
      strings.routerOff,
      strings.defaultNone,
    ]);
    // Модель-диспетчер не выбран — модель недоступна до выбора провайдера.
    expect((comboboxes[3] as HTMLButtonElement).disabled).toBe(true);
  });

  it('выбор провайдера диспетчера подставляет его первую включённую модель', () => {
    const onChange = vi.fn();
    render(<AiDefaultModelsBar draft={draft()} providers={[provider()]} onChange={onChange} />);
    // Третий комбобокс — провайдер модели-диспетчера.
    const routerTrigger = screen.getAllByRole('combobox')[2]!;
    fireEvent.keyDown(routerTrigger, { key: 'ArrowDown' });
    const option = screen
      .getAllByRole('option')
      .find((item) => item.textContent?.includes('OpenRouter'));
    expect(option).toBeTruthy();
    fireEvent.click(option!);
    expect(onChange).toHaveBeenCalledWith({
      routerProviderId: '11111111-1111-4111-8111-111111111111',
      routerModelId: 'm-main',
    });
  });

  it('провайдер без включённых моделей очищает пару диспетчера целиком', () => {
    const onChange = vi.fn();
    const disabled = provider({
      models: [{ id: 'm-off', tools: true, vision: false, enabled: false }],
    });
    render(<AiDefaultModelsBar draft={draft()} providers={[disabled]} onChange={onChange} />);
    const routerTrigger = screen.getAllByRole('combobox')[2]!;
    fireEvent.keyDown(routerTrigger, { key: 'ArrowDown' });
    const option = screen
      .getAllByRole('option')
      .find((item) => item.textContent?.includes('OpenRouter'));
    fireEvent.click(option!);
    // Без модели пара невалидна для PUT (refine) — провайдер тоже снимается.
    expect(onChange).toHaveBeenCalledWith({ routerProviderId: null, routerModelId: null });
  });

  it('без провайдеров полоса пустая — не рисует пустые пары', () => {
    const { container } = render(
      <AiDefaultModelsBar draft={draft()} providers={[]} onChange={() => undefined} />,
    );
    expect(container.textContent).toBe('');
  });
});
