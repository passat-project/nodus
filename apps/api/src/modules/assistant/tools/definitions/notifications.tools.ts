import { z } from 'zod';

import { updateNotificationSettingsBodySchema, type NotificationSettings } from '@nodus/contracts';

import { defineTool } from '../tool-definition.js';
import { asTyped } from '../projections.js';
import { field, fieldsOf } from './write-cards.js';
import { notificationsMeta } from './meta/notifications.meta.js';

/**
 * Настройки уведомлений сотрудника (#932): режим «не беспокоить» и часы
 * тишины. Только свои настройки (API привязан к текущему сотруднику);
 * правка — карточкой подтверждения (ADR-0048).
 */

function settingsText(data: unknown): string {
  const settings = asTyped<NotificationSettings>(data);
  if (!settings) return 'Настройки уведомлений недоступны.';
  return settings.dndEnabled
    ? `Не беспокоить: включено, тишина ${settings.dndStart}–${settings.dndEnd}`
    : 'Не беспокоить: выключено (уведомления приходят круглосуточно)';
}

export const notificationsSettingsTool = defineTool({
  ...notificationsMeta['notifications.settings'],
  id: 'notifications.settings',
  title: 'Уведомления: настройки',
  description:
    'Личные настройки уведомлений текущего сотрудника: включён ли режим «не беспокоить» и окно тишины.',
  keywords: [
    'настройки уведомлений',
    'не беспокоить',
    'режим тишины',
    'dnd',
    'уведомления настройки',
  ],
  module: 'notifications',
  kind: 'read',
  featureFlag: 'notifications',
  hot: false,
  input: z.object({}),
  api: { method: 'GET', path: '/notifications/settings' },
  build: () => ({ path: '/notifications/settings' }),
  project: (data) => ({ text: settingsText(data) }),
});

export const notificationsUpdateSettingsTool = defineTool({
  ...notificationsMeta['notifications.update_settings'],
  id: 'notifications.update_settings',
  title: 'Уведомления: настроить режим тишины',
  description:
    'Включить или выключить режим «не беспокоить» и задать часы тишины. Передаются только изменяемые поля; действие появится карточкой подтверждения.',
  keywords: [
    'включить не беспокоить',
    'выключить не беспокоить',
    'тишина с 22 до 8',
    'dnd настройка',
    'update notification settings',
  ],
  module: 'notifications',
  kind: 'write',
  featureFlag: 'notifications',
  hot: false,
  input: z.object({ patch: updateNotificationSettingsBodySchema }),
  api: { method: 'PATCH', path: '/notifications/settings' },
  build: (input) => ({
    method: 'PATCH',
    path: '/notifications/settings',
    body: input.patch,
  }),
  project: (data) => ({ text: settingsText(data) }),
  card: {
    title: 'Настроить режим «не беспокоить»',
    summary: (input) => {
      const parts: string[] = [];
      if (input.patch.dndEnabled !== undefined) {
        parts.push(input.patch.dndEnabled ? 'включить' : 'выключить');
      }
      if (input.patch.dndStart) parts.push(`с ${input.patch.dndStart}`);
      if (input.patch.dndEnd) parts.push(`до ${input.patch.dndEnd}`);
      return `Не беспокоить: ${parts.join(', ') || 'без изменений'}`;
    },
    fields: (input) =>
      fieldsOf([
        field(
          'Не беспокоить',
          input.patch.dndEnabled === undefined
            ? undefined
            : input.patch.dndEnabled
              ? 'включено'
              : 'выключено',
        ),
        field('Начало тишины', input.patch.dndStart),
        field('Конец тишины', input.patch.dndEnd),
      ]),
    consequences:
      'Тосты уведомлений будут гаситься в окне тишины (срочные приходят всегда). Настройка личная и видна только вам; вернуть прежние часы можно повторной правкой.',
  },
});

export const notificationsTools = [notificationsSettingsTool, notificationsUpdateSettingsTool];
