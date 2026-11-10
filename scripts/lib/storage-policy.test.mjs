import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { readStoragePolicies, storagePolicies } from './storage-policy.mjs';

/**
 * Страж политики хранилища (issue #713) — в `scripts/`, потому что шаг
 * `pnpm test:scripts` в CI выполняется ВСЕГДА, а turbo-тесты пакетов — только
 * по изменённым путям: правка одного docker-compose.yml иначе прошла бы мимо.
 *
 * Контракт: каждая сервисная политика из `minio-init` разрешает действия,
 * которые клиент хранилища вызывает на пути файла > 64 МиБ, и не расширяет
 * область за свой бакет.
 */

/** Действия minio-js на multipart-пути: findUploadId (список) и listParts. */
const MULTIPART_ACTIONS = ['s3:ListBucketMultipartUploads', 's3:ListMultipartUploadParts'];

const EXPECTED_POLICIES = ['nodus-storage-rw.json', 'nodus-storage-test-rw.json'];

/**
 * Политики, которые ПИШУТ объекты (учётка api и тест-контур) — только им нужен
 * multipart-путь. Новая read-only учётка (конвертер, e2e) не должна получать
 * эти действия «чтобы тест был зелёным»: список ожидаемых имён фиксирован, и
 * добавление политики требует явного решения здесь.
 */
const WRITER_POLICIES = EXPECTED_POLICIES;

/** Ожидаемый бакет каждой политики: имя ↔ ARN не должны перепутаться. */
const EXPECTED_BUCKETS = {
  'nodus-storage-rw.json': 'arn:aws:s3:::bucket', // %s — STORAGE_BUCKET
  'nodus-storage-test-rw.json': 'arn:aws:s3:::nodus-test-files',
};

describe('storage policy (docker-compose, minio-init)', () => {
  const policies = readStoragePolicies();
  const byName = new Map(policies.map((policy) => [policy.name, policy]));

  it('находит все сервисные политики — иначе страж смотрит в пустоту', () => {
    assert.deepEqual(policies.map((policy) => policy.name).sort(), EXPECTED_POLICIES);
  });

  for (const name of WRITER_POLICIES) {
    it(`${name}: разрешает multipart-список и части`, () => {
      const policy = byName.get(name);
      assert.ok(policy, `${name}: политика не найдена`);
      for (const action of MULTIPART_ACTIONS) {
        assert.ok(policy.actions.includes(action), `${name}: нет ${action}`);
      }
    });
  }

  for (const policy of policies) {
    it(`${policy.name}: область — только свой бакет и его объекты`, () => {
      // Ровно два ARN одного ОЖИДАЕМОГО бакета: сам бакет (ListBucket/списки)
      // и его объекты (`bucket/*`). Шаблон `arn:aws:s3:::*`, чужой бакет или
      // перепутанные ARN между политиками — провал.
      assert.equal(policy.resources.length, 2);
      const bucketArn = EXPECTED_BUCKETS[policy.name];
      assert.ok(bucketArn, `${policy.name}: неожиданная политика`);
      assert.deepEqual(policy.resources.slice().sort(), [bucketArn, `${bucketArn}/*`].sort());
    });
  }

  it('разбор не зависит от формы команды (heredoc, другой mcli)', () => {
    const compose = [
      "mcli admin policy create local p /tmp/nodus-x.json <<'EOF'",
      '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:ListBucketMultipartUploads"],"Resource":["arn:aws:s3:::%s"]}]}',
      'EOF',
    ].join('\n');
    const [policy] = storagePolicies(compose);
    assert.deepEqual(policy, {
      name: 'nodus-x.json',
      actions: ['s3:ListBucketMultipartUploads'],
      resources: ['arn:aws:s3:::bucket'],
    });
  });
});
