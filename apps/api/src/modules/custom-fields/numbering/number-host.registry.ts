import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import type { NumberContainerHit, NumberContainerRef, NumberHostKind } from '@nodus/contracts';

import type { TransactionClient } from '../../../core/database/transaction-runner.js';
import type {
  NumberActor,
  NumberHostProvider,
  NumberHostRecord,
} from '../ports/number-host.port.js';
import type { NumberHostRegistry as NumberHostRegistryPort } from '../ports/number-host.port.js';

/** Провайдер-носитель: виды записей — статический маркер (как
 *  `workflowCategory` адаптеров и `eventType` обработчиков событий). */
interface NumberHostProviderClass {
  readonly numberHostKinds: readonly NumberHostKind[];
}

/**
 * Реестр носителей номеров (#630): при bootstrap обходит провайдеры
 * приложения через DiscoveryService и складывает их по видам записей.
 * Почему не @Global-токен: провайдеру нужны доменные репозитории своего
 * модуля, а токен не складывается из нескольких модулей. Два провайдера
 * одного вида — ошибка сборки графа.
 */
@Injectable()
export class NumberHostRegistry implements NumberHostRegistryPort, OnApplicationBootstrap {
  private readonly byKind = new Map<NumberHostKind, NumberHostProvider>();

  constructor(private readonly discovery: DiscoveryService) {}

  onApplicationBootstrap(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const instance = wrapper.instance as Partial<NumberHostProvider> | null;
      const kinds = (instance?.constructor as NumberHostProviderClass | undefined)?.numberHostKinds;
      if (!kinds || typeof instance?.listHosts !== 'function') continue;
      for (const kind of kinds) {
        if (this.byKind.has(kind)) {
          throw new Error(`Number host provider for kind "${kind}" is already registered`);
        }
        this.byKind.set(kind, instance as NumberHostProvider);
      }
    }
  }

  async list(
    tx: TransactionClient,
    actor: NumberActor,
    typeIds: readonly string[],
  ): Promise<NumberHostRecord[]> {
    const out: NumberHostRecord[] = [];
    for (const provider of new Set(this.byKind.values())) {
      out.push(...(await provider.listHosts(tx, actor, typeIds)));
    }
    return out;
  }

  async find(
    tx: TransactionClient,
    actor: NumberActor,
    kind: NumberHostKind,
    id: string,
  ): Promise<NumberHostRecord | null> {
    return this.byKind.get(kind)?.findHost(tx, actor, kind, id) ?? null;
  }

  async writeNumber(
    tx: TransactionClient,
    kind: NumberHostKind,
    id: string,
    fieldId: string,
    display: string,
  ): Promise<void> {
    const provider = this.byKind.get(kind);
    if (!provider) throw new Error(`No number host provider for kind "${kind}"`);
    await provider.writeNumber(tx, kind, id, fieldId, display);
  }

  async resolveRef(
    tx: TransactionClient,
    hit: NumberContainerHit,
    actor: NumberActor,
  ): Promise<NumberContainerRef | null> {
    for (const provider of new Set(this.byKind.values())) {
      const ref = await provider.resolveRef(tx, hit, actor);
      if (ref) return ref;
    }
    return null;
  }

  async countWithoutNumber(
    tx: TransactionClient,
    typeIds: readonly string[],
    fieldId: string,
  ): Promise<number> {
    let total = 0;
    for (const provider of new Set(this.byKind.values())) {
      total += await provider.countWithoutNumber(tx, typeIds, fieldId);
    }
    return total;
  }
}
