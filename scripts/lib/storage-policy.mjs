import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Политики сервисных учёток хранилища из docker-compose.yml (`minio-init`).
 *
 * `minio-init` печатает политики shell-командой `printf '<json>' … > /tmp/<имя>.json`
 * и создаёт их через `mcli admin policy create`. Разбор идёт по JSON-литералу,
 * а не по форме команды: политику можно переписать heredoc'ом, но пропустить
 * её тест не должен. `%s` — подстановка имени бакета в `printf`.
 *
 * Зачем страж (issue #713): minio-js режет загрузку по partSize = 64 МиБ и на
 * всём, что больше, идёт multipart-путём — он вызывает ListMultipartUploads и
 * ListParts. Политика без этих действий молча ломает файлы > 64 МиБ
 * (Access Denied → 400 FILE_SIZE_MISMATCH), причём лимит приложения — 100 МБ.
 */
export function storagePolicies(composeText) {
  const policies = [];
  // Имя — из пути `/tmp/<имя>.json`; в heredoc-форме оно на строке выше, поэтому
  // запоминаем последнее увиденное имя, а не ищем только в строке с JSON.
  let pendingName = 'unknown';
  for (const line of composeText.split('\n')) {
    pendingName = /\/tmp\/([\w.-]+\.json)/.exec(line)?.[1] ?? pendingName;
    if (!line.includes('{"Version":"2012-10-17"')) continue;
    const json = /'\{"Version":"2012-10-17".*\}'|\{"Version":"2012-10-17".*\}/.exec(line);
    if (!json) continue;
    const literal = json[0].replace(/^'|'$/g, '');
    const policy = JSON.parse(literal.replaceAll('%s', 'bucket'));
    policies.push({
      name: pendingName,
      actions: policy.Statement.flatMap((statement) => statement.Action),
      resources: policy.Statement.flatMap((statement) => statement.Resource),
    });
  }
  return policies;
}

/** Политики из рабочего дерева (по умолчанию — корневой docker-compose.yml). */
export function readStoragePolicies(file = path.join(ROOT, 'docker-compose.yml')) {
  return storagePolicies(fs.readFileSync(file, 'utf8'));
}
