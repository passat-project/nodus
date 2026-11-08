// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui, type NumberSeriesRule } from '@nodus/contracts';

import { CounterSection } from './counter-section.js';
import { CounterContainerPick, containerKindsFor } from './counter-container-pick.js';
import { CounterInsertPalette, CounterNumberLine } from './counter-template-editor.js';
import { CounterTriggerHints, CounterTriggerSelect } from './counter-issuers.js';
import { CounterSearchPick } from './counter-search-pick.js';
import { countTitle, NextNumberEditor } from './counter-counts.js';

afterEach(cleanup);

const names = {
  nodeKind: (id: string) => (id === 'kind-1' ? 'Комплект' : undefined),
  field: (number: number) => (number === 7 ? 'Инв. №' : undefined),
};
const rule: NumberSeriesRule = {
  containers: [{ kind: 'folder', nodeKindId: 'kind-1' }],
  period: 'year',
  template: [{ kind: 'counter' }, { kind: 'literal', text: '-' }, { kind: 'year', digits: 2 }],
  startValue: 1,
  step: 1,
};

describe('счётчик: чистые компоненты окна правила (#630)', () => {
  it('CounterSection: сводка, последовательность, правки периода и длины', () => {
    const onChange = vi.fn();
    const onNextChange = vi.fn();
    const { container } = render(
      <CounterSection
        rule={rule}
        next={null}
        summary="свой счёт для каждой папки «Комплект», заново каждый год"
        creating={false}
        issuedCount={0}
        savedTemplate={null}
        definitions={[]}
        nodeKinds={[{ id: 'kind-1', name: 'Комплект' }]}
        names={names}
        hostKinds={['task']}
        fields={[]}
        fieldGroups={[{ source: 'self', fields: [] }]}
        recipients={<p>Кто получает</p>}
        coverage={<p>Охват</p>}
        disabled={false}
        onChange={onChange}
        onNextChange={onNextChange}
      />,
    );
    expect(container.firstChild).not.toBeNull();
    const length = screen.getByLabelText(ui.customFields.dialog.counter.segCounterLength);
    fireEvent.change(length, { target: { value: '4' } });
    expect(onChange).toHaveBeenCalled();
    const start = screen.getByLabelText(ui.customFields.dialog.counter.start);
    fireEvent.change(start, { target: { value: '10' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ startValue: 10 }));
  });

  it('CounterSection: заблокированное правило и смена вида', () => {
    render(
      <CounterSection
        rule={{ ...rule, containers: [] }}
        next={5}
        summary="сквозная"
        creating
        issuedCount={3}
        savedTemplate={[{ kind: 'counter' }]}
        definitions={[]}
        nodeKinds={[]}
        names={names}
        hostKinds={['task']}
        fields={[]}
        fieldGroups={[]}
        recipients={null}
        disabled={false}
        onChange={vi.fn()}
        onNextChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/уже выдан/i)).toBeTruthy();
  });

  it('CounterContainerPick: добавление и снятие условия', () => {
    const onChange = vi.fn();
    const { container } = render(
      <CounterContainerPick
        containers={[{ kind: 'folder', nodeKindId: 'kind-1' }]}
        hostKinds={['task']}
        nodeKinds={[{ id: 'kind-1', name: 'Комплект' }]}
        fields={[]}
        names={names}
        disabled={false}
        onChange={onChange}
      />,
    );
    expect(container.firstChild).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ещё условие/i }));
    expect(onChange).toHaveBeenCalled();
  });

  it('CounterContainerPick: условие папки и фильтр видов', () => {
    render(
      <CounterContainerPick
        containers={[{ kind: 'folder', nodeKindId: 'kind-1' }]}
        hostKinds={['task']}
        nodeKinds={[{ id: 'kind-1', name: 'Комплект' }]}
        fields={[]}
        names={names}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getAllByText(/Комплект/).length).toBeGreaterThan(0);
    expect(containerKindsFor(['task'])).toContain('folder');
    expect(containerKindsFor(['letter'])).not.toContain('folder');
  });

  it('CounterNumberLine и палитра: правка литерала и вставка поля', () => {
    const onChange = vi.fn();
    render(
      <>
        <CounterNumberLine
          template={rule.template}
          definitions={[]}
          names={names}
          disabled={false}
          onChange={onChange}
        />
        <CounterInsertPalette
          template={rule.template}
          fieldGroups={[{ source: 'self', fields: [] }]}
          disabled={false}
          onChange={onChange}
        />
      </>,
    );
    const literal = screen.getByDisplayValue('-');
    fireEvent.change(literal, { target: { value: '/' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('CounterTriggerSelect: кнопка, создание и подсказки', () => {
    const onChange = vi.fn();
    render(
      <>
        <CounterTriggerSelect
          targetId="type-1"
          host="task"
          rule={rule}
          onCreate={[]}
          issuers={[
            {
              processTypeId: 'type-1',
              transitionId: 't-1',
              transitionName: 'Выдать в печать',
            },
          ]}
          disabled={false}
          onChange={onChange}
        />
        <CounterTriggerSelect
          targetId="node-1"
          host="node"
          rule={rule}
          onCreate={[]}
          issuers={[]}
          disabled={false}
          onChange={onChange}
        />
        <CounterTriggerHints broken />
        <CounterTriggerHints broken={false} />
      </>,
    );
    expect(screen.getAllByText(/при создании/i).length).toBeGreaterThan(0);
  });

  it('CounterSearchPick: выбор из списка', () => {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as never;
    Element.prototype.scrollIntoView = vi.fn();
    const onChange = vi.fn();
    render(
      <CounterSearchPick
        label="Папка"
        search="Поиск"
        empty="Нет"
        value={null}
        options={[{ id: 'kind-1', name: 'Комплект' }]}
        disabled={false}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Папка/ }));
    fireEvent.click(screen.getByText('Комплект'));
    expect(onChange).toHaveBeenCalledWith('kind-1');
  });

  it('countTitle и NextNumberEditor: подпись счёта и сохранение', async () => {
    expect(countTitle([])).toEqual({ name: expect.any(String), path: '' });
    expect(
      countTitle([
        { entity: 'node', id: 'n', name: 'КЖ-01', path: ['Проект'], hidden: false, deleted: false },
      ]),
    ).toMatchObject({ name: 'КЖ-01', path: 'Проект' });
    const onSave = vi.fn(async () => undefined);
    render(<NextNumberEditor nextValue={5} disabled={false} onSave={onSave} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/Следующий номер/i), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: /Сохранить/i }));
    expect(onSave).toHaveBeenCalledWith(8);
  });
});
