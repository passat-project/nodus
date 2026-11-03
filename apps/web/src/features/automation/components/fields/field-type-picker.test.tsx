// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ui } from '@nodus/contracts';

import { FieldTypePicker } from './field-type-picker.js';

/** #491: без права `dictionary.manage` тип «Список» недоступен и объясняет
 *  почему; с правом — обычная доступная плитка. */
describe('выбор типа атрибута: право на справочники (#491)', () => {
  afterEach(cleanup);

  const base = { value: null, locked: false, disabled: false, onChange: () => {} };

  it('без dictionary.manage «Список» недоступен с подсказкой', () => {
    render(<FieldTypePicker {...base} canManageDictionaries={false} />);
    const list = screen.getByRole('radio', { name: ui.customFields.families.list });
    expect((list as HTMLButtonElement).disabled).toBe(true);
    expect(list.getAttribute('title')).toBe(ui.customFields.typeUnavailable.dictionaries);
  });

  it('с dictionary.manage «Список» доступен', () => {
    render(<FieldTypePicker {...base} canManageDictionaries />);
    const list = screen.getByRole('radio', { name: ui.customFields.families.list });
    expect((list as HTMLButtonElement).disabled).toBe(false);
    expect(list.getAttribute('title')).toBe(ui.customFields.familyHints.list);
  });
});
