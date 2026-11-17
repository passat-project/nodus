import { describe, expect, it, vi } from 'vitest';
import { ASSISTANT_LIMITS } from '@nodus/contracts';

import { AssistantMemoryService } from './assistant-memory.service.js';
import type { AssistantRepository, MemoryRow } from './assistant.repository.js';
import type { AuditRepository } from '../../core/audit/audit.repository.js';

/**
 * Блокнот агента (#900): личная память, дедупликация, лимит с архивом
 * старейшей записи, 404 на чужую, бюджет промпта и аудит.
 */

const USER_ID = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-11-27T10:00:00.000Z');

function memoryRow(overrides: Partial<MemoryRow> = {}): MemoryRow {
  return {
    id: overrides.id ?? 'm-1',
    userId: USER_ID,
    text: 'Отчёты — по пятницам',
    sourceRunId: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function build(rows: MemoryRow[] = [memoryRow()]) {
  const repo = {
    listMemories: vi.fn(async () => rows),
    countMemories: vi.fn(async () => rows.length),
    createMemory: vi.fn(async (input: { text: string }) =>
      memoryRow({ id: 'm-new', text: input.text }),
    ),
    archiveMemory: vi.fn(async (_userId: string, id: string) => rows.some((row) => row.id === id)),
  };
  const audit = { append: vi.fn(async () => undefined) };
  const service = new AssistantMemoryService(
    repo as unknown as AssistantRepository,
    audit as unknown as AuditRepository,
  );
  return { service, repo, audit };
}

describe('AssistantMemoryService (#900)', () => {
  it('запись нормализуется и аудируется как сделанная ИИ', async () => {
    const empty = build([]);
    const result = await empty.service.remember(USER_ID, 'run-1', '  Отчёты —   по пятницам ');
    expect(result.memory.text).toBe('Отчёты — по пятницам');
    expect(result.duplicate).toBe(false);
    expect(empty.audit.append).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: USER_ID,
        action: 'assistant.memory_save',
        details: { viaAi: true, runId: 'run-1' },
      }),
    );
  });

  it('дубль (без учёта регистра) не создаёт вторую запись', async () => {
    const { service, repo } = build([memoryRow({ text: 'Отчёты — по пятницам' })]);
    const result = await service.remember(USER_ID, 'run-2', 'отчёты — по пятницам');
    expect(result.duplicate).toBe(true);
    expect(repo.createMemory).not.toHaveBeenCalled();
  });

  it('лимит 50: старейшая запись уходит в архив, новая создаётся', async () => {
    const rows = Array.from({ length: ASSISTANT_LIMITS.maxMemories }, (_, index) =>
      memoryRow({ id: `m-${index}`, text: `Факт ${index}` }),
    );
    const { service, repo } = build(rows);
    await service.remember(USER_ID, 'run-3', 'Новый факт');
    expect(repo.archiveMemory).toHaveBeenCalledWith(USER_ID, 'm-49');
    expect(repo.createMemory).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Новый факт', sourceRunId: 'run-3' }),
    );
  });

  it('слишком длинная запись и пустая — понятный отказ', async () => {
    const { service } = build([]);
    await expect(service.remember(USER_ID, 'run', '  ')).rejects.toMatchObject({
      code: expect.stringContaining('VALIDATION_FAILED'),
    });
    await expect(
      service.remember(USER_ID, 'run', 'я'.repeat(ASSISTANT_LIMITS.maxMemoryChars + 1)),
    ).rejects.toMatchObject({ code: expect.stringContaining('VALIDATION_FAILED') });
  });

  it('удаление: своя — архив, чужая/неизвестная — 404', async () => {
    const { service } = build([memoryRow()]);
    await service.forget(USER_ID, 'm-1');
    await expect(service.forget(USER_ID, 'foreign')).rejects.toMatchObject({
      code: expect.stringContaining('NOT_FOUND'),
    });
  });

  it('промпт: свежие записи первыми и не больше 2000 знаков', async () => {
    const rows = Array.from({ length: 20 }, (_, index) =>
      memoryRow({ id: `m-${index}`, text: `${index}:${'я'.repeat(250)}` }),
    );
    const { service } = build(rows);
    const lines = await service.promptLines(USER_ID);
    expect(lines.length).toBeGreaterThan(0);
    const total = lines.reduce((sum, line) => sum + line.length + 2, 0);
    expect(total).toBeLessThanOrEqual(ASSISTANT_LIMITS.maxMemoryPromptChars);
    expect(lines[0]).toMatch(/^0:/);
  });

  it('порт инструментов: save отдаёт дубль флагом, forget — boolean', async () => {
    const { service } = build([memoryRow({ text: 'Отчёты — по пятницам' })]);
    const port = service.port(USER_ID, 'run');
    await expect(port.save('Отчёты — по пятницам')).resolves.toMatchObject({ duplicate: true });
    await expect(port.list()).resolves.toHaveLength(1);
    await expect(port.forget('m-1')).resolves.toBe(true);
  });
});
