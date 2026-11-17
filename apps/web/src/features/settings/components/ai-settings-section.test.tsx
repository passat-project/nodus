// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
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
          defaultForSearch: true,
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
    expect(screen.getByLabelText(ui.assistant.settings.sectionsLabel)).toBeTruthy();
  });

  it('?section=skills — честное пустое состояние, «Создать» недоступно', () => {
    mocks.search = { tab: 'ai', section: 'skills' };
    render(<AiSettingsSection />);
    expect(screen.getByText(ui.assistant.settings.skillsEmptyTitle)).toBeTruthy();
    expect(screen.getByText(ui.assistant.settings.skillsEmptyBody)).toBeTruthy();
    const create = screen.getByRole('button', { name: ui.common.create }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
  });

  it('?section=mcp — реестр MCP-серверов с адресом и «по умолчанию для поиска»', () => {
    mocks.search = { tab: 'ai', section: 'mcp' };
    render(<AiSettingsSection />);
    expect(screen.getByText('Exa')).toBeTruthy();
    expect(screen.getByText('https://mcp.exa.ai/mcp')).toBeTruthy();
    expect(screen.getAllByText(ui.assistant.settings.mcpDefaultForSearch).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByRole('button', { name: ui.common.create })).toBeTruthy();
  });
});
