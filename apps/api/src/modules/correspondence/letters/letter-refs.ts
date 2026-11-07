import type {
  ContactRef,
  CounterpartyRef,
  ProcessTypeRef,
  ProjectRef,
  ReceiptMethodRef,
  UserRef,
} from '@nodus/contracts';

import type { CatalogStage } from '../../workflows/ports/process-catalog-reader.port.js';

/** Ссылки страницы письма: гидратация пачками — один запрос на вид ссылки. */
export interface LetterRefs {
  stages: Map<string, CatalogStage>;
  types: Map<string, ProcessTypeRef>;
  counterparties: Map<string, CounterpartyRef>;
  contacts: Map<string, ContactRef>;
  users: Map<string, UserRef>;
  receipts: Map<string, ReceiptMethodRef>;
  projects: Map<string, ProjectRef>;
}

export const EMPTY_REFS = (): LetterRefs => ({
  stages: new Map(),
  types: new Map(),
  counterparties: new Map(),
  contacts: new Map(),
  users: new Map(),
  receipts: new Map(),
  projects: new Map(),
});

/** ISO-дата без времени (даты реестра — календарные). */
export const dateOnly = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;
