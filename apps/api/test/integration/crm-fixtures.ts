import { expect } from 'vitest';
import { Permission, counterpartyCardSchema, type CounterpartyCard } from '@nodus/contracts';

import { EventDispatcher } from '../../src/core/events/event-dispatcher.js';
import { FeatureFlagService } from '../../src/core/feature-flags/feature-flag.service.js';
import { TokenService } from '../../src/modules/auth/token.service.js';
import { setupChatFixture, type ChatTestFixture, type ChatUser } from './chat-fixtures.js';
import { quiesceOutbox } from './outbox-test-utils.js';

/**
 * Фикстура интеграционных тестов CRM (#460): живое приложение на общей
 * фикстуре чата, флаг модуля включён, два токена одного сотрудника —
 * без прав (читает справочник) и с правами `crm.create`/`crm.manage`.
 * Уборка — свои записи по метке прогона + события агрегата `counterparty`.
 */
export interface CrmTestFixture {
  fx: ChatTestFixture<'alice' | 'bob'>;
  employee: ChatUser;
  manager: ChatUser;
  /** Созданные в прогоне контрагенты — для уборки и проверок. */
  created: string[];
  /** Метка прогона в названиях («Проба <runId> …»). */
  name(suffix: string): string;
  create(body: Record<string, unknown>): Promise<CounterpartyCard>;
  cleanup(): Promise<void>;
}

export async function setupCrmFixture(): Promise<CrmTestFixture> {
  const fx = await setupChatFixture(['alice', 'bob']);
  const employee = fx.users.alice;
  const flags = fx.app.get(FeatureFlagService);
  await fx.prisma.featureFlag.upsert({
    where: { key: 'crm' },
    update: { enabled: true },
    create: { key: 'crm', enabled: true },
  });
  await flags.setEnabled('crm', true);

  const permissions = [Permission.CRM_CREATE, Permission.CRM_MANAGE];
  const manager: ChatUser = {
    ...employee,
    token: await fx.app
      .get(TokenService)
      .signAccessToken(
        { id: employee.id, email: employee.email, displayName: employee.displayName, permissions },
        'integration-test-session',
      ),
  };

  const created: string[] = [];
  const name = (suffix: string) => `Проба ${fx.runId} ${suffix}`;

  return {
    fx,
    employee,
    manager,
    created,
    name,
    async create(body) {
      const res = await fx.api(manager, 'POST', '/counterparties', { body });
      expect(res.status, await res.clone().text()).toBe(201);
      const card = counterpartyCardSchema.parse(await res.json());
      created.push(card.id);
      return card;
    },
    async cleanup() {
      // #528: та же гонка usages → counterparty при позднем letter.*/project.*.
      await quiesceOutbox(fx.app.get(EventDispatcher));
      await fx.prisma.counterpartyUsage.deleteMany({ where: { counterpartyId: { in: created } } });
      await fx.prisma.contactPerson.deleteMany({ where: { counterpartyId: { in: created } } });
      await fx.prisma.counterparty.deleteMany({ where: { id: { in: created } } });
      await fx.prisma.event.deleteMany({
        where: { aggregateType: 'counterparty', aggregateId: { in: created } },
      });
      await fx.cleanup();
    },
  };
}
