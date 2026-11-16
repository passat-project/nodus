// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { useFileServersStore } from '../../desktop/file-servers-store.js';
import { LinkEditor } from './link-editor.js';

/**
 * Ссылка-путь в карточке (#558): действия стоят РЯДОМ с триггером правки
 * (кнопка в кнопке запрещена), «Открыть» не включает режим ввода.
 */

const DEFINITION = {
  id: '55000000-0000-4000-8000-000000000001',
  number: 1,
  type: 'link',
  name: 'Файл комплекта',
  hint: null,
  settings: {},
  dictionary: null,
  defaultValue: null,
  defaultRefs: [],
  reportIndexed: false,
  isCompany: false,
  companyValue: null,
  bindings: { processTypeIds: [], projectTypeIds: [], nodeKindIds: [] },
  sortOrder: 0,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
} satisfies CustomFieldDefinition;

const PATH = '\\\\FS01\\Projects\\план.pdf';

function editor() {
  return render(
    <LinkEditor
      definition={DEFINITION}
      value={PATH}
      refs={[]}
      disabled={false}
      variant="inline"
      onCommit={vi.fn()}
    />,
  );
}

afterEach(() => {
  cleanup();
  delete window.nodusDesktop;
  useFileServersStore.setState({ servers: [], loaded: false });
});

describe('ссылка-путь в карточке (#558)', () => {
  it('в оболочке действия стоят рядом и не вкладываются в кнопку правки', async () => {
    const openUncPath = vi.fn(async () => undefined);
    window.nodusDesktop = {
      shellVersion: '1.0.21',
      platform: 'windows',
      openUncPath,
      revealUncPath: vi.fn(async () => undefined),
    } as never;
    useFileServersStore.setState({ servers: ['\\\\FS01\\Projects'], loaded: true });
    editor();

    const open = screen.getByRole('button', { name: ui.customFields.value.openPath });
    const edit = screen.getByRole('button', { name: DEFINITION.name });
    expect(edit.contains(open)).toBe(false);

    fireEvent.click(open);
    await vi.waitFor(() => expect(openUncPath).toHaveBeenCalledWith(PATH, ['\\\\FS01\\Projects']));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('в браузере — копирование и подсказка, действий открытия нет', () => {
    editor();
    expect(screen.getByRole('button', { name: ui.customFields.value.copyPath })).toBeTruthy();
    // Подсказка в карточке — ВИДИМОЙ строкой под значением (не иконкой ⓘ):
    // иконка без наведения не объясняла, почему файл не открывается.
    expect(screen.getByText(ui.customFields.value.openInAppHint)).toBeTruthy();
    expect(screen.queryByRole('button', { name: ui.customFields.value.openPath })).toBeNull();
  });
});
