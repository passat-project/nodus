import { describe, expect, it, afterEach } from 'vitest';

import { demoCustomFieldDefinitions } from '../../mocks/data/custom-fields.js';
import { processTypeIds } from '../../mocks/data/process-type-ids.js';
import { demoLetters } from '../../mocks/data/letters.js';
import { letterListItemOf } from '../../mocks/data/letters-model.js';
import { demoProjectRows } from '../../mocks/data/projects.js';
import { listItemOf, projectCustomFieldsOf } from '../../mocks/data/project-views.js';
import { currentAuthUser } from '../../mocks/data/users.js';
import { resetFormulaCells, writeFormulaCell } from './formula-state.js';
import { letterListItemWithFormulas, projectListItemWithFormulas } from './formula-dto.js';

/** Строка списка несёт атрибуты (#632, Р9): мок-мир отдаёт в списках писем и
 *  проектов те же значения, имена ссылок и формульное состояние, что в
 *  карточке — иначе колонки атрибутов и значок fx в списке пусты. */

afterEach(resetFormulaCells);

describe('letterListItemWithFormulas: строка списка писем (#632, Р9)', () => {
  const letter = demoLetters.find((entry) => Object.keys(entry.customFields).length > 0)!;
  // Атрибут, привязанный к типу входящего письма (демо-посев #631).
  const field = demoCustomFieldDefinitions.find((definition) =>
    definition.bindings.processTypeIds.includes(processTypeIds.letterIncoming),
  )!;

  it('значения, ссылки и формульное состояние приезжают строкой списка', () => {
    const item = letterListItemWithFormulas(letterListItemOf(letter), letter.customFields);
    expect(item.customFields).toEqual(letter.customFields);
    expect(item.customFieldRefs).toEqual(expect.any(Array));
    expect(item.customFieldFormulas).toEqual(expect.any(Object));
    // Строка остаётся строкой списка: реквизиты письма на месте.
    expect(item.id).toBe(letter.id);
    expect(item.regNumber).toBe(letter.regNumber);
  });

  it('своя формула ячейки — origin own и материализованное значение', () => {
    writeFormulaCell('letter', letter.id, field.id, {
      ast: { kind: 'literal', value: 'из формулы' },
      error: null,
      value: 'из формулы',
    });
    const item = letterListItemWithFormulas(letterListItemOf(letter), letter.customFields);
    expect(item.customFieldFormulas?.[field.id]).toEqual({ origin: 'own' });
    expect(item.customFields?.[field.id]).toBe('из формулы');
  });
});

describe('projectListItemWithFormulas: строка журнала проектов (#632, Р9)', () => {
  const project = demoProjectRows[0]!;
  // Демо-администратор: видит и открытые, и секретные проекты демо-мира.
  const actor = currentAuthUser;

  it('значения, ссылки и формульное состояние приезжают строкой журнала', () => {
    const item = projectListItemWithFormulas(
      listItemOf(project, actor),
      projectCustomFieldsOf(project),
    );
    expect(item.customFields).toEqual(projectCustomFieldsOf(project));
    expect(item.customFieldRefs).toEqual(expect.any(Array));
    expect(item.customFieldFormulas).toEqual(expect.any(Object));
    // Шифр проекта (системный атрибут) остаётся в производном поле строки.
    expect(item.code).toBe(listItemOf(project, actor).code);
  });
});
