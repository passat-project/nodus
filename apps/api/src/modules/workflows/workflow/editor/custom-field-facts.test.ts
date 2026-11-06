import { describe, expect, it, vi } from 'vitest';

import { customFieldFactsOf } from './custom-field-facts.js';

/** #646: `active` — весь реестр (атрибут существует), `inType` — только
 *  привязанные к типу процесса; иначе `custom_field_not_in_type` недостижим. */

function registry() {
  const definitions = vi.fn(async (opts?: { target?: { kind: string; id: string } }) =>
    opts?.target ? [{ id: 'bound-1' }] : [{ id: 'bound-1' }, { id: 'unbound-1' }],
  );
  return { definitions };
}

describe('customFieldFactsOf (#631, #646)', () => {
  it('active — весь реестр, inType — привязанные к типу', async () => {
    const r = registry();
    const facts = await customFieldFactsOf(r as never, {} as never, 'type-1');
    expect([...facts.active]).toEqual(['bound-1', 'unbound-1']);
    expect([...(facts.inType ?? [])]).toEqual(['bound-1']);
    expect(r.definitions).toHaveBeenCalledWith(
      { target: { kind: 'process_type', id: 'type-1' } },
      {},
    );
  });

  it('без типа — active весь реестр, inType отсутствует', async () => {
    const r = registry();
    const facts = await customFieldFactsOf(r as never, {} as never);
    expect([...facts.active]).toEqual(['bound-1', 'unbound-1']);
    expect(facts.inType).toBeUndefined();
    expect(r.definitions).toHaveBeenCalledTimes(1);
  });

  it('несколько типов маршрута: inType — пересечение привязок (publish multi-type)', async () => {
    const definitions = vi.fn(async (opts?: { target?: { kind: string; id: string } }) => {
      if (!opts?.target) return [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      return opts.target.id === 'type-1' ? [{ id: 'a' }, { id: 'b' }] : [{ id: 'b' }, { id: 'c' }];
    });
    const facts = await customFieldFactsOf({ definitions } as never, {} as never, [
      'type-1',
      'type-2',
    ]);
    // Слот формы создания обязан быть привязан к КАЖДОМУ типу маршрута.
    expect([...(facts.inType ?? [])]).toEqual(['b']);
    expect(definitions).toHaveBeenCalledTimes(3);
  });
});
