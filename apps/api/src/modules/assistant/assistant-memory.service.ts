import { Injectable } from '@nestjs/common';
import { ASSISTANT_LIMITS, type AssistantMemory, type AssistantMemoryList } from '@nodus/contracts';

import { DomainException } from '../../core/errors/domain-exception.js';
import { AuditRepository } from '../../core/audit/audit.repository.js';
import { AssistantRepository, type MemoryRow } from './assistant.repository.js';
import { toMemoryDto } from './assistant.serializers.js';

/** Итог записи в блокнот: дубль не создаёт второй строки. */
export interface MemorySaveResult {
  memory: MemoryRow;
  duplicate: boolean;
}

/** Одна строка памяти в промпте не длиннее записи и без переводов строк. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Личная память сотрудника (#900): блокнот агента. Записи делает агент
 * (`memory.save`), сотрудник может удалить — архив, а не стирание. Память
 * видит только владелец; в промпт уходят активные записи до лимита знаков.
 */
@Injectable()
export class AssistantMemoryService {
  constructor(
    private readonly repo: AssistantRepository,
    private readonly audit: AuditRepository,
  ) {}

  async list(userId: string): Promise<AssistantMemoryList> {
    const rows = await this.repo.listMemories(userId, ASSISTANT_LIMITS.maxMemories);
    return { items: rows.map(toMemoryDto), limit: ASSISTANT_LIMITS.maxMemories };
  }

  /** Активные записи для подстановки в промпт (свежие первыми, лимит знаков). */
  async promptLines(userId: string): Promise<string[]> {
    const rows = await this.repo.listMemories(userId, ASSISTANT_LIMITS.maxMemories);
    const lines: string[] = [];
    let budget = ASSISTANT_LIMITS.maxMemoryPromptChars;
    for (const row of rows) {
      const text = normalize(row.text);
      if (!text) continue;
      if (text.length + 2 > budget) break;
      budget -= text.length + 2;
      lines.push(text);
    }
    return lines;
  }

  /** Запись факта агентом: дубль возвращает существующую строку. */
  async remember(userId: string, runId: string, rawText: string): Promise<MemorySaveResult> {
    const text = normalize(rawText);
    if (!text) throw new DomainException('VALIDATION_FAILED', 'Пустая запись памяти');
    if (text.length > ASSISTANT_LIMITS.maxMemoryChars) {
      throw new DomainException(
        'VALIDATION_FAILED',
        `Запись длиннее ${ASSISTANT_LIMITS.maxMemoryChars} знаков`,
      );
    }
    const active = await this.repo.listMemories(userId, ASSISTANT_LIMITS.maxMemories);
    const existing = active.find((row) => normalize(row.text).toLowerCase() === text.toLowerCase());
    if (existing) return { memory: existing, duplicate: true };
    // Лимит: старейшая запись уходит в архив (не удаляется) — блокнот свежий.
    if (active.length >= ASSISTANT_LIMITS.maxMemories) {
      const oldest = active.at(-1);
      if (oldest) await this.repo.archiveMemory(userId, oldest.id);
    }
    const memory = await this.repo.createMemory({ userId, text, sourceRunId: runId });
    // Аудит «через ИИ»: запись сделала модель от имени сотрудника (#900).
    await this.audit
      .append({
        actorId: userId,
        action: 'assistant.memory_save',
        entityType: 'assistant_memory',
        entityId: memory.id,
        details: { viaAi: true, runId },
      })
      .catch(() => undefined);
    return { memory, duplicate: false };
  }

  /** Удаление записи сотрудником (архив): чужая/отсутствующая — 404. */
  async forget(userId: string, id: string): Promise<void> {
    const archived = await this.repo.archiveMemory(userId, id);
    if (!archived) throw DomainException.notFound('Запись не найдена');
    await this.audit
      .append({
        actorId: userId,
        action: 'assistant.memory_forget',
        entityType: 'assistant_memory',
        entityId: id,
        details: { viaAi: false },
      })
      .catch(() => undefined);
  }

  /** Порт для инструментов агента (в памяти прогона, не в БД). */
  port(
    userId: string,
    runId: string,
  ): {
    save: (text: string) => Promise<{ id: string; text: string; duplicate: boolean }>;
    list: () => Promise<AssistantMemory[]>;
    forget: (id: string) => Promise<boolean>;
  } {
    return {
      save: async (text) => {
        const result = await this.remember(userId, runId, text);
        return {
          id: result.memory.id,
          text: result.memory.text,
          duplicate: result.duplicate,
        };
      },
      list: async () => {
        const rows = await this.repo.listMemories(userId, ASSISTANT_LIMITS.maxMemories);
        return rows.map(toMemoryDto);
      },
      forget: (id) => this.repo.archiveMemory(userId, id),
    };
  }
}
