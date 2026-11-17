// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ui } from '@nodus/contracts';

import { AiSettingsSection } from './ai-settings-section.js';
import { parseAiSettingsSection } from './ai-section-switcher.js';

/**
 * Экран «Настройки портала → ИИ-агент» (#902): разделы Провайдеры / Навыки /
 * MCP с выбором раздела в тулбаре (в URL `?section=`). Проверяем: разбор
 * секции из URL, честное пустое состояние «Навыков» и реестр MCP.
 */

const mocks = vi.hoisted(() => ({
  search: {} as { tab?: string; section?: string },
  navigate: vi.fn(),
  providers: {
    data: {
      providers: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'OpenRouter',
          baseUrl: 'https://openrouter.ai/api/v1',
          apiFormat: 'openai-chat',
          authType: 'bearer',
          hasKey: true,
          keyHint: '1234',
          headers: [],
          enabled: true,
          models: [],
        },
      ],
      defaultProviderId: '11111111-1111-4111-8111-111111111111',
      defaultModelId: null,
      instructions: '',
      limits: { maxSteps: 12, maxRunSeconds: 120, maxToolResultChars: 16000 },
    },
    isPending: false,
    isError: false,
    refetch: () => undefined,
  },
  mcp: {
    data: {
      servers: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Exa',
          url: 'https://mcp.exa.ai/mcp',
          transport: 'streamable-http' as const,
          hasKey: true,
          keyHint: 'abcd',
          enabled: true,
        },
      ],
    },
    isPending: false,
    isError: false,
    refetch: () => undefined,
  },
}));

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => mocks.search,
  useNavigate: () => mocks.navigate,
}));

vi.mock('../api/ai-settings.js', () => ({
  useAiSettingsQuery: () => mocks.providers,
  useUpdateAiSettings: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const mcpMutations = vi.hoisted(() => ({ save: vi.fn(), test: vi.fn() }));

vi.mock('../api/mcp-settings.js', () => ({
  useMcpSettingsQuery: () => mocks.mcp,
  useUpdateMcpSettings: () => ({ mutateAsync: mcpMutations.save, isPending: false }),
  useTestMcpServer: () => ({ mutateAsync: mcpMutations.test, isPending: false }),
}));

beforeEach(() => {
  // DataTable/resize-контролы измеряют ширины — в jsdom его нет.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // Radix Select (переключатель разделов) требует pointer capture и
  // scrollIntoView — в jsdom их нет, без заглушек меню не открывается.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => undefined;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  mocks.search = {};
});

describe('parseAiSettingsSection: секция из URL', () => {
  it('известные значения проходят, мусор → «Провайдеры»', () => {
    expect(parseAiSettingsSection('providers')).toBe('providers');
    expect(parseAiSettingsSection('skills')).toBe('skills');
    expect(parseAiSettingsSection('mcp')).toBe('mcp');
    expect(parseAiSettingsSection(undefined)).toBe('providers');
    expect(parseAiSettingsSection('нечто')).toBe('providers');
  });
});

describe('AiSettingsSection: разделы экрана', () => {
  it('по умолчанию — реестр провайдеров и переключатель разделов', () => {
    render(<AiSettingsSection />);
    expect(screen.getByText(ui.assistant.settings.title)).toBeTruthy();
    expect(screen.getByText('OpenRouter')).toBeTruthy();
    // Триггер поповера (канон «Портфелей»): подпись включает текущий раздел.
    expect(
      screen.getByRole('button', {
        name: `${ui.assistant.settings.sectionsLabel}: ${ui.assistant.settings.sectionProviders}`,
      }),
    ).toBeTruthy();
  });

  it('?section=skills — честное пустое состояние, «Создать» недоступно', () => {
    mocks.search = { tab: 'ai', section: 'skills' };
    render(<AiSettingsSection />);
    expect(screen.getByText(ui.assistant.settings.skillsEmptyTitle)).toBeTruthy();
    expect(screen.getByText(ui.assistant.settings.skillsEmptyBody)).toBeTruthy();
    const create = screen.getByRole('button', { name: ui.common.create }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
  });

  it('выбор раздела в переключателе уходит в URL (?section=mcp)', async () => {
    render(<AiSettingsSection />);
    // Триггер — кнопка канона «Портфелей» (не системный Select): имя включает
    // текущий раздел, список — строки-кнопки.
    const trigger = screen.getByRole('button', {
      name: `${ui.assistant.settings.sectionsLabel}: ${ui.assistant.settings.sectionProviders}`,
    });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole('button', { name: ui.assistant.settings.sectionMcp }));

    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/settings',
      search: expect.any(Function),
    });
    const call = mocks.navigate.mock.calls[0]![0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(call.search({ tab: 'ai', section: 'providers' })).toEqual({
      tab: 'ai',
      section: 'mcp',
    });
  });

  it('поиск в разделе MCP фильтрует серверы по имени и адресу', () => {
    mocks.search = { tab: 'ai', section: 'mcp' };
    render(<AiSettingsSection />);
    const search = screen.getByPlaceholderText(ui.assistant.settings.mcpSearchPlaceholder);
    fireEvent.change(search, { target: { value: 'exa.ai' } });
    expect(screen.getByText('Exa')).toBeTruthy();
    fireEvent.change(search, { target: { value: 'нет-такого' } });
    expect(screen.queryByText('Exa')).toBeNull();
  });

  it('?section=mcp — реестр MCP-серверов без понятия «по умолчанию»', () => {
    mocks.search = { tab: 'ai', section: 'mcp' };
    render(<AiSettingsSection />);
    expect(screen.getByText('Exa')).toBeTruthy();
    expect(screen.getByText('https://mcp.exa.ai/mcp')).toBeTruthy();
    // MCP-серверы равнозначны (решение владельца 18.11.2026): столбца и
    // действия «по умолчанию для поиска» на экране нет.
    expect(screen.queryByText('По умолчанию для поиска')).toBeNull();
    expect(screen.getByRole('button', { name: ui.common.create })).toBeTruthy();
  });
});
