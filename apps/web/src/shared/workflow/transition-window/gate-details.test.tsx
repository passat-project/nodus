// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { CustomFieldDefinition, TaskListItem, TransitionBlockReason } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

const cardOpen = vi.hoisted(() => vi.fn());
vi.mock('../../lib/card-bridge.js', () => ({ openCardViaBridge: cardOpen }));

import { TransitionGateDetails } from './gate-details.js';

const OPEN_SUBTASK = {
  id: '30000000-0000-4000-8000-000000000101',
  number: 101,
  title: 'Согласовать смету',
  stage: { name: 'В работе', systemState: 'active', color: 'green' },
} as unknown as TaskListItem;

const CLOSED_SUBTASK = {
  id: '30000000-0000-4000-8000-000000000102',
  number: 102,
  title: 'Уже закрыта',
  stage: { name: 'Завершена', systemState: 'closed', color: 'blue', outcome: 'success' },
} as unknown as TaskListItem;

const REVIEW_SUBTASK = {
  id: '30000000-0000-4000-8000-000000000103',
  number: 103,
  title: 'Ждёт приёмки',
  stage: { name: 'На утверждении', systemState: 'done', color: 'amber' },
} as unknown as TaskListItem;

const TASK = {
  subtasks: [OPEN_SUBTASK, CLOSED_SUBTASK, REVIEW_SUBTASK],
  checklistDone: 2,
  checklistTotal: 5,
};

const DEFINITIONS = [
  { id: 'a0000000-0000-4000-8000-000000000001', name: 'Номер накладной' },
] as unknown as CustomFieldDefinition[];

const REASONS: TransitionBlockReason[] = [
  { kind: 'no_open_subtasks', count: 1 },
  { kind: 'checklist_complete' },
  { kind: 'fields_required', fields: ['deadline', 'cf.a0000000-0000-4000-8000-000000000001'] },
  { kind: 'result_files', count: 0, min: 2 },
];

describe('TransitionGateDetails: подробности гейтов', () => {
  afterEach(() => {
    cleanup();
    cardOpen.mockClear();
  });

  it('показывает только незакрытые подзадачи и ведёт в каждую', () => {
    const onOpenSubtask = vi.fn();
    render(
      <TransitionGateDetails
        reasons={REASONS}
        gate={{ task: TASK, definitions: DEFINITIONS, onOpenSubtask }}
      />,
    );

    expect(screen.getByText('Есть незавершённые подзадачи')).toBeTruthy();
    expect(screen.getByText('Согласовать смету')).toBeTruthy();
    expect(screen.getByText('В работе')).toBeTruthy();
    expect(screen.getByText('Ждёт приёмки')).toBeTruthy();
    expect(screen.queryByText('Уже закрыта')).toBeNull();

    fireEvent.click(screen.getByText('Согласовать смету').closest('button')!);
    expect(onOpenSubtask).toHaveBeenCalledWith(OPEN_SUBTASK.id);
  });

  it('при «подзадачи на утверждении не мешают» скрывает сданные на приёмку', () => {
    render(
      <TransitionGateDetails
        reasons={REASONS}
        gate={{ task: TASK, definitions: DEFINITIONS }}
        allowReview
      />,
    );

    expect(screen.getByText('Согласовать смету')).toBeTruthy();
    expect(screen.queryByText('Ждёт приёмки')).toBeNull();
  });

  it('называет незаполненные поля, чек-лист и файлы итога в числах', () => {
    render(
      <TransitionGateDetails reasons={REASONS} gate={{ task: TASK, definitions: DEFINITIONS }} />,
    );

    expect(screen.getByText('Чек-лист выполнен не полностью · 2 из 5')).toBeTruthy();
    expect(screen.getByText('Не заполнены обязательные поля')).toBeTruthy();
    expect(screen.getByText(`${ui.tasks.deadline}, Номер накладной`)).toBeTruthy();
    expect(screen.getByText('Нет файлов итога · 0 из 2')).toBeTruthy();
  });

  it('проверка по записям (#635): подпись, записи-ссылки, невидимые счётчиком', () => {
    render(
      <TransitionGateDetails
        reasons={[
          {
            kind: 'records',
            title: 'Задания смежникам не выполнены',
            records: [
              {
                id: '30000000-0000-4000-8000-000000000201',
                entityKind: 'task',
                name: 'Задание → КЖ1.1',
              },
              {
                id: '30000000-0000-4000-8000-000000000202',
                entityKind: 'letter',
                name: 'Вх-2026/115',
              },
              {
                id: '30000000-0000-4000-8000-000000000203',
                entityKind: 'node',
                name: 'Комплект КЖ-01',
              },
            ],
            hiddenCount: 2,
            totalCount: 7,
          },
        ]}
        gate={{ task: TASK, definitions: DEFINITIONS }}
      />,
    );

    expect(screen.getByText('Задания смежникам не выполнены')).toBeTruthy();
    // Задача и письмо — кнопки-ссылки (открывают карточку по entityKind),
    // у папки карточки нет — имя без перехода (#655).
    fireEvent.click(screen.getByText('Задание → КЖ1.1'));
    expect(cardOpen).toHaveBeenCalledWith({
      kind: 'task',
      id: '30000000-0000-4000-8000-000000000201',
    });
    expect(screen.getByText('Вх-2026/115').closest('button')).not.toBeNull();
    expect(screen.getByText('Комплект КЖ-01').closest('button')).toBeNull();
    // Видимость одна: невидимые записи — только счётчиком «и ещё N».
    expect(
      screen.getByText(`${ui.tasks.gateHiddenPrefix} 2 ${ui.tasks.gateHiddenFew}`),
    ).toBeTruthy();
    // Хвост сверх показанных (totalCount 7 − 3 записи): «и ещё 4 записи».
    expect(screen.getByText(`${ui.tasks.gateHiddenPrefix} 4 ${ui.tasks.gateMoreFew}`)).toBeTruthy();
  });

  it('переполненная выборка (#635): «проверка не может быть посчитана», записей нет', () => {
    render(
      <TransitionGateDetails
        reasons={[
          {
            kind: 'records',
            title: 'Все подзадачи выполнены',
            records: [],
            overflow: true,
          },
        ]}
        gate={{ task: TASK, definitions: DEFINITIONS }}
      />,
    );

    expect(
      screen.getByText(`${ui.tasks.gateOverflowPrefix} 500 ${ui.tasks.gateMoreMany}`, {
        exact: false,
      }),
    ).toBeTruthy();
  });

  it('формула-проверка (#635) показывает подпись настройщика', () => {
    render(
      <TransitionGateDetails
        reasons={[{ kind: 'formula', title: 'Комплект не собран' }]}
        gate={{ task: TASK, definitions: DEFINITIONS }}
      />,
    );
    expect(screen.getByText('Комплект не собран')).toBeTruthy();
  });
});
