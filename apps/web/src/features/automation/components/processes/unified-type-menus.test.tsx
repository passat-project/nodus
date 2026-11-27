// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { ui } from '@nodus/contracts';

import { KindRowMenu, ProcessRowMenu, ProjectRowMenu } from './unified-type-menus.js';

const noop = () => undefined;
type Kind = 'task' | 'letter' | 'project' | 'folder';

function menuOf(
  kind: Kind,
  archived = false,
  handlers: { onArchive: () => void; onRestore: () => void } = {
    onArchive: noop,
    onRestore: noop,
  },
): ReactElement {
  const common = { archived, onOpenSettings: noop, onCopy: noop, ...handlers };
  switch (kind) {
    case 'task':
      return <ProcessRowMenu isTask isSystem={false} {...common} />;
    case 'letter':
      // Каталог писем системный (#55).
      return <ProcessRowMenu isTask={false} isSystem {...common} />;
    case 'project':
      return <ProjectRowMenu {...common} />;
    case 'folder':
      return <KindRowMenu {...common} />;
  }
}

/** Открыть «⋯» и вернуть пункты меню (прежние меню сняты). */
async function itemsOf(menu: ReactElement): Promise<HTMLElement[]> {
  cleanup();
  render(menu);
  const trigger = screen.getByRole('button', { name: ui.common.rowMenu });
  fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' });
  fireEvent.click(trigger);
  return within(await screen.findByRole('menu')).getAllByRole('menuitem');
}
const labelsOf = async (kind: Kind) =>
  (await itemsOf(menuOf(kind))).map((item) => item.textContent);

afterEach(cleanup);

describe('строки единой колонки: подписи меню «⋯» одного образца (#857, Д3)', () => {
  it('заголовки окон настроек и действия с архивом — по одному образцу на все четыре вида', () => {
    expect(ui.common.typeSettings).toEqual({
      title: {
        task: 'Настройки типа задачи',
        letter: 'Настройки типа письма',
        project: 'Настройки типа проекта',
        folder: 'Настройки типа папки',
      },
      archive: 'Архивировать тип',
      restore: 'Вернуть тип',
    });
  });

  it('живая строка: «Настройки типа…» и «Архивировать тип» — у всех видов одинаково', async () => {
    const SETTINGS = ui.automation.menuSettingsType;
    const COPY = ui.automation.menuCopyType;
    const ARCHIVE = ui.common.typeSettings.archive;
    expect(await labelsOf('task')).toEqual([SETTINGS, COPY, ARCHIVE]);
    // Каталог писем заморожен (#55): копии нет.
    expect(await labelsOf('letter')).toEqual([SETTINGS, ARCHIVE]);
    expect(await labelsOf('project')).toEqual([SETTINGS, COPY, ARCHIVE]);
    expect(await labelsOf('folder')).toEqual([SETTINGS, COPY, ARCHIVE]);
  });

  it('архивная строка: единственный пункт — «Вернуть тип», действие — возврат', async () => {
    // Письма — системный каталог: в архив не попадают.
    for (const kind of ['task', 'project', 'folder'] as const) {
      const handlers = { onArchive: vi.fn(), onRestore: vi.fn() };
      const items = await itemsOf(menuOf(kind, true, handlers));
      expect(items.map((item) => item.textContent)).toEqual([ui.common.typeSettings.restore]);
      if (!items[0]) throw new Error('нет пункта возврата');
      fireEvent.click(items[0]);
      expect(handlers.onRestore).toHaveBeenCalledTimes(1);
      expect(handlers.onArchive).not.toHaveBeenCalled();
    }
  });

  it('системный тип: «Архивировать тип» выключен с пояснением, клик ничего не делает', async () => {
    const onArchive = vi.fn();
    const items = await itemsOf(menuOf('letter', false, { onArchive, onRestore: noop }));
    const item = items.at(-1);
    if (!item) throw new Error('нет пункта архива');
    expect(item.textContent).toBe(ui.common.typeSettings.archive);
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.getAttribute('title')).toBe(ui.automation.archiveSystemLocked);
    fireEvent.click(item);
    expect(onArchive).not.toHaveBeenCalled();
  });
});
