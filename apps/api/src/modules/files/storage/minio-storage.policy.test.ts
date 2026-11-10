import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Страж политики сервисной учётки хранилища (#713). Механизм, который здесь
 * закрепляется: minio-js режет загрузку по `partSize = 64 МиБ` — файл больше
 * уходит multipart-путём, а он ДО отправки данных вызывает ListMultipartUploads
 * (поиск незавершённой загрузки для продолжения), при продолжении — ListParts.
 * Политика без этих действий даёт Access Denied, SDK валится, api отдаёт 400
 * FILE_SIZE_MISMATCH — хотя лимит приложения 100 МБ. Порог ничем не виден
 * снаружи, поэтому дрейф политики обязан ловиться тестом, а не по жалобе.
 *
 * Источник: minio 8.0.7 (`client.js`: partSize = 64 * 1024 * 1024,
 * putObject → uploadStream → findUploadId → listIncompleteUploadsQuery) и
 * действия S3-политики ListBucketMultipartUploads / ListMultipartUploadParts.
 */

/** Действия, которые SDK вызывает на пути файла > 64 МиБ. */
const MULTIPART_ACTIONS = ['s3:ListBucketMultipartUploads', 's3:ListMultipartUploadParts'];

/** Все политики, которые `minio-init` печатает в docker-compose.yml. */
function storagePolicies(): Array<{ name: string; actions: string[]; resources: string[] }> {
  const composePath = fileURLToPath(
    new URL('../../../../../../docker-compose.yml', import.meta.url),
  );
  const compose = readFileSync(composePath, 'utf8');
  const policies: Array<{ name: string; actions: string[]; resources: string[] }> = [];
  // Политика печатается shell-командой: printf '<json>' … > /tmp/nodus-*.json.
  for (const match of compose.matchAll(
    /printf '(\{"Version":.*?\})'[^\n]*?(\/tmp\/[\w.-]+\.json)/g,
  )) {
    const json = match[1]!.replaceAll('%s', 'bucket');
    const parsed = JSON.parse(json) as {
      Statement: Array<{ Action: string[]; Resource: string[] }>;
    };
    policies.push({
      name: match[2]!,
      actions: parsed.Statement.flatMap((statement) => statement.Action),
      resources: parsed.Statement.flatMap((statement) => statement.Resource),
    });
  }
  return policies;
}

describe('политика хранилища (docker-compose, minio-init)', () => {
  it('описывает хотя бы одну политику — иначе страж смотрит в пустоту', () => {
    expect(storagePolicies().length).toBeGreaterThan(0);
  });

  it.each(MULTIPART_ACTIONS)('разрешает %s — иначе файлы > 64 МиБ падают', (action) => {
    for (const policy of storagePolicies()) {
      expect(policy.actions, policy.name).toContain(action);
    }
  });

  it('не расширяет область до всех бакетов', () => {
    for (const policy of storagePolicies()) {
      expect(
        policy.resources.filter((resource) => resource === 'arn:aws:s3:::*'),
        policy.name,
      ).toEqual([]);
    }
  });
});
