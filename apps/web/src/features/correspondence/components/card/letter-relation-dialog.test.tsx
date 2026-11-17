// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { LetterListItem, LetterTreeNode } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  pending: false,
  letters: [] as unknown[],
}));

vi.mock('../../api/letters-relations.js', () => ({
  useLinkLetterRelation: () => ({ mutate: mocks.mutate, isPending: mocks.pending }),
  relationErrorText: () => 'Связь недопустима',
}));
vi.mock('../../../../shared/api/letters-list.js', () => ({
  useLettersInfinite: () => ({ data: {}, isLoading: false }),
  letterRows: () => mocks.letters,
}));

import { LetterRelationDialog } from './letter-relation-dialog.js';

afterEach(cleanup);
beforeEach(() => {
  mocks.mutate.mockClear();
  mocks.pending = false;
  mocks.letters = [];
});

const treeNode = (id: string, regNumber: string, subject: string): LetterTreeNode =>
  ({
    id,
    regNumber,
    subject,
    regDate: null,
    counterparty: null,
    confidential: false,
    relationId: null,
    relationKind: null,
    children: [],
  }) as unknown as LetterTreeNode;

const listItem = (id: string, regNumber: string, subject: string): LetterListItem =>
  ({
    id,
    regNumber,
    subject,
    regDate: null,
    counterparty: null,
    confidential: false,
    stage: { name: 'Зарегистрировано', color: 'port', systemState: 'active', outcome: null },
  }) as unknown as LetterListItem;

/** Открытое письмо — конверт, в который вкладываем (#611). */
const CURRENT = treeNode('cur', 'Вх-2026/4', 'Конверт заказчика');
/** Уже зарегистрированное письмо из поиска. */
const PICKED = listItem('p2', 'Вх-2026/7', 'Вложение по разделу 3');

function renderDialog(existing: Parameters<typeof LetterRelationDialog>[0]['existing'] = {}) {
  return render(
    <LetterRelationDialog
      open
      onOpenChange={() => {}}
      rootId={CURRENT.id}
      source={CURRENT}
      initialKind="nested_in"
      existing={existing}
    />,
  );
}

/** Выбрать письмо в выдаче поиска (выдача уже отрисована). */
function pickLetter() {
  fireEvent.click(screen.getByRole('option'));
}

/** Первая строка предпросмотра «Связь встанет так» — там родитель. */
function previewNumberOrder(first: string, second: string): boolean {
  const caption = screen.getByText(ui.letters.relations.previewCaption);
  const preview = caption.nextElementSibling as HTMLElement;
  const a = within(preview).getByText(first);
  const b = within(preview).getByText(second);
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe('Окно связи: направление (#611)', () => {
  it('по умолчанию выбранное письмо — родитель: это письмо отвечает/вложено в него', () => {
    mocks.letters = [PICKED];
    renderDialog();
    pickLetter();

    expect(previewNumberOrder('Вх-2026/7', 'Вх-2026/4')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: ui.letters.relations.submit }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: CURRENT.id,
        targetId: PICKED.id,
        kind: 'nested_in',
        replace: false,
      }),
      expect.anything(),
    );
  });

  it('обратное направление: выбранное становится ребёнком, не уходя с карточки', () => {
    mocks.letters = [PICKED];
    renderDialog();
    pickLetter();

    fireEvent.click(screen.getByRole('radio', { name: /Выбранное → этому/ }));
    // Предпросмотр меняет местами родителя и ребёнка — ошибку видно до нажатия.
    expect(previewNumberOrder('Вх-2026/4', 'Вх-2026/7')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: ui.letters.relations.submit }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: PICKED.id,
        targetId: CURRENT.id,
        kind: 'nested_in',
        replace: false,
      }),
      expect.anything(),
    );
  });

  it('замена предлагается только для связей открытого письма', () => {
    mocks.letters = [PICKED];
    renderDialog({ nested_in: { id: 'r1', regNumber: 'Вх-2026/1', subject: 'Старое' } });

    expect(screen.getByText(ui.letters.relations.replaceTitle)).toBeTruthy();
    expect(screen.getByRole('button', { name: ui.letters.relations.submitReplace })).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: /Выбранное → этому/ }));
    expect(screen.getByText(ui.letters.relations.addTitle)).toBeTruthy();
    expect(screen.getByRole('button', { name: ui.letters.relations.submit })).toBeTruthy();
  });
});
