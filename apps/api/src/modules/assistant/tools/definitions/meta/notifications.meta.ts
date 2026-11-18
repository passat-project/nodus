import type { ToolStandard } from '../../tool-definition.js';

/** Стандарт описания настроек уведомлений (#932): просмотр и правка DND. */
export const notificationsMeta = {
  'notifications.settings': {
    why: 'Показать личные настройки уведомлений: режим «не беспокоить» и часы тишины.',
    whenToUse:
      '«Покажи мои настройки уведомлений», «когда у меня режим тишины», «включён ли не беспокоить».',
    whenNotToUse:
      'Не для журнала уведомлений (notifications.list) и не для правки (notifications.update_settings).',
    subject: 'уведомление',
    effect: 'read',
    example: { input: {}, note: 'без аргументов: настройки текущего сотрудника' },
    returns: 'Включён ли режим тишины и окно «ЧЧ:ММ–ЧЧ:ММ».',
    nextStep: 'Предложи изменить окно, если сотрудник просит.',
    intent: 'get',
  },
  'notifications.update_settings': {
    why: 'Настроить личный режим «не беспокоить»: включить и задать часы тишины.',
    whenToUse: '«Включи режим не беспокоить», «выключи не беспокоить», «тишина с 22:00 до 08:00».',
    whenNotToUse:
      'Не для просмотра (notifications.settings) и не для чужих настроек — правятся только свои.',
    subject: 'уведомление',
    effect: 'irreversible',
    example: {
      input: { patch: { dndEnabled: true, dndStart: '22:00', dndEnd: '08:00' } },
      note: 'patch — updateNotificationSettingsBodySchema; хотя бы одно поле',
    },
    returns: 'Карточка подтверждения; после выполнения — настройки уведомлений.',
    nextStep: 'Покажи настройки уведомлений, чтобы сотрудник убедился.',
    intent: 'update',
  },
} satisfies Record<string, ToolStandard>;
