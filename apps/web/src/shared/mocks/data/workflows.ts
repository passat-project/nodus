import type { WorkflowDetail } from '@nodus/contracts';
import { customFieldKey } from '@nodus/contracts';

import { quickDocument, simpleDocument, standardDocument } from './workflows-documents.js';
import { stageInProgress } from './task-stages.js';
import { letterWorkflowDetails } from './letter-catalog.js';
import { fieldIds } from './field-ids.js';
import {
  ARCHIVED_WORKFLOW_ID,
  CHANGE_WORKFLOW_ID,
  HR_WORKFLOW_ID,
  KOMPLEKT_WORKFLOW_ID,
  OVERTIME_WORKFLOW_ID,
  QUICK_WORKFLOW_ID,
  STANDARD_WORKFLOW_ID,
  archivedDemoType,
  changeType,
  komplektCreationForm,
  komplektType,
  overtimeCreationForm,
  quickTypeDto,
  standardProcessType,
  overtimeType,
  hrType,
} from './workflow-types.js';

/** Маршруты демо-типов «Автоматизации» (ревизия 2, #378; формы и состав
 *  карточки — #432): опубликованные документы, с которых хендлер собирает
 *  окна и карточку. Типы и их формы — соседний `workflow-types.ts`. */

export { quickDocument, standardDocument } from './workflows-documents.js';
export * from './workflow-types.js';

const publishedAt = '2026-10-18T14:05:00Z';
const publishedBy = {
  id: '00000000-0000-4000-8000-000000000001',
  displayName: 'Климович А.',
  avatarUrl: null,
};

export const demoWorkflowDetails: Record<string, WorkflowDetail> = {
  [STANDARD_WORKFLOW_ID]: {
    id: STANDARD_WORKFLOW_ID,
    typeIds: [standardProcessType.id],
    version: 3,
    publishedAt,
    publishedBy,
    document: standardDocument,
    stageEntityCounts: {},
  },
  [QUICK_WORKFLOW_ID]: {
    id: QUICK_WORKFLOW_ID,
    typeIds: [quickTypeDto.id],
    version: 2,
    publishedAt,
    publishedBy,
    document: quickDocument,
    stageEntityCounts: {},
  },
  [OVERTIME_WORKFLOW_ID]: {
    id: OVERTIME_WORKFLOW_ID,
    typeIds: [overtimeType.id],
    version: 1,
    publishedAt,
    publishedBy,
    document: { ...quickDocument, creation: overtimeCreationForm },
    stageEntityCounts: {},
  },
  [HR_WORKFLOW_ID]: {
    id: HR_WORKFLOW_ID,
    typeIds: [hrType.id],
    version: 1,
    publishedAt,
    publishedBy,
    document: quickDocument,
    stageEntityCounts: {},
  },
  // «Комплект» (#632): быстрый маршрут + форма создания с формулой шифра;
  // кнопка «Выдать в печать» (#630) присваивает номера счётчиков — «Изм.»
  // (разрез «папка», К2) и сквозной «Взял изм» (продолжение из Excel, К3).
  [KOMPLEKT_WORKFLOW_ID]: {
    id: KOMPLEKT_WORKFLOW_ID,
    typeIds: [komplektType.id],
    version: 1,
    publishedAt,
    publishedBy,
    document: { ...quickDocument, creation: komplektCreationForm },
    stageEntityCounts: {},
  },
  // «Изменение» (#630, модель v3): работа в папке «Комплект»; Изм. и №
  // разрешения выдаются при создании (их пишут в штамп), действие «Выдать в
  // печать» выдаёт номер накладной выдачи `{Инв. № проекта}-{N}`. Пост-функции
  // на уже выданные поля оставлены нарочно: «кто первым заполнил — тот выдал»,
  // кнопка их не меняет (старые работы без номера получат их кнопкой).
  [CHANGE_WORKFLOW_ID]: {
    id: CHANGE_WORKFLOW_ID,
    typeIds: [changeType.id],
    version: 1,
    publishedAt,
    publishedBy,
    document: {
      ...quickDocument,
      transitions: [
        ...quickDocument.transitions,
        {
          id: '30000000-0000-4000-8000-999999999999',
          code: 'issue_print',
          name: 'Выдать в печать',
          fromStageId: stageInProgress.id,
          toStageId: stageInProgress.id,
          display: 'button',
          intent: 'action',
          sortOrder: 2,
          rules: {
            conditions: [{ kind: 'role_in', roles: ['assignee', 'coexecutor'] }],
            validators: [],
            postFunctions: [{ kind: 'assign_number', fieldId: fieldIds.waybillNumber }],
          },
          // Окно кнопки (#496, сценарий «Комплект»): «Файл» спрашивается и
          // закрепляется — после выдачи руками не поменять (замок «никто»).
          form: {
            enabled: true,
            sections: [
              {
                kind: 'fields',
                fields: [
                  { kind: 'heading', id: 'dissue01', text: 'Что выдаём' },
                  {
                    key: customFieldKey(fieldIds.issueFile),
                    hint: 'Ссылка на PDF в хранилище проекта',
                  },
                  {
                    kind: 'note',
                    id: 'dissue02',
                    text: 'После выдачи ссылку не поменять: новая версия — новым изменением',
                  },
                ],
              },
            ],
            locks: [{ key: customFieldKey(fieldIds.issueFile), editors: 'none' }],
          },
        },
      ],
    },
    stageEntityCounts: {},
  },
  [ARCHIVED_WORKFLOW_ID]: {
    id: ARCHIVED_WORKFLOW_ID,
    typeIds: [archivedDemoType.id],
    version: 1,
    publishedAt,
    publishedBy: null,
    document: simpleDocument,
    stageEntityCounts: {},
  },
  ...letterWorkflowDetails,
};
