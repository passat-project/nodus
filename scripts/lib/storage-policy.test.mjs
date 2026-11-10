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

describe('storage policy (docker-compose, minio-init)', () => {
  const policies = readStoragePolicies();

  it('находит все сервисные политики — иначе страж смотрит в пустоту', () => {
    assert.deepEqual(policies.map((policy) => policy.name).sort(), EXPECTED_POLICIES);
  });

  for (const policy of policies) {
    it(`${policy.name}: разрешает multipart-список и части`, () => {
      for (const action of MULTIPART_ACTIONS) {
        assert.ok(policy.actions.includes(action), `${policy.name}: нет ${action}`);
      }
    });

    it(`${policy.name}: область — только свой бакет и его объекты`, () => {
      // Ровно два ARN одного бакета: сам бакет (ListBucket/списки) и его
      // объекты (`bucket/*`). Шаблон `arn:aws:s3:::*` или чужой бакет — провал.
      assert.equal(policy.resources.length, 2);
      const [bucketArn, objectsArn] = policy.resources;
      assert.match(bucketArn, /^arn:aws:s3:::[^*/]+$/, `${policy.name}: ${bucketArn}`);
      assert.equal(objectsArn, `${bucketArn}/*`);
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
