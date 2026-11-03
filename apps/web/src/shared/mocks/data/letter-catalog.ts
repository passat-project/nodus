import type {
  ProcessType,
  TaskStage,
  WorkflowCondition,
  WorkflowDetail,
  WorkflowDocument,
} from '@nodus/contracts';
import { Permission } from '@nodus/contracts';

import { processTypeIds } from './process-type-ids.js';

/** Каталог писем (#55, Р5) — зеркало серверного каталога ревизии 1:
 *  типы «Входящее письмо» и «Исходящее письмо», их стадии и маршруты.
 *  Коды стадий и кнопок стабильны — #463/#464 дополняют маршруты, не
 *  переименовывая. Типы писем в «Автоматизации» — только просмотр (Р4). */

type LetterType = Omit<ProcessType, 'viewer' | 'creationForm'>;

const lsid = (n: number): string => `21000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ltrid = (n: number): string => `31000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const LETTER_INCOMING_WORKFLOW_ID = '20000000-0000-4000-8000-000000000960';
export const LETTER_OUTGOING_WORKFLOW_ID = '20000000-0000-4000-8000-000000000961';

/** Серии номеров (Р2): «Вх-ГГГГ/N», «Исх-ГГГГ/N», сброс по году. */
export const letterSeriesIds = {
  incoming: '22000000-0000-4000-8000-000000000001',
  outgoing: '22000000-0000-4000-8000-000000000002',
} as const;

export const letterStages = {
  new: { id: lsid(1), name: 'Новое', order: 0, systemState: 'backlog', color: 'neutral' },
  onResolution: {
    id: lsid(2),
    name: 'На резолюции',
    order: 1,
    systemState: 'active',
    color: 'info',
  },
  notRegistered: {
    id: lsid(3),
    name: 'Не зарегистрировано',
    order: 2,
    systemState: 'closed',
    color: 'neutral',
    outcome: 'cancelled',
  },
  registeredByMistake: {
    id: lsid(4),
    name: 'Ошибочно зарегистрировано',
    order: 3,
    systemState: 'closed',
    color: 'danger',
    outcome: 'cancelled',
  },
  draft: { id: lsid(5), name: 'Черновик', order: 0, systemState: 'backlog', color: 'neutral' },
  cancelled: {
    id: lsid(6),
    name: 'Отменено',
    order: 1,
    systemState: 'closed',
    color: 'neutral',
    outcome: 'cancelled',
  },
  /** Отправленное исходящее (демо #56; переход отправки — #464). */
  sent: {
    id: lsid(7),
    name: 'Отправлено',
    order: 1,
    systemState: 'closed',
    color: 'success',
    outcome: 'success',
  },
} as const satisfies Record<string, TaskStage>;

const registrar: WorkflowCondition = {
  kind: 'permission',
  permission: Permission.CORRESPONDENCE_REGISTER,
};
const reason = { kind: 'comment', label: 'Причина', required: true } as const;

export const incomingLetterDocument: WorkflowDocument = {
  stages: [
    { ...letterStages.new, code: 'new', outcome: null, isInitial: true, sortOrder: 0 },
    {
      ...letterStages.onResolution,
      code: 'on_resolution',
      outcome: null,
      isInitial: false,
      sortOrder: 0,
    },
    { ...letterStages.notRegistered, code: 'not_registered', isInitial: false, sortOrder: 0 },
    {
      ...letterStages.registeredByMistake,
      code: 'registered_by_mistake',
      isInitial: false,
      sortOrder: 1,
    },
  ],
  transitions: [
    {
      id: ltrid(1),
      code: 'register',
      name: 'Зарегистрировать',
      fromStageId: letterStages.new.id,
      toStageId: letterStages.onResolution.id,
      display: 'primary',
      intent: 'action',
      sortOrder: 0,
      rules: {
        conditions: [registrar],
        validators: [],
        postFunctions: [{ kind: 'assign_number' }],
      },
      form: { enabled: true, title: 'Регистрация письма', sections: [{ kind: 'registration' }] },
    },
    {
      id: ltrid(2),
      code: 'close_unregistered',
      name: 'Закрыть без регистрации',
      fromStageId: letterStages.new.id,
      toStageId: letterStages.notRegistered.id,
      display: 'button',
      intent: 'action',
      sortOrder: 1,
      rules: { conditions: [registrar], validators: [], postFunctions: [] },
      form: { enabled: true, sections: [reason] },
    },
    {
      id: ltrid(3),
      code: 'cancel_registration',
      name: 'Отменить регистрацию',
      fromStageId: letterStages.onResolution.id,
      toStageId: letterStages.registeredByMistake.id,
      display: 'menu',
      intent: 'action',
      sortOrder: 0,
      rules: { conditions: [registrar], validators: [], postFunctions: [] },
      form: { enabled: true, sections: [reason] },
    },
  ],
};

export const outgoingLetterDocument: WorkflowDocument = {
  stages: [
    { ...letterStages.draft, code: 'draft', outcome: null, isInitial: true, sortOrder: 0 },
    { ...letterStages.cancelled, code: 'cancelled', isInitial: false, sortOrder: 0 },
  ],
  transitions: [
    {
      id: ltrid(4),
      code: 'cancel',
      name: 'Отменить',
      fromStageId: letterStages.draft.id,
      toStageId: letterStages.cancelled.id,
      display: 'menu',
      intent: 'action',
      sortOrder: 0,
      rules: {
        conditions: [{ kind: 'role_in', roles: ['author'] }],
        validators: [],
        postFunctions: [],
      },
      form: { enabled: true, sections: [reason] },
    },
  ],
};

const card = { hiddenBlocks: [], roleLabels: {} };
const allAccess = { view: null, create: null };

export const incomingLetterType: LetterType = {
  id: processTypeIds.letterIncoming,
  code: 'letter-incoming',
  name: 'Входящее письмо',
  icon: 'file-text',
  color: 'info',
  description: 'Регистрация входящей корреспонденции: номер Вх-ГГГГ/N, адресат, срок ответа',
  creatable: true,
  category: 'letter',
  direction: 'incoming',
  isSystem: true,
  sortOrder: 0,
  archivedAt: null,
  workflowId: LETTER_INCOMING_WORKFLOW_ID,
  numbering: { seriesId: letterSeriesIds.incoming, prefix: 'Вх', reset: 'year' },
  config: { card, access: allAccess, numbering: { seriesId: letterSeriesIds.incoming } },
};

export const outgoingLetterType: LetterType = {
  id: processTypeIds.letterOutgoing,
  code: 'letter-outgoing',
  name: 'Исходящее письмо',
  icon: 'send',
  color: 'success',
  description: 'Письма компании корреспондентам: номер Исх-ГГГГ/N при отправке',
  creatable: false,
  category: 'letter',
  direction: 'outgoing',
  isSystem: true,
  sortOrder: 1,
  archivedAt: null,
  workflowId: LETTER_OUTGOING_WORKFLOW_ID,
  numbering: { seriesId: letterSeriesIds.outgoing, prefix: 'Исх', reset: 'year' },
  config: { card, access: allAccess, numbering: { seriesId: letterSeriesIds.outgoing } },
};

export const letterProcessTypes: LetterType[] = [incomingLetterType, outgoingLetterType];

const publishedAt = '2026-10-26T06:00:00Z';

export const letterWorkflowDetails: Record<string, WorkflowDetail> = {
  [LETTER_INCOMING_WORKFLOW_ID]: {
    id: LETTER_INCOMING_WORKFLOW_ID,
    typeIds: [incomingLetterType.id],
    version: 1,
    publishedAt,
    publishedBy: null,
    document: incomingLetterDocument,
    stageEntityCounts: {},
  },
  [LETTER_OUTGOING_WORKFLOW_ID]: {
    id: LETTER_OUTGOING_WORKFLOW_ID,
    typeIds: [outgoingLetterType.id],
    version: 1,
    publishedAt,
    publishedBy: null,
    document: outgoingLetterDocument,
    stageEntityCounts: {},
  },
};

/** Маршрут письма по типу (мок-движок переходов). */
export function letterDocumentOf(typeId: string): WorkflowDocument {
  return typeId === outgoingLetterType.id ? outgoingLetterDocument : incomingLetterDocument;
}
