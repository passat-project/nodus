import { describe, expect, it } from 'vitest';

import {
  applyFormulaPrefill,
  emptyDraft,
  withValue,
  type FormulaPrefillTrace,
  type TaskCreateDraft,
} from './task-create-draft.js';

/** Черновик окна создания: формула подставляет описание и ответственного. */
const draft = (values: Record<string, unknown> = {}): TaskCreateDraft => ({
  ...emptyDraft(),
  values,
});

const trace = (
  auto: Record<string, unknown> = {},
  touched: readonly string[] = [],
): FormulaPrefillTrace => ({ auto, touched: new Set(touched) });

/** Правка человека: значение в черновике + метка «тронут» (как в окне). */
function edit(
  current: TaskCreateDraft,
  state: FormulaPrefillTrace,
  key: string,
  value: unknown,
): { draft: TaskCreateDraft; trace: FormulaPrefillTrace } {
  const touched = new Set(state.touched).add(key);
  const auto = { ...state.auto };
  delete auto[key];
  return { draft: withValue(current, key as never, value), trace: { auto, touched } };
}

describe('applyFormulaPrefill — подстановка формулы в окне создания (#632, Р12)', () => {
  it('нетронутые слоты получают значение, метки авто сохраняются', () => {
    const result = applyFormulaPrefill(draft(), { description: 'Из формулы' }, trace());
    expect(result.draft.values).toEqual({ description: 'Из формулы' });
    expect(result.auto).toEqual({ description: 'Из формулы' });
  });

  it('смена места обновляет авто-слот и не затирает ручной ввод', () => {
    const first = applyFormulaPrefill(draft(), { description: 'Старое', assignee: 'u1' }, trace());
    const manual = edit(first.draft, { auto: first.auto, touched: new Set() }, 'assignee', 'u2');
    const second = applyFormulaPrefill(
      manual.draft,
      { description: 'Новое', assignee: 'u3' },
      manual.trace,
    );
    expect(second.draft.values).toEqual({ description: 'Новое', assignee: 'u2' });
    expect(second.auto).toEqual({ description: 'Новое' });
  });

  it('очистка слота человеком — тоже правка: ре-эвал слот не заполняет (A8-3)', () => {
    const filled = applyFormulaPrefill(draft(), { description: 'Из формулы' }, trace());
    // Человек стёр поле (withValue удаляет ключ — значения в черновике нет).
    const cleared = edit(
      filled.draft,
      { auto: filled.auto, touched: new Set() },
      'description',
      null,
    );
    expect(cleared.draft.values.description).toBeUndefined();
    const reeval = applyFormulaPrefill(
      cleared.draft,
      { description: 'Новое место' },
      cleared.trace,
    );
    expect(reeval.draft.values.description).toBeUndefined();
    expect(reeval.auto).toEqual({});
  });

  it('слот пропал из формулы: авто-значение снимается, ручное остаётся', () => {
    const filled = applyFormulaPrefill(
      draft(),
      { description: 'Формула', assignee: 'u1' },
      trace(),
    );
    const manual = edit(filled.draft, { auto: filled.auto, touched: new Set() }, 'assignee', 'u2');
    const gone = applyFormulaPrefill(manual.draft, {}, manual.trace);
    expect(gone.draft.values).toEqual({ assignee: 'u2' });
    expect(gone.auto).toEqual({});
  });

  it('протухшая метка удаляется: значение в слоте уже не формульное (A8-4)', () => {
    const filled = applyFormulaPrefill(draft(), { description: 'Формула' }, trace());
    // Метка есть, а значение в черновике изменено мимо обработчика (защита).
    const changed = { ...filled.draft, values: { description: 'Ручное' } };
    const reeval = applyFormulaPrefill(
      changed,
      { description: 'Новое' },
      {
        auto: filled.auto,
        touched: new Set(),
      },
    );
    expect(reeval.draft.values.description).toBe('Ручное');
    expect(reeval.auto).toEqual({});
  });

  it('переоткрытие окна: прежние авто-метки не влияют (A8-4)', () => {
    const filled = applyFormulaPrefill(draft(), { description: 'Формула' }, trace());
    // Окно переоткрыли: черновик чистый, след префилла сброшен.
    const reopened = applyFormulaPrefill(draft(), { description: 'Формула' }, trace());
    expect(reopened.draft.values).toEqual(filled.draft.values);
    expect(reopened.auto).toEqual({ description: 'Формула' });
  });
});
