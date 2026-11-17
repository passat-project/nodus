// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ui } from '@nodus/contracts';

import { AiMcpSection } from './ai-mcp-section.js';
import { AiProvidersSection } from './ai-providers-section.js';

/**
 * Реестры экрана «ИИ-агент» (#902): создание записи через окно (поля
 * столбиком) и фильтрация поиском. Проверяем, что действие окна уходит в
 * ОДИН PUT полной замены (канон #894), а поля читаются из i18n.
 */

const mocks = vi.hoisted(() => ({
  mcpServers: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Exa',
      url: 'https://mcp.exa.ai/mcp',
      transport: 'streamable-http' as const,
      hasKey: false,
      keyHint: null,
      enabled: true,
      defaultForSearch: true,
    },
  ],
  mcpSave: vi.fn(async (body: { servers: Array<Record<string, unknown>> }) => ({
    servers: body.servers.map((server) => ({ ...server })),
  })),
  mcpTest: vi.fn(async () => ({
    ok: true,
    latencyMs: 1,
    serverName: 'exa',
    protocolVersion: '2025-06-18',
    tools: [],
    errorCode: null,
    errorMessage: null,
  })),
  providers: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiFormat: 'openai-chat' as const,
      authType: 'bearer' as const,
      hasKey: true,
      keyHint: '1234',
      headers: [],
      enabled: true,
      models: [],
    },
  ],
  providerSave: vi.fn(async (body: Record<string, unknown>) => body),
}));

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
}));

vi.mock('../api/ai-settings.js', () => ({
  useAiSettingsQuery: () => ({
    data: {
      providers: mocks.providers,
      defaultProviderId: mocks.providers[0]?.id ?? null,
      defaultModelId: null,
      instructions: '',
      limits: { maxSteps: 12, maxRunSeconds: 120, maxToolResultChars: 16000 },
    },
    isPending: false,
    isError: false,
    refetch: () => undefined,
  }),
  useUpdateAiSettings: () => ({ mutateAsync: mocks.providerSave, isPending: false }),
}));

vi.mock('../api/mcp-settings.js', () => ({
  useMcpSettingsQuery: () => ({
    data: { servers: mocks.mcpServers },
    isPending: false,
    isError: false,
    refetch: () => undefined,
  }),
  useUpdateMcpSettings: () => ({ mutateAsync: mocks.mcpSave, isPending: false }),
  useTestMcpServer: () => ({ mutateAsync: mocks.mcpTest, isPending: false }),
}));

beforeEach(() => {
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
  mocks.mcpSave.mockClear();
  mocks.providerSave.mockClear();
});

describe('AiMcpSection: реестр MCP-серверов', () => {
  it('«Создать» открывает окно с полями столбиком и сохраняет одним PUT', async () => {
    render(<AiMcpSection section="mcp" onSection={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: ui.common.create }));

    // Пресет Exa подставляет имя/адрес; меняем имя и создаём.
    const name = screen.getByLabelText(ui.assistant.settings.mcpName) as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe('Exa'));
    fireEvent.change(name, { target: { value: 'Exa поиск' } });
    fireEvent.change(screen.getByLabelText(ui.assistant.settings.mcpUrl), {
      target: { value: 'https://mcp.exa.ai/mcp' },
    });
    fireEvent.click(screen.getByRole('button', { name: ui.common.create }));

    await waitFor(() => expect(mocks.mcpSave).toHaveBeenCalledTimes(1));
    const body = mocks.mcpSave.mock.calls[0]![0] as unknown as {
      servers: { name: string; url: string; transport: string; defaultForSearch: boolean }[];
    };
    const created = body.servers.find((server) => server.name === 'Exa поиск');
    expect(created).toMatchObject({
      url: 'https://mcp.exa.ai/mcp',
      transport: 'streamable-http',
      defaultForSearch: false,
    });
  });

  it('некорректный адрес блокирует создание и показывает подсказку', async () => {
    render(<AiMcpSection section="mcp" onSection={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: ui.common.create }));
    const url = screen.getByLabelText(ui.assistant.settings.mcpUrl);
    fireEvent.change(url, { target: { value: 'http://insecure.example/mcp' } });
    expect(await screen.findByRole('alert')).toBeTruthy();
    const submit = screen.getAllByRole('button', { name: ui.common.create }).at(-1)!;
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('строка открывает окно правки с сохранённым адресом', async () => {
    render(<AiMcpSection section="mcp" onSection={() => undefined} />);
    // Первая строка — заголовок таблицы, данные — ниже.
    fireEvent.click(screen.getAllByRole('row').at(-1)!);
    await waitFor(() => expect(screen.getByText(ui.assistant.settings.mcpEditTitle)).toBeTruthy());
    const url = screen.getByLabelText(ui.assistant.settings.mcpUrl) as HTMLInputElement;
    expect(url.value).toBe('https://mcp.exa.ai/mcp');
  });
});

describe('AiProvidersSection: реестр провайдеров (регресс #894)', () => {
  it('создание провайдера уходит одним PUT', async () => {
    render(<AiProvidersSection section="providers" onSection={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: ui.common.create }));
    const name = screen.getByLabelText(ui.assistant.settings.name) as HTMLInputElement;
    await waitFor(() => expect(name.value.length).toBeGreaterThan(0));
    fireEvent.change(name, { target: { value: 'Мой провайдер' } });
    fireEvent.click(screen.getByRole('button', { name: ui.common.create }));
    await waitFor(() => expect(mocks.providerSave).toHaveBeenCalledTimes(1));
  });

  it('поиск фильтрует строки реестра', async () => {
    render(<AiProvidersSection section="providers" onSection={() => undefined} />);
    const search = screen.getByPlaceholderText(ui.assistant.settings.searchPlaceholder);
    fireEvent.change(search, { target: { value: 'нет-такого' } });
    await waitFor(() => expect(screen.queryByText('OpenRouter')).toBeNull());
  });
});

describe('AiMcpSection: действия строки и отказы', () => {
  it('«Назначить» делает сервер основным для поиска (ровно один)', async () => {
    const original = mocks.mcpServers[0]!;
    mocks.mcpServers[0] = { ...original, defaultForSearch: false };
    try {
      render(<AiMcpSection section="mcp" onSection={() => undefined} />);
      fireEvent.click(screen.getByRole('button', { name: ui.assistant.settings.mcpDefaultAssign }));
      await waitFor(() => expect(mocks.mcpSave).toHaveBeenCalledTimes(1));
      const body = mocks.mcpSave.mock.calls[0]?.[0] as {
        servers: { id: string; defaultForSearch: boolean }[];
      };
      expect(body.servers.filter((server) => server.defaultForSearch)).toHaveLength(1);
    } finally {
      mocks.mcpServers[0] = original;
    }
  });

  it('сбой сохранения показывает ошибку и не теряет список', async () => {
    const original = mocks.mcpServers[0]!;
    mocks.mcpServers[0] = { ...original, defaultForSearch: false };
    mocks.mcpSave.mockRejectedValueOnce(new Error('boom'));
    try {
      render(<AiMcpSection section="mcp" onSection={() => undefined} />);
      fireEvent.click(screen.getByRole('button', { name: ui.assistant.settings.mcpDefaultAssign }));
      await waitFor(() => expect(mocks.mcpSave).toHaveBeenCalledTimes(1));
      // Реестр остался на экране (черновик сброшен к серверной правде).
      await waitFor(() => expect(screen.getByText('Exa')).toBeTruthy());
    } finally {
      mocks.mcpServers[0] = original;
    }
  });

  it('введённый ключ сильнее ранее нажатого «Удалить ключ»', async () => {
    const original = mocks.mcpServers[0]!;
    mocks.mcpServers[0] = {
      ...original,
      hasKey: true,
      keyHint: 'abcd',
    } as unknown as (typeof mocks.mcpServers)[number];
    try {
      render(<AiMcpSection section="mcp" onSection={() => undefined} />);
      fireEvent.click(screen.getAllByRole('row').at(-1)!);
      await screen.findByText(ui.assistant.settings.mcpEditTitle);
      fireEvent.click(screen.getByRole('button', { name: ui.assistant.settings.mcpKeyClear }));
      const key = (await screen.findByPlaceholderText(
        ui.assistant.settings.mcpKeyPlaceholder,
      )) as HTMLInputElement;
      fireEvent.change(key, { target: { value: 'sk-new-key' } });
      fireEvent.click(screen.getByRole('button', { name: ui.common.save }));

      await waitFor(() => expect(mocks.mcpSave).toHaveBeenCalledTimes(1));
      const body = mocks.mcpSave.mock.calls[0]![0] as unknown as {
        servers: Array<{ apiKey?: string; clearKey?: boolean }>;
      };
      // Ввод не теряется и не удаляет сохранённый ключ «вместе с собой».
      expect(body.servers[0]?.apiKey).toBe('sk-new-key');
      expect(body.servers[0]?.clearKey).toBe(false);
    } finally {
      mocks.mcpServers[0] = original;
    }
  });

  it('«Удалить выбранные» уходит одним PUT без выбранных серверов', async () => {
    render(<AiMcpSection section="mcp" onSection={() => undefined} />);
    fireEvent.click(screen.getAllByLabelText(ui.common.selectRow).at(-1)!);
    fireEvent.click(screen.getByRole('button', { name: ui.assistant.settings.deleteSelected }));
    fireEvent.click(screen.getByRole('button', { name: ui.assistant.settings.deleteAction }));

    await waitFor(() => expect(mocks.mcpSave).toHaveBeenCalledTimes(1));
    const body = mocks.mcpSave.mock.calls[0]![0] as unknown as {
      servers: Array<{ name: string }>;
    };
    expect(body.servers).toEqual([]);
  });

  it('правка сервера сохраняет поля тем же PUT', async () => {
    render(<AiMcpSection section="mcp" onSection={() => undefined} />);
    fireEvent.click(screen.getAllByRole('row').at(-1)!);
    const name = (await screen.findByLabelText(ui.assistant.settings.mcpName)) as HTMLInputElement;
    fireEvent.change(name, { target: { value: 'Exa (правка)' } });
    fireEvent.click(screen.getByRole('button', { name: ui.common.save }));
    await waitFor(() => expect(mocks.mcpSave).toHaveBeenCalledTimes(1));
    const body = mocks.mcpSave.mock.calls[0]![0] as unknown as { servers: { name: string }[] };
    expect(body.servers[0]?.name).toBe('Exa (правка)');
  });
});
