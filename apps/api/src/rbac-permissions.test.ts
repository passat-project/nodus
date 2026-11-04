import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Permission } from '@nodus/contracts';
import { describe, expect, it } from 'vitest';

import {
  ADMIN_EXCLUDED_PERMISSIONS,
  ALL_PERMISSIONS,
  GRANTED_ADMIN_PERMISSIONS,
} from '../prisma/all-permissions.js';

/** Миграции — единственный путь данных на прод (seed там не запускается, #311/#398). */
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');

function grantedPermissions(): Set<string> {
  const granted = new Set<string>();
  for (const entry of readdirSync(migrationsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sql = readFileSync(join(migrationsDir, entry.name, 'migration.sql'), 'utf8');
    for (const block of sql.matchAll(/INSERT INTO "role_permissions"[\s\S]*?;/g)) {
      for (const match of block[0].matchAll(/'([a-zA-Z][a-zA-Z_.]+)'/g)) granted.add(match[1]!);
    }
  }
  return granted;
}

describe('каталог прав и миграции', () => {
  it('ALL_PERMISSIONS зеркалит каталог Permission contracts', () => {
    expect([...ALL_PERMISSIONS].sort()).toEqual([...Object.values(Permission)].sort());
  });

  it('сид-набор администратора = каталог − исключения системного надзора (#52)', () => {
    expect([...GRANTED_ADMIN_PERMISSIONS].sort()).toEqual(
      [...Object.values(Permission)]
        .filter(
          (permission) => !(ADMIN_EXCLUDED_PERMISSIONS as readonly string[]).includes(permission),
        )
        .sort(),
    );
    // Исключения — только права, реально существующие в каталоге.
    expect(
      ADMIN_EXCLUDED_PERMISSIONS.every((p) => Object.values(Permission).includes(p as Permission)),
    ).toBe(true);
  });

  it('каждое право Permission доезжает до прода миграцией role_permissions', () => {
    const granted = grantedPermissions();
    /** Права, намеренно не выданные ни одной роли по умолчанию (#52:
     *  project.channel.post — пишут руководство проекта + точечная выдача в
     *  матрице, Slack announcement-паттерн; #461: конфиденциальные письма —
     *  «никто, даже админ» В3). Список только сокращается. */
    const ungrantedByDesign = new Set(['project.channel.post', 'correspondence.view_confidential']);
    const missing = Object.values(Permission).filter(
      (permission) => !granted.has(permission) && !ungrantedByDesign.has(permission),
    );
    expect(
      missing,
      `Новое право не доставлено на прод: добавьте INSERT INTO "role_permissions" в миграцию (${missing.join(', ')})`,
    ).toEqual([]);
  });
});
