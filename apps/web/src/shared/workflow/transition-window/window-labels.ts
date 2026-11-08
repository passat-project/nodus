import type { EffectiveSection } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

import type { TransitionWindowContext } from './window-context.js';

/** Пустой контекст превью окна: данные не нужны, разделы живые. */
export const PREVIEW_CONTEXT: TransitionWindowContext = {
  entityId: '',
  conversationId: null,
  currentStageName: '—',
  fields: {
    description: '',
    deadline: null,
    assigneeId: null,
    plannedMinutes: null,
    customFields: {},
  },
  spentMinutes: 0,
  lastResult: null,
  access: { canEdit: true, canLogTime: true, canCheck: true },
  submission: null,
  scope: 'entity',
  customFieldDefinitions: [],
  customFieldRefs: [],
};

/** Название раздела окна: своё из настроек блока (#496) или стандартное. */
export function sectionTitle(section: EffectiveSection): string {
  if (section.kind !== 'fields' && section.label?.trim()) return section.label;
  switch (section.kind) {
    case 'registration':
      return ui.automation.window.sections.registration;
    case 'fields':
      return ui.tasks.window.fieldsLabel;
    case 'time':
      return ui.tasks.window.timeLabel;
    case 'result':
      return ui.tasks.window.resultLabel;
    case 'result_files':
      return ui.tasks.window.filesLabel;
    case 'result_messages':
      return ui.tasks.window.messagesLabel;
    case 'comment':
      return ui.tasks.window.commentLabel;
  }
}

/** Подпись пропущенного обязательного раздела в строке ошибки 422. */
export function missingLabel(key: string): string {
  switch (key) {
    case 'comment':
      return ui.tasks.window.commentLabel;
    case 'result_messages':
      return ui.tasks.window.messagesLabel;
    case 'registration':
      return ui.automation.window.sections.registration;
    default:
      return key;
  }
}
