// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldRef } from '@nodus/contracts';

import { emptyDraft, mergeDraftRefs, type FieldDraft } from '../../lib/field-draft.js';
import { FieldDialogForm } from './field-dialog-form.js';

/**
 * Значение глобальной переменной в окне атрибута (#646): выбранная ссылка
 * должна попадать в `companyRefs` черновика, иначе редактор показывает
 * «Запись недоступна», а сохранение уходит без имён до ответа сервера.
 */

const captured = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));

vi.mock('../../../../shared/custom-fields/value-editor.js', () => ({
  CustomFieldEditor: (props: Record<string, unknown>) => {
    captured.props.push(props);
    return null;
  },
}));

const OLD: CustomFieldRef = {
  kind: 'project',
  id: '00000000-0000-4000-8000-0000000000b1',
  name: 'Старый проект',
  avatarUrl: null,
  archived: false,
};
const PICKED: CustomFieldRef = {
  kind: 'project',
  id: '00000000-0000-4000-8000-0000000000b2',
  name: 'Новый проект',
  avatarUrl: null,
  archived: false,
};

const draft: FieldDraft = {
  ...emptyDraft,
  family: 'project',
  name: 'Головной проект',
  isCompany: true,
  companyValue: OLD.id,
  companyRefs: [OLD],
};

function renderForm(onChange = vi.fn()) {
  render(
    <FieldDialogForm
      draft={draft}
      definition={null}
      shared={false}
      disabled={false}
      optionsReadOnly={false}
      errors={{}}
      issues={[]}
      currencyFallback={null}
      removedOptions={0}
      suggestion={null}
      onOpenSuggestion={vi.fn()}
      onChange={onChange}
    />,
  );
  return onChange;
}

afterEach(() => {
  cleanup();
  captured.props.length = 0;
});

describe('окно атрибута: ссылки значения глобальной переменной (#646)', () => {
  it('редактор получает ссылки черновика, а не только сохранённые', () => {
    renderForm();
    expect(captured.props).toHaveLength(1);
    expect(captured.props[0]!.refs).toEqual([OLD]);
  });

  it('выбранная ссылка мержится в черновик вместе со значением', () => {
    const onChange = renderForm();
    const onCommit = captured.props[0]!.onCommit as (value: string, refs: CustomFieldRef[]) => void;
    onCommit(PICKED.id, [PICKED]);
    expect(onChange).toHaveBeenCalledWith({
      companyValue: PICKED.id,
      companyRefs: [OLD, PICKED],
    });
  });
});

describe('mergeDraftRefs', () => {
  it('свежая ссылка заменяет старую по kind:id, порядок сохраняется', () => {
    const updated = { ...OLD, name: 'Переименован' };
    expect(mergeDraftRefs([OLD], [updated])).toEqual([updated]);
    expect(mergeDraftRefs([OLD], [PICKED])).toEqual([OLD, PICKED]);
    expect(mergeDraftRefs([OLD])).toEqual([OLD]);
  });
});
