import { describe, expect, it } from 'vitest';

import type {
  WorkflowDraftDocument,
  WorkflowDraftTransition,
} from './workflow-document.schemas.js';
import { checkWorkflowDocument } from './workflow-document-check.js';
import { workflowTransitionRulesSchema, type WorkflowValidator } from './workflow.schemas.js';

const S1 = '00000000-0000-4000-8000-000000000001';
const S2 = '00000000-0000-4000-8000-000000000002';

const rules = (validators: WorkflowValidator[]) =>
  workflowTransitionRulesSchema.parse({ validators });

function transition(
  form: WorkflowDraftTransition['form'],
  validators: Parameters<typeof rules>[0] = [],
): WorkflowDraftTransition {
  return {
    id: '00000000-0000-4000-8000-0000000000t1',
    code: null,
    name: 'Завершить',
    fromStageId: S1,
    toStageId: S2,
    display: 'primary',
    intent: 'action',
    sortOrder: 0,
    rules: rules(validators),
    form,
  };
}

function doc(t: WorkflowDraftTransition): WorkflowDraftDocument {
  return {
    stages: [
      {
        id: S1,
        code: 'new',
        name: 'Ожидает',
        color: 'neutral',
        systemState: 'backlog',
        outcome: null,
        isInitial: true,
        sortOrder: 0,
      },
      {
        id: S2,
        code: 'done',
        name: 'Завершена',
        color: 'info',
        systemState: 'closed',
        outcome: 'success',
        isInitial: false,
        sortOrder: 0,
      },
    ],
    transitions: [t],
  };
}

const codes = (d: WorkflowDraftDocument) => checkWorkflowDocument(d).map((p) => p.code);

describe('проверки окна перехода в документе (#380)', () => {
  it('пустая подпись раздела — ошибка', () => {
    const t = transition({
      enabled: true,
      sections: [{ kind: 'comment', label: '', required: true }],
    });
    expect(codes(doc(t))).toContain('form_empty_label');
  });

  it('дубль раздела — ошибка', () => {
    const t = transition({
      enabled: true,
      sections: [{ kind: 'result' }, { kind: 'result' }],
    });
    expect(codes(doc(t))).toContain('form_duplicate_section');
  });

  it('файлы без итога и без гейта — предупреждение, не ошибка', () => {
    const t = transition({
      enabled: true,
      sections: [{ kind: 'result_files', label: 'Акт' }],
    });
    const problem = checkWorkflowDocument(doc(t)).find((p) => p.code === 'form_useless_section');
    expect(problem?.severity).toBe('warning');
  });

  it('файлы с гейтом result_files — без предупреждения', () => {
    const t = transition({ enabled: true, sections: [{ kind: 'result_files', label: 'Акт' }] }, [
      { kind: 'result_files', min: 1 },
    ]);
    expect(codes(doc(t))).not.toContain('form_useless_section');
  });

  it('окно выключено — проверки формы молчат', () => {
    const t = transition({ enabled: false, sections: [] });
    expect(codes(doc(t))).not.toContain('form_empty_label');
  });
});
