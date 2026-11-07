// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  CHAT_EVENTS,
  CORRESPONDENCE_EVENTS,
  CUSTOM_FIELD_CATALOG_EVENTS,
  CUSTOM_FIELD_EVENTS,
  DICTIONARY_CATALOG_EVENTS,
  DICTIONARY_EVENTS,
  PROJECT_CATALOG_EVENTS,
  PROJECT_EVENTS,
  TASK_EVENTS,
  WORKFLOW_CATALOG_EVENTS,
  WORKFLOW_EVENTS,
} from '@nodus/contracts';

import { tasksKeys } from '../api/tasks-keys.js';
import { DOMAIN_EVENTS, isFirstDelivery } from './socket-client.js';
import { createRealtimeInvalidator } from './socket-invalidation.js';

/**
 * Дедуп доставки message_sent (#254): gateway fanout шлёт событие и в
 * conv-комнату, и в user-комнаты участников — клиент в открытой беседе
 * получает одно сообщение дважды; уведомления срабатывают только на первую
 * копию (иначе 2 попапа оболочки / 2 браузерных тоста на одно сообщение).
 */

const CONV = '00000000-0000-4000-8000-0000000000c1';
const OTHER = '00000000-0000-4000-8000-000000000002';

function messagePayload(id: string) {
  return {
    conversationId: CONV,
    messageId: id,
    seq: 1,
    authorId: OTHER,
    threadRootId: null,
    forwarded: false,
    urgent: false,
    mentionedUserIds: [],
    message: {
      id,
      conversationId: CONV,
      seq: 1,
      clientMessageId: `cli-${id}`,
      author: { id: OTHER, displayName: 'Иван Петрович Смирнов', avatarUrl: null },
      text: 'привет',
      replyToId: null,
      reply: null,
      deletedAt: null,
      pinned: false,
      forwardedFrom: null,
      threadRootId: null,
      threadRepliesCount: 0,
      reactions: [],
      attachments: [],
      editedAt: null,
      readAt: null,
      readBy: [],
      urgent: false,
      mentionedUserIds: [],
      linkPreview: null,
      createdAt: new Date().toISOString(),
    },
  };
}

describe('isFirstDelivery (дедуп fanout conv+user)', () => {
  it('первая копия — да, повтор той же — нет, другое сообщение — да', () => {
    const a = messagePayload('00000000-0000-4000-8000-0000000000a1');
    const b = messagePayload('00000000-0000-4000-8000-0000000000b2');
    expect(isFirstDelivery(a)).toBe(true);
    // Дубль доставки (conv-комната + user-комната) — гасится.
    expect(isFirstDelivery(structuredClone(a))).toBe(false);
    expect(isFirstDelivery(structuredClone(a))).toBe(false);
    // Другое сообщение — своя первая доставка.
    expect(isFirstDelivery(b)).toBe(true);
  });

  it('кривой payload не занимает место в дедупе', () => {
    expect(isFirstDelivery({ мусор: true })).toBe(true);
    expect(isFirstDelivery(null)).toBe(true);
    // Валидное сообщение после мусора — первая доставка как обычно.
    expect(isFirstDelivery(messagePayload('00000000-0000-4000-8000-0000000000c3'))).toBe(true);
  });
});

describe('DOMAIN_EVENTS: подписка клиента (gotcha #311, #318)', () => {
  // Событие без строки в списке до роутера инвалидаций не доходит — молча
  // теряется (так жили task.* до #311 и стикеры до #318). Новое событие
  // каталога chat/task обязано быть подписано или явно исключено здесь.
  it('каждое событие каталогов chat.* и task.* подписано', () => {
    const subscribed = new Set<string>(DOMAIN_EVENTS);
    const missing = [...Object.values(CHAT_EVENTS), ...Object.values(TASK_EVENTS)].filter(
      (type) => !subscribed.has(type),
    );
    expect(missing).toEqual([]);
  });

  // F6 (#556): каталожные события «Атрибутов», справочников, «Процессов» и
  // видов папок gateway рассылает всем, но до роутера инвалидаций они не
  // доходили — подписки не было.
  it('каждое каталожное событие (атрибуты, справочники, процессы, виды папок) подписано', () => {
    const subscribed = new Set<string>(DOMAIN_EVENTS);
    const missing = [
      ...CUSTOM_FIELD_CATALOG_EVENTS,
      ...DICTIONARY_CATALOG_EVENTS,
      ...WORKFLOW_CATALOG_EVENTS,
      ...PROJECT_CATALOG_EVENTS,
    ].filter((type) => !subscribed.has(type));
    expect(missing).toEqual([]);
  });
});

/**
 * Ловушка «событие роутера без подписки» (A6-1, #632). Дважды случалось:
 * `task.*` до #311 и `custom_field.formula_changed` до аудита 6 — событие
 * доезжает до сокета, обработчик инвалидаций готов, но строки в
 * `DOMAIN_EVENTS` нет → молчаливый дроп (gotcha #311).
 *
 * Проверка не по списку подписок (тогда она тавтологична), а по ФАКТУ:
 * каждому событию каталога contracts отдаём payload со всеми адресами и
 * смотрим, инвалидирует ли роутер кэш. Инвалидирует → обязан быть подписан.
 */
describe('DOMAIN_EVENTS: ловушка «событие роутера без подписки» (A6-1)', () => {
  const CANDIDATES: string[] = [
    ...Object.values(CHAT_EVENTS),
    ...Object.values(TASK_EVENTS),
    ...Object.values(CUSTOM_FIELD_EVENTS),
    ...Object.values(DICTIONARY_EVENTS),
    ...Object.values(WORKFLOW_EVENTS),
    ...Object.values(PROJECT_EVENTS),
    ...Object.values(CORRESPONDENCE_EVENTS),
    // Литеральные типы роутера (не каталоги contracts).
    'notification.dispatch_requested',
    'notification.read',
  ];

  const TASK_ID = '21000000-0000-4000-8000-000000000001';
  const PROJECT_ID = '41000000-0000-4000-8000-000000000001';
  const HOST_ID = '61000000-0000-4000-8000-000000000001';

  /** Payload «всё сразу»: у каждого события роутер находит свои id, иначе
   *  ветка с адресом молчит и ловушка пропустила бы событие. */
  const PAYLOAD: Record<string, unknown> = {
    conversationId: CONV,
    messageId: '00000000-0000-4000-8000-0000000000d1',
    taskId: TASK_ID,
    projectId: PROJECT_ID,
    fileId: '00000000-0000-4000-8000-0000000000f1',
    packId: '00000000-0000-4000-8000-0000000000e1',
    workflowId: '71000000-0000-4000-8000-000000000001',
    hostKind: 'task',
    hostId: HOST_ID,
    fieldId: '53000000-0000-4000-8000-000000000001',
    hasError: true,
    stageId: '32000000-0000-4000-8000-000000000001',
    fromStageId: '32000000-0000-4000-8000-000000000001',
    toStageId: '32000000-0000-4000-8000-000000000002',
    snapshot: {
      kind: 'letter.arrived',
      sourceId: HOST_ID,
      notificationId: '00000000-0000-4000-8000-0000000000a1',
      userId: OTHER,
    },
  };

  /** Ключи, которые роутер инвалидирует по событию (окна батчера — flush). */
  function routerKeysFor(type: string): unknown[][] {
    const keys: unknown[][] = [];
    const client = {
      invalidateQueries: (arg: { queryKey: unknown[] }) => keys.push(arg.queryKey),
      getQueryData: () => undefined,
      setQueriesData: () => undefined,
      getQueriesData: () => [],
      getQueryCache: () => ({ findAll: () => [] }),
    };
    const invalidator = createRealtimeInvalidator(client as never);
    invalidator.handle({ type, payload: PAYLOAD, seq: 1, ts: '2026-11-05T00:00:00.000Z' });
    invalidator.flush();
    invalidator.dispose();
    return keys;
  }

  it('каждый тип, по которому роутер инвалидирует кэш, подписан на сокете', () => {
    const subscribed = new Set<string>(DOMAIN_EVENTS);
    const routed = CANDIDATES.filter((type) => routerKeysFor(type).length > 0);
    // Ловушка не должна быть пустой: роутер обязан что-то обрабатывать.
    expect(routed.length).toBeGreaterThan(10);
    expect(routed.filter((type) => !subscribed.has(type))).toEqual([]);
  });

  it('формула ячейки (#632): событие адресное — подписано и доходит до ключей', () => {
    expect(new Set<string>(DOMAIN_EVENTS).has(CUSTOM_FIELD_EVENTS.FORMULA_CHANGED)).toBe(true);
    expect(routerKeysFor(CUSTOM_FIELD_EVENTS.FORMULA_CHANGED)).toContainEqual(
      tasksKeys.detail(HOST_ID),
    );
  });
});
