import { describe, expect, it } from 'vitest';

import { ALL_TOOLS } from './catalog.js';
import { keyRu, normalizeQuery } from './retrieval.js';
import { STOP_WORDS } from './retrieval-lexicon.js';
import { TOOL_INTENTS, type AssistantToolDefinition } from './tool-definition.js';

/**
 * Линтер каталога (#926, этап 1): стандарт описания инструмента.
 *
 * Каталог растёт партиями (#927–#932); без механической проверки описания
 * расползаются: пропадает пример, «зачем» дублирует название, два инструмента
 * означают одно и то же. Тест — часть CI: новый инструмент без стандарта или
 * с пересечением смысла не мержится.
 */

const STANDARD_FIELDS = [
  'why',
  'whenToUse',
  'whenNotToUse',
  'subject',
  'returns',
  'nextStep',
] as const;

/** Инструменты, которые пишут не в портал, а в личный блокнот. */
const MEMORY_WRITES = new Set(['memory.save', 'memory.forget']);

function clip(text: string): string {
  return text.length <= 80 ? text : `${text.slice(0, 79)}…`;
}

function tokens(text: string): string[] {
  return normalizeQuery(text)
    .trim()
    .split(' ')
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .map(keyRu);
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 || right.size === 0) return 0;
  const shared = [...left].filter((token) => right.has(token)).length;
  return shared / new Set([...left, ...right]).size;
}

function standardViolations(tool: AssistantToolDefinition): string[] {
  const problems: string[] = [];
  for (const field of STANDARD_FIELDS) {
    const value = tool[field];
    if (typeof value !== 'string' || value.trim().length === 0) {
      problems.push(`${tool.id}: нет поля ${field}`);
    }
  }
  if (!tool.example || !tool.example.note?.trim()) {
    problems.push(`${tool.id}: нет примера входа с пояснением`);
  }
  if (!tool.intent || !TOOL_INTENTS.includes(tool.intent)) {
    problems.push(`${tool.id}: нет корректного intent`);
  }
  return problems;
}

function lengthViolations(tool: AssistantToolDefinition): string[] {
  const problems: string[] = [];
  const bounds: [string, string | undefined, number, number][] = [
    ['title', tool.title, 3, 60],
    ['why', tool.why, 20, 200],
    ['whenToUse', tool.whenToUse, 10, 260],
    ['whenNotToUse', tool.whenNotToUse, 10, 260],
    ['returns', tool.returns, 10, 220],
    ['nextStep', tool.nextStep, 5, 220],
    ['description', tool.description, 20, 600],
    ['subject', tool.subject, 2, 40],
  ];
  for (const [name, value, min, max] of bounds) {
    if (value === undefined) continue;
    if (value.length < min || value.length > max) {
      problems.push(`${tool.id}: ${name} длиной ${value.length} (нужно ${min}–${max})`);
    }
  }
  if ((tool.keywords ?? []).length === 0 || (tool.keywords ?? []).length > 12) {
    problems.push(`${tool.id}: ключевых слов ${tool.keywords?.length ?? 0} (нужно 1–12)`);
  }
  return problems;
}

function effectViolations(tool: AssistantToolDefinition): string[] {
  const problems: string[] = [];
  const expected =
    tool.module === 'ext'
      ? 'external'
      : tool.kind === 'write'
        ? tool.card?.undo
          ? 'write'
          : 'irreversible'
        : MEMORY_WRITES.has(tool.id)
          ? 'write'
          : 'read';
  if (tool.effect !== expected) {
    problems.push(`${tool.id}: effect «${tool.effect}», ожидается «${expected}»`);
  }
  if (tool.kind === 'write' && !tool.card) {
    problems.push(`${tool.id}: запись без карточки подтверждения`);
  }
  return problems;
}

describe('стандарт описания инструмента (#926)', () => {
  it('у каждого инструмента заполнены обязательные поля', () => {
    const problems = ALL_TOOLS.flatMap(standardViolations);
    expect(problems, problems.map((line) => `- ${clip(line)}`).join('\n')).toEqual([]);
  });

  it('длины описаний в границах стандарта', () => {
    const problems = ALL_TOOLS.flatMap(lengthViolations);
    expect(problems, problems.map((line) => `- ${clip(line)}`).join('\n')).toEqual([]);
  });

  it('пример входа валиден по zod-схеме инструмента', () => {
    const problems: string[] = [];
    for (const tool of ALL_TOOLS) {
      if (!tool.example) continue;
      const result = tool.input.safeParse(tool.example.input);
      if (!result.success) {
        problems.push(
          `${tool.id}: пример не проходит схему — ${result.error.issues[0]?.message ?? 'ошибка'}`,
        );
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('побочный эффект соответствует виду и наличию отмены', () => {
    const problems = ALL_TOOLS.flatMap(effectViolations);
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('названия уникальны и не переиспользуют чужой id', () => {
    const titles = ALL_TOOLS.map((tool) => tool.title.trim().toLowerCase());
    const duplicates = titles.filter((title, index) => titles.indexOf(title) !== index);
    expect([...new Set(duplicates)]).toEqual([]);
    expect(new Set(ALL_TOOLS.map((tool) => tool.id)).size).toBe(ALL_TOOLS.length);
  });

  it('нет двух инструментов с одинаковым смыслом без явного разграничения', () => {
    const problems: string[] = [];
    for (let left = 0; left < ALL_TOOLS.length; left += 1) {
      for (let right = left + 1; right < ALL_TOOLS.length; right += 1) {
        const a = ALL_TOOLS[left]!;
        const b = ALL_TOOLS[right]!;
        if (a.module !== b.module || a.intent !== b.intent || a.subject !== b.subject) continue;
        const similarity = jaccard(
          tokens(`${a.title} ${a.why ?? ''}`),
          tokens(`${b.title} ${b.why ?? ''}`),
        );
        if (similarity < 0.6) continue;
        const distinguished =
          (a.whenNotToUse ?? '').includes(b.id) || (b.whenNotToUse ?? '').includes(a.id);
        if (!distinguished) {
          problems.push(
            `${a.id} ↔ ${b.id}: смысл совпадает на ${(similarity * 100).toFixed(0)}%, в «когда нет» нет ссылки друг на друга`,
          );
        }
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });
});
