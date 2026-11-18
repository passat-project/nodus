import { describe, expect, it, vi } from 'vitest';

import { CounterpartyReaderProvider } from './counterparty-reader.provider.js';

const ID = '00000000-0000-4000-8000-000000000301';
const CONTACT_ID = '00000000-0000-4000-8000-000000000302';

const noContacts = { findRefs: vi.fn(), findActiveRef: vi.fn() };

describe('CounterpartyReaderProvider (#460, ADR-0012)', () => {
  it('refs: пустой вход — без запроса; name — краткое название', async () => {
    const repo = { findRefs: vi.fn().mockResolvedValue([{ id: ID, shortName: 'ООО «Тест»' }]) };
    const provider = new CounterpartyReaderProvider(repo as never, noContacts as never);

    expect(await provider.refs([])).toEqual([]);
    expect(repo.findRefs).not.toHaveBeenCalled();

    expect(await provider.refs([ID])).toEqual([{ id: ID, name: 'ООО «Тест»' }]);
  });

  it('activeRef: архивный или отсутствующий контрагент — null', async () => {
    const repo = { findActiveRef: vi.fn().mockResolvedValue(null) };
    const provider = new CounterpartyReaderProvider(repo as never, noContacts as never);
    expect(await provider.activeRef(ID)).toBeNull();

    repo.findActiveRef.mockResolvedValue({ id: ID, shortName: 'ООО «Тест»' });
    expect(await provider.activeRef(ID)).toEqual({ id: ID, name: 'ООО «Тест»' });
  });

  it('activeRefs: пачка действующих; пустой вход — без запроса (#646)', async () => {
    const repo = {
      findActiveRefs: vi.fn().mockResolvedValue([{ id: ID, shortName: 'ООО «Тест»' }]),
    };
    const provider = new CounterpartyReaderProvider(repo as never, noContacts as never);

    expect(await provider.activeRefs([])).toEqual([]);
    expect(repo.findActiveRefs).not.toHaveBeenCalled();

    expect(await provider.activeRefs([ID])).toEqual([{ id: ID, name: 'ООО «Тест»' }]);
    expect(repo.findActiveRefs).toHaveBeenCalledWith([ID]);
  });

  it('contactRefs: подписант пачкой, архивный читается; пустой вход — без запроса', async () => {
    const contacts = {
      findRefs: vi
        .fn()
        .mockResolvedValue([{ id: CONTACT_ID, fullName: 'Иванов И. И.', position: 'Директор' }]),
      findActiveRef: vi.fn(),
    };
    const provider = new CounterpartyReaderProvider({} as never, contacts as never);

    expect(await provider.contactRefs([])).toEqual([]);
    expect(contacts.findRefs).not.toHaveBeenCalled();

    expect(await provider.contactRefs([CONTACT_ID])).toEqual([
      { id: CONTACT_ID, fullName: 'Иванов И. И.', position: 'Директор' },
    ]);
  });

  it('activeContact: контакт чужого контрагента или архивный — null', async () => {
    const contacts = { findRefs: vi.fn(), findActiveRef: vi.fn().mockResolvedValue(null) };
    const provider = new CounterpartyReaderProvider({} as never, contacts as never);

    expect(await provider.activeContact(ID, CONTACT_ID)).toBeNull();
    expect(contacts.findActiveRef).toHaveBeenCalledWith(ID, CONTACT_ID);

    contacts.findActiveRef.mockResolvedValue({
      id: CONTACT_ID,
      fullName: 'Иванов И. И.',
      position: null,
    });
    expect(await provider.activeContact(ID, CONTACT_ID)).toEqual({
      id: CONTACT_ID,
      fullName: 'Иванов И. И.',
      position: null,
    });
  });
});
