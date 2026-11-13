import { Injectable } from '@nestjs/common';
import type { ContactRef, CounterpartyRef } from '@nodus/contracts';

import { CounterpartiesRepository } from '../counterparties/counterparties.repository.js';
import { ContactsRepository } from '../contacts/contacts.repository.js';
import type { CounterpartyReader } from './counterparty-reader.port.js';

/**
 * Реализация read-порта контрагентов (ADR-0012): наружу — только интерфейс,
 * таблицы crm читаются через собственные репозитории модуля. `name` ссылки —
 * краткое (витринное) название, как в остальных ref-контрактах.
 */
@Injectable()
export class CounterpartyReaderProvider implements CounterpartyReader {
  constructor(
    private readonly counterparties: CounterpartiesRepository,
    private readonly contacts: ContactsRepository,
  ) {}

  async refs(ids: readonly string[]): Promise<CounterpartyRef[]> {
    if (ids.length === 0) return [];
    const rows = await this.counterparties.findRefs(ids);
    return rows.map((row) => ({ id: row.id, name: row.shortName }));
  }

  async activeRef(id: string): Promise<CounterpartyRef | null> {
    const row = await this.counterparties.findActiveRef(id);
    return row ? { id: row.id, name: row.shortName } : null;
  }

  async activeRefs(ids: readonly string[]): Promise<CounterpartyRef[]> {
    if (ids.length === 0) return [];
    const rows = await this.counterparties.findActiveRefs(ids);
    return rows.map((row) => ({ id: row.id, name: row.shortName }));
  }

  async contactRefs(ids: readonly string[]): Promise<ContactRef[]> {
    if (ids.length === 0) return [];
    const rows = await this.contacts.findRefs(ids);
    return rows.map((row) => ({ id: row.id, fullName: row.fullName, position: row.position }));
  }

  async activeContact(counterpartyId: string, contactId: string): Promise<ContactRef | null> {
    const row = await this.contacts.findActiveRef(counterpartyId, contactId);
    return row ? { id: row.id, fullName: row.fullName, position: row.position } : null;
  }

  searchIds(query: string, limit: number): Promise<string[]> {
    return this.counterparties.searchIds(query, limit);
  }

  async findContactsByEmail(
    email: string,
  ): Promise<{ counterpartyId: string; contactId: string }[]> {
    const rows = await this.contacts.findByEmail(email);
    return rows.map((row) => ({ counterpartyId: row.counterpartyId, contactId: row.id }));
  }
}
