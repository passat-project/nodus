import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Страж миграции «несколько заместителей» (#817): данные старой колонки
 * `departments.deputy_id` обязаны переехать в `department_deputies` ДО её
 * удаления. Живой прогон миграции — на бутстрапе песочницы/деплое (psql не в
 * юнит-гейтах); здесь — статическая проверка, что бэкфилл и его верификация
 * не потерялись при правках SQL.
 */

const SQL = readFileSync(
  join(process.cwd(), 'prisma/migrations/20261125120000_department_deputies/migration.sql'),
  'utf8',
);

/** Позиция подстроки в SQL (для проверки порядка шагов). */
const at = (needle: string) => SQL.indexOf(needle);

describe('миграция department_deputies: бэкфилл из deputy_id (#817)', () => {
  it('создаёт таблицу связи с составным ключом и порядком', () => {
    expect(SQL).toContain('CREATE TABLE "department_deputies"');
    expect(SQL).toContain('PRIMARY KEY ("department_id","user_id")');
    expect(SQL).toContain('"sort_order" INTEGER NOT NULL DEFAULT 0');
  });

  it('переносит одиночного заместителя в первую запись связи', () => {
    const insert = SQL.slice(at('INSERT INTO "department_deputies"'), at('-- Проверка'));
    expect(insert).toContain('SELECT "id", "deputy_id", 0');
    expect(insert).toContain('FROM "departments"');
    expect(insert).toContain('WHERE "deputy_id" IS NOT NULL');
  });

  it('бэкфилл идёт ДО удаления старой колонки (данные не теряются)', () => {
    expect(at('INSERT INTO "department_deputies"')).toBeGreaterThan(-1);
    expect(at('INSERT INTO "department_deputies"')).toBeLessThan(at('DROP COLUMN "deputy_id"'));
    expect(at('DO $$')).toBeLessThan(at('DROP COLUMN "deputy_id"'));
  });

  it('старая колонка, её FK и индекс удаляются тем же заходом', () => {
    expect(SQL).toContain('DROP CONSTRAINT "departments_deputy_id_fkey"');
    expect(SQL).toContain('DROP INDEX "departments_deputy_id_idx"');
    expect(SQL).toContain('ALTER TABLE "departments" DROP COLUMN "deputy_id"');
  });

  it('связи уходят каскадом при удалении подразделения/сотрудника', () => {
    expect(SQL).toContain(
      'FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE',
    );
    expect(SQL).toContain('FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE');
  });
});
