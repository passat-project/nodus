import { Injectable } from '@nestjs/common';

import type { TransactionClient } from '../../core/database/transaction-runner.js';
import { ManagerDerivationRepository } from './manager-derivation.repository.js';

/**
 * Производный руководитель сотрудника (#923): единственная точка пересчёта
 * `users.manager_id` для вызывающих сервисов модуля. Модель — ближайший
 * активный глава вверх по дереву управленческих подразделений; ручное значение
 * клиента больше не принимается.
 */
@Injectable()
export class ManagerDerivationService {
  constructor(private readonly repository: ManagerDerivationRepository) {}

  /** Пересчёт пачки сотрудников в транзакции вызывающего (outbox пишет он же). */
  recomputeUsers(userIds: readonly string[], tx: TransactionClient): Promise<string[]> {
    return this.repository.recomputeForUsers(userIds, tx);
  }

  /** Пересчёт поддерева подразделений (глава/родитель/архив). */
  recomputeDepartments(departmentIds: readonly string[], tx: TransactionClient): Promise<string[]> {
    return this.repository.recomputeForDepartments(departmentIds, tx);
  }
}
