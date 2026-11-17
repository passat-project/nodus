// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BoardColumn } from './board-column.js';

function renderColumn(props: { count: number; cardIds: string[] }) {
  return render(
    <DndContext>
      <BoardColumn
        stage={{ id: 's1', name: 'В работе', color: 'info' }}
        count={props.count}
        cardIds={props.cardIds}
        hasNext={false}
        loadingMore={false}
        onLoadMore={() => undefined}
        emptyLabel="Нет задач"
        dropLabel="Отпустите здесь"
      >
        {props.cardIds.map((id) => (
          <div key={id}>{id}</div>
        ))}
      </BoardColumn>
    </DndContext>,
  );
}

describe('BoardColumn — заглушка пустой колонки', () => {
  afterEach(cleanup);

  it('пустая колонка показывает заглушку', () => {
    renderColumn({ count: 0, cardIds: [] });
    expect(screen.getByText('Нет задач')).not.toBeNull();
  });

  it('карточка уже в ленте, а счётчик ещё 0 (перенос) — заглушки нет одновременно с появлением карточки', () => {
    renderColumn({ count: 0, cardIds: ['t1'] });
    expect(screen.getByText('t1')).not.toBeNull();
    expect(screen.queryByText('Нет задач')).toBeNull();
  });
});

describe('BoardColumn: Esc в быстром добавлении (#843)', () => {
  afterEach(cleanup);

  it('Esc гасит только инлайн-инпут, доска под ним не закрывается', () => {
    const onKeyDown = vi.fn();
    const onCreate = vi.fn();
    render(
      <div onKeyDown={onKeyDown}>
        <DndContext>
          <BoardColumn
            stage={{ id: 's1', name: 'В работе', color: 'info' }}
            count={0}
            cardIds={[]}
            hasNext={false}
            loadingMore={false}
            onLoadMore={() => undefined}
            quickAdd={{ placeholder: 'Название', addButtonLabel: 'Добавить', onCreate }}
            emptyLabel="Нет задач"
            dropLabel="Отпустите здесь"
          >
            {null}
          </BoardColumn>
        </DndContext>
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }));
    const input = screen.getByPlaceholderText('Название');
    fireEvent.change(input, { target: { value: 'Новая' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByPlaceholderText('Название')).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
    // Инлайн-редактор погасил Esc — доска под ним событие не получает.
    expect(onKeyDown).not.toHaveBeenCalled();
  });
});
