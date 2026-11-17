import type { WorkflowDocument } from '@nodus/contracts';

import { requestCancelledStage, requestDoneStage, requestReviewStage } from './task-stages.js';

/** Маршрут демо-типа «Заявка» (#434): обычный тип, кнопку «Ознакомлен»
 *  жмут все сотрудники; после кворума задача закрывается. */
const trid = (code: string): string =>
  `30000000-0000-4000-8000-${code.padEnd(12, '0').slice(0, 12)}`;

export const REQUEST_ACK_TRANSITION_ID = trid('requestack');
export const REQUEST_CANCEL_TRANSITION_ID = trid('requestcancel');

export const requestDocument: WorkflowDocument = {
  stages: [
    {
      ...requestReviewStage,
      code: 'review',
      outcome: null,
      isInitial: true,
      sortOrder: 0,
    },
    {
      ...requestDoneStage,
      code: 'done',
      outcome: 'success',
      isInitial: false,
      sortOrder: 0,
    },
    {
      ...requestCancelledStage,
      code: 'cancelled',
      outcome: 'cancelled',
      isInitial: false,
      sortOrder: 1,
    },
  ],
  transitions: [
    {
      id: REQUEST_ACK_TRANSITION_ID,
      code: 'request-ack',
      name: 'Ознакомлен',
      fromStageId: requestReviewStage.id,
      toStageId: requestDoneStage.id,
      display: 'primary',
      intent: 'action',
      sortOrder: 0,
      rules: { conditions: [], validators: [], postFunctions: [] },
      // Окно кнопки настраивается отдельно («Редактировать окно», #496):
      // у ознакомления каждый оставляет короткую отметку; поле не обязательное.
      form: {
        enabled: true,
        title: 'Ознакомление',
        sections: [{ kind: 'result', label: 'Отметка об ознакомлении' }],
      },
      press: {
        sources: [{ kind: 'all_employees' }],
        quorum: { kind: 'all' },
        order: 'parallel',
        excludeAuthor: true,
      },
    },
    {
      id: REQUEST_CANCEL_TRANSITION_ID,
      code: 'request-cancel',
      name: 'Отменить',
      fromStageId: null,
      toStageId: requestCancelledStage.id,
      display: 'menu',
      intent: 'service',
      sortOrder: 0,
      rules: {
        conditions: [{ kind: 'role_in', roles: ['creator'] }],
        validators: [],
        postFunctions: [],
      },
      form: {
        enabled: true,
        title: 'Причина отмены',
        sections: [{ kind: 'comment', label: 'Причина отмены', required: true }],
      },
    },
  ],
};
