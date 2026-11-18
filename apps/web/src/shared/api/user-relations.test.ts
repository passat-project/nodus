import { describe, expect, it } from 'vitest';

import { assigneeTasksUrl, memberProjectsUrl } from './user-relations.js';

/** AUD-028 (#866): вкладки-связи карточки сотрудника не должны показывать
 *  пересечение со смотрящим — только его собственное участие. */
describe('адреса вкладок карточки сотрудника (#866, AUD-028)', () => {
  it('задачи: scope=all вместе с assigneeId', () => {
    const url = assigneeTasksUrl('00000000-0000-4000-8000-000000000001');
    expect(url).toContain('assigneeId=00000000-0000-4000-8000-000000000001');
    expect(url).toContain('scope=all');
  });

  it('проекты: scope=all вместе с memberId', () => {
    const url = memberProjectsUrl('00000000-0000-4000-8000-000000000001');
    expect(url).toContain('memberId=00000000-0000-4000-8000-000000000001');
    expect(url).toContain('scope=all');
  });

  it('серверный поиск во вкладках (#956): search в обоих списках', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(assigneeTasksUrl(id, 'ПП-12')).toContain(`search=${encodeURIComponent('ПП-12')}`);
    expect(memberProjectsUrl(id, 'Смета')).toContain(`search=${encodeURIComponent('Смета')}`);
    // Пустой запрос не добавляет параметр (канонический URL без поиска).
    expect(assigneeTasksUrl(id, '  ')).not.toContain('search=');
  });
});
