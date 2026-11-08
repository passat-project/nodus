import { describe, expect, it } from 'vitest';

import { CATALOG_PROCESS_TYPES, CATALOG_REVISION } from './system-catalog.js';
import { setup, stale, wfId } from './catalog-bootstrap.test-helper.js';

describe('CatalogBootstrap — письма (#55, Р5)', () => {
  it('сеет типы, маршруты, серии «Вх»/«Исх»; регистрация — окно и assign_number', async () => {
    const { bootstrap, repo } = setup({
      workflows: {
        'letter.incoming': { customizedAt: null, catalogRevision: 0 },
        'letter.outgoing': { customizedAt: null, catalogRevision: 0 },
      },
      emptyWorkflows: [wfId('letter.incoming'), wfId('letter.outgoing')],
    });
    await bootstrap.ensure();

    expect(repo.ensureSeries).toHaveBeenCalledWith(expect.anything(), {
      code: 'letter-incoming',
      prefix: 'Вх',
      name: 'Входящие письма',
    });
    expect(repo.ensureSeries).toHaveBeenCalledWith(expect.anything(), {
      code: 'letter-outgoing',
      prefix: 'Исх',
      name: 'Исходящие письма',
    });
    expect(repo.ensureType).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        code: 'letter-incoming',
        category: 'letter',
        direction: 'incoming',
        config: { numbering: { seriesId: 'series-letter-incoming' } },
      }),
    );

    const incoming = wfId('letter.incoming');
    const created = repo.createTransition.mock.calls.filter((call) => call[1] === incoming);
    expect(created).toHaveLength(CATALOG_PROCESS_TYPES[2]!.workflow.transitions.length);
    const register = created.find(
      (call) => (call[3] as { name: string }).name === 'Зарегистрировать',
    );
    expect(register![3]).toMatchObject({
      display: 'primary',
      form: { enabled: true, sections: [{ kind: 'registration' }] },
      rules: {
        conditions: [{ kind: 'permission', permission: 'correspondence.register' }],
        postFunctions: [{ kind: 'assign_number' }],
      },
    });
  });

  it('ревизии независимы: ревизия задач не перезасевает письма', async () => {
    const { bootstrap, repo } = setup({ workflows: stale('task.default') });
    await bootstrap.ensure();
    const letterCalls = repo.updateTransition.mock.calls.filter(
      (call) => call[1] === wfId('letter.incoming'),
    );
    expect(letterCalls).toHaveLength(0);
    expect(repo.applyWorkflowRevision).toHaveBeenCalledWith(
      expect.anything(),
      wfId('task.default'),
      CATALOG_REVISION,
    );
  });
});
