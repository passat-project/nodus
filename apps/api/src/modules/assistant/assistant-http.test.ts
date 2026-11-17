import { describe, expect, it, vi } from 'vitest';
import { firstValueFrom, of } from 'rxjs';
import type { AuthUser } from '@nodus/contracts';

import { AssistantRunsController } from './assistant-runs.controller.js';
import { AssistantSessionsController } from './assistant-sessions.controller.js';
import { AiSettingsController } from './providers/ai-settings.controller.js';

/**
 * HTTP-слой ассистента (#893, #894, #896): контроллеры только делегируют
 * сервисам — но именно здесь path-параметры, заголовок Last-Event-ID и форма
 * SSE-события. Тест держит контракт маршрутов и маппинг событий.
 */

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const PROVIDER_ID = '44444444-4444-4444-8444-444444444444';

const user: AuthUser = {
  id: USER_ID,
  email: 'ivanov@nodus.by',
  displayName: 'Иванов Иван',
  permissions: ['assistant.use', 'portal.settings.manage'],
};

describe('AssistantSessionsController (#893)', () => {
  function make() {
    const sessions = {
      list: vi.fn(async () => 'list'),
      create: vi.fn(async () => 'created'),
      update: vi.fn(async () => 'updated'),
      messages: vi.fn(async () => 'messages'),
      sendMessage: vi.fn(async () => ({ runId: RUN_ID, messageId: SESSION_ID })),
    };
    return { controller: new AssistantSessionsController(sessions as never), sessions };
  }

  it('делегирует все методы с владельцем и токеном сотрудника', async () => {
    const { controller, sessions } = make();
    await expect(controller.list(user)).resolves.toBe('list');
    await expect(controller.create(user, { title: 'Диалог' })).resolves.toBe('created');
    await expect(controller.update(user, SESSION_ID, { archived: true })).resolves.toBe('updated');
    await expect(controller.messages(user, SESSION_ID)).resolves.toBe('messages');
    await expect(
      controller.send(user, SESSION_ID, 'Bearer token', { text: 'Привет' }),
    ).resolves.toEqual({ runId: RUN_ID, messageId: SESSION_ID });

    expect(sessions.create).toHaveBeenCalledWith(user, { title: 'Диалог' });
    expect(sessions.update).toHaveBeenCalledWith(user, SESSION_ID, { archived: true });
    expect(sessions.messages).toHaveBeenCalledWith(user, SESSION_ID);
    // Токен уходит дословно; отсутствие заголовка не даёт undefined в контексте.
    expect(sessions.sendMessage).toHaveBeenCalledWith(
      user,
      SESSION_ID,
      { text: 'Привет' },
      'Bearer token',
    );
  });

  it('без заголовка Authorization передаёт пустую строку', async () => {
    const { controller, sessions } = make();
    await controller.send(user, SESSION_ID, undefined, { text: 'Привет' });
    expect(sessions.sendMessage).toHaveBeenLastCalledWith(user, SESSION_ID, { text: 'Привет' }, '');
  });
});

describe('AssistantRunsController: SSE и отмена (#893)', () => {
  it('поток получает Last-Event-ID, а событие — id/type/data с seq', async () => {
    const runs = {
      stream: vi.fn(async () =>
        of({ seq: 7, type: 'text.delta', data: { text: 'при' }, createdAt: 'now' }),
      ),
      get: vi.fn(async () => 'run'),
      cancel: vi.fn(async () => 'cancelled'),
    };
    const controller = new AssistantRunsController(runs as never);
    const stream = await controller.stream(user, RUN_ID, '5');
    const event = await firstValueFrom(stream);
    expect(runs.stream).toHaveBeenCalledWith(user, RUN_ID, 5);
    expect(event).toEqual({
      id: '7',
      type: 'text.delta',
      data: { text: 'при', type: 'text.delta', seq: 7 },
    });
  });

  it('без заголовка поток начинается с нуля', async () => {
    const runs = { stream: vi.fn(async () => of()) };
    const controller = new AssistantRunsController(runs as never);
    await controller.stream(user, RUN_ID, undefined);
    expect(runs.stream).toHaveBeenCalledWith(user, RUN_ID, 0);
  });

  it('статус и отмена делегируются прогонам', async () => {
    const runs = {
      get: vi.fn(async () => 'run'),
      cancel: vi.fn(async () => 'cancelled'),
    };
    const controller = new AssistantRunsController(runs as never);
    await expect(controller.get(user, RUN_ID)).resolves.toBe('run');
    await expect(controller.cancel(user, RUN_ID)).resolves.toBe('cancelled');
    expect(runs.get).toHaveBeenCalledWith(user, RUN_ID);
    expect(runs.cancel).toHaveBeenCalledWith(user, RUN_ID);
  });
});

describe('AiSettingsController (#894)', () => {
  it('чтение, замена, каталог моделей и проверка соединения делегируются', async () => {
    const settings = {
      get: vi.fn(async () => 'settings'),
      put: vi.fn(async () => 'saved'),
      listModels: vi.fn(async () => ({ models: [] })),
      test: vi.fn(async () => ({ ok: true })),
    };
    const controller = new AiSettingsController(settings as never);
    const body = {
      providers: [],
      defaultProviderId: null,
      defaultModelId: null,
      instructions: '',
    };
    await expect(controller.get()).resolves.toBe('settings');
    await expect(controller.put(body)).resolves.toBe('saved');
    await expect(controller.listModels(PROVIDER_ID)).resolves.toEqual({ models: [] });
    await expect(controller.test(PROVIDER_ID)).resolves.toEqual({ ok: true });
    expect(settings.put).toHaveBeenCalledWith(body);
    expect(settings.listModels).toHaveBeenCalledWith(PROVIDER_ID);
    expect(settings.test).toHaveBeenCalledWith(PROVIDER_ID);
  });
});
