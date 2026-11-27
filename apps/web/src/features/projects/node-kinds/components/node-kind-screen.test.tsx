// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NodeKind } from '@nodus/contracts';
import { ui } from '@nodus/contracts';

// Стенд — первым импортом: моки должны встать до импорта экрана и его зависимостей.
import {
  harness,
  KIND,
  KIND_ID,
  resetScreen,
  setup,
  TASK,
} from './node-kind-screen.test-harness.js';
import { useNodeKinds } from '../../../../shared/api/node-kinds.js';
import { useTypeSettingsStore } from '../../../../shared/ui/type-settings-store.js';
import { NodeKindScreen } from './node-kind-screen.js';

const { autosave, openCardSpy } = harness;

beforeEach(resetScreen);

describe('экран типа папки — рама с вкладками (#857)', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('вкладки «Форма создания» · «Типы задач в папке» · «Где используется»; форма — по умолчанию, имя справа не дублируется', () => {
    setup();
    // Строка формы — общая на все сущности «Процессов» (единая модель, #857).
    expect(screen.getByTestId('kind-form-tab')).toBeTruthy();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent?.trim())).toEqual([
      ui.automation.entry.formTab,
      ui.nodeKinds.screen.works,
      ui.nodeKinds.screen.usage,
    ]);
    expect(
      screen.getByRole('tab', { name: ui.automation.entry.formTab }).getAttribute('aria-selected'),
    ).toBe('true');
    // Имя и плитка типа живут только в строке колонки слева.
    expect(screen.queryByText('Комплект')).toBeNull();
  });

  it('бар без дорожки и крошки возврата: без строки-подсказки над содержимым', () => {
    setup();
    // Строки места типа над содержимым больше нет (замечание владельца 27.11).
    expect(screen.queryByText(ui.automation.entry.usageEverywhere)).toBeNull();
    // Кнопки «назад» с именем типа проекта в баре нет: строка списка открывает карточку поверх.
    expect(screen.queryByRole('button', { name: /Договор/ })).toBeNull();
    // В баре единственная кнопка — шестерёнка настроек (вкладки — role=tab).
    expect(
      screen.getAllByRole('button').map((button) => button.getAttribute('aria-label')),
    ).toEqual([ui.automation.menuSettingsType]);
  });

  it('«Типы задач в папке»: тумблер байндит и анбайндит folderKindId', () => {
    const { mutate } = setup({ tasks: [TASK('t1', null)] });
    fireEvent.click(screen.getByRole('tab', { name: ui.nodeKinds.screen.works }));
    const toggle = screen.getByRole('switch', { name: /Задание смежнику/ });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(mutate).toHaveBeenCalledWith({
      typeId: 't1',
      creation: expect.objectContaining({ folderKindId: KIND_ID }),
    });

    // уже привязанная работа: снятие пишет null
    cleanup();
    vi.clearAllMocks();
    const bound = setup({ tasks: [TASK('t2', KIND_ID)] });
    fireEvent.click(screen.getByRole('tab', { name: ui.nodeKinds.screen.works }));
    const boundToggle = screen.getByRole('switch', { name: /Задание смежнику/ });
    expect(boundToggle.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(boundToggle);
    expect(bound.mutate).toHaveBeenCalledWith({
      typeId: 't2',
      creation: expect.objectContaining({ folderKindId: null }),
    });
  });

  it('«Типы задач в папке»: список без чекбоксов; клик по строке кладёт карточку типа задачи ПОВЕРХ', () => {
    setup({ tasks: [TASK('t1', null)] });
    fireEvent.click(screen.getByRole('tab', { name: ui.nodeKinds.screen.works }));
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    fireEvent.click(screen.getByText('Задание смежнику'));
    expect(openCardSpy).toHaveBeenCalledTimes(1);
    expect(openCardSpy.mock.calls[0]![0]).toEqual({ kind: 'process-type', id: 't1' });
  });

  it('шестерёнка бара просит общий стор открыть настройки этого типа — рама не переезжает', () => {
    setup();
    // Самого окна в экране нет: его рендерит резидентный хост уровня app.
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: ui.automation.menuSettingsType }));
    expect(useTypeSettingsStore.getState().target).toEqual({ kind: 'node-kind', id: KIND_ID });
    expect(openCardSpy).not.toHaveBeenCalled();
  });

  it('архивный тип: шестерёнка открывает настройки того же вида (в окне — возврат)', () => {
    setup({ kinds: [{ ...KIND, archivedAt: '2026-11-01T00:00:00.000Z' } as unknown as NodeKind] });
    fireEvent.click(screen.getByRole('button', { name: ui.automation.menuSettingsType }));
    expect(useTypeSettingsStore.getState().target).toEqual({ kind: 'node-kind', id: KIND_ID });
  });

  it('форма получает слот «Создать атрибут» (окно фичи automation, I6); правки атрибута — в самом редакторе окна', () => {
    const renderCreateField = vi.fn(() => null);
    const { view } = setup();
    act(() => {
      view.rerender(
        <QueryClientProvider client={new QueryClient()}>
          <NodeKindScreen
            kindId={KIND_ID}
            onMissing={vi.fn()}
            renderCreateField={renderCreateField}
          />
        </QueryClientProvider>,
      );
    });
    expect(screen.getByTestId('kind-form-tab').dataset.createFieldSlot).toBe('yes');
  });

  it('уход с вкладки формы сохраняет недавнюю правку сразу; линия состояния — слева от шестерёнки', () => {
    setup();
    fireEvent.click(screen.getByRole('tab', { name: ui.nodeKinds.screen.works }));
    expect(autosave.flush).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('tab', { name: ui.automation.entry.formTab }));
    expect(autosave.flush).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();

    autosave.state = 'error';
    setup();
    const line = screen.getByRole('alert');
    expect(line.textContent).toContain(ui.forms.builder.notSaved);
    fireEvent.click(within(line).getByRole('button', { name: ui.forms.builder.retry }));
    expect(autosave.retry).toHaveBeenCalledTimes(1);
    autosave.state = 'idle';
  });

  it('смена kindId сбрасывает вкладку на форму', () => {
    const { view, props } = setup();
    fireEvent.click(screen.getByRole('tab', { name: ui.nodeKinds.screen.works }));
    expect(screen.queryByTestId('kind-form-tab')).toBeNull();
    const other = { ...KIND, id: 'other-kind' } as unknown as NodeKind;
    act(() => {
      view.rerender(
        <QueryClientProvider client={new QueryClient()}>
          <NodeKindScreen {...props} kindId={other.id} />
        </QueryClientProvider>,
      );
    });
    vi.mocked(useNodeKinds).mockReturnValue({
      data: [other],
      isLoading: false,
    } as never);
    act(() => {
      view.rerender(
        <QueryClientProvider client={new QueryClient()}>
          <NodeKindScreen {...props} kindId={other.id} />
        </QueryClientProvider>,
      );
    });
    expect(screen.getByTestId('kind-form-tab')).toBeTruthy();
  });

  it('пропавший тип: экран просит закрыть себя (onMissing)', () => {
    const { view, props, onMissing } = setup();
    act(() => {
      view.rerender(
        <QueryClientProvider client={new QueryClient()}>
          <NodeKindScreen {...props} kindId="missing" />
        </QueryClientProvider>,
      );
    });
    expect(onMissing).toHaveBeenCalledTimes(1);
  });
});
