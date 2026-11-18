import { Injectable } from '@nestjs/common';
import { ASSISTANT_LIMITS } from '@nodus/contracts';
import { PinoLogger } from 'nestjs-pino';

import { AssistantContextRepository } from '../assistant-context.repository.js';
import { AssistantRepository, type MessageRow } from '../assistant.repository.js';
import { AiSettingsService } from '../providers/ai-settings.service.js';
import type { LlmMessage } from '../providers/llm-provider.port.js';
import { asToolData } from '../tools/tool-data.js';
import {
  buildAnswerSummaryPrompt,
  buildDigest,
  fallbackSummaries,
  groupTurns,
  parseAnswerSummaries,
  type DigestTurn,
} from './compaction.js';
import { contextWindowTokens, shouldCompact } from './context-budget.js';

/**
 * Сжатие истории ассистента (#943, решение владельца 18.11.2026):
 * старые ОТВЕТЫ ассистента заменяются сегментами-сводками, вопросы
 * сотрудника сохраняются дословно, полные оригиналы остаются в БД.
 *
 * Запуск — после успешного прогона, когда контекст дошёл до 50% окна;
 * асинхронно (ответ сотруднику не ждёт), ошибка не валит прогон: следующий
 * ход повторит попытку. В промпт попадают последние `contextMaxSegments`
 * сегментов — очень старая история остаётся в ленте, но не раздувает контекст.
 */

/** Таймаут сжатия: один вызов дешёвой модели, не часть основного прогона. */
const SUMMARY_TIMEOUT_MS = 45_000;
/** За один запуск догоняем не более стольких порций (каждая ≤40 сообщений). */
const MAX_SEGMENTS_PER_RUN = 3;

@Injectable()
export class AssistantCompactionService {
  /** Сессии, по которым сжатие уже идёт: второй параллельный запуск не нужен. */
  private readonly running = new Set<string>();

  constructor(
    private readonly repo: AssistantRepository,
    private readonly contextRepo: AssistantContextRepository,
    private readonly settings: AiSettingsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AssistantCompactionService.name);
  }

  /** Порог сжатия: заполнение последнего запроса ≥ 50% окна модели. */
  shouldCompact(contextTokens: number | null | undefined): boolean {
    return shouldCompact(contextTokens, contextWindowTokens());
  }

  /**
   * Запуск после прогона. Не блокирует ответ сотруднику; ошибки только в лог
   * (следующий прогон снова увидит превышение порога и повторит).
   */
  scheduleAfterRun(sessionId: string, contextTokens: number | null): void {
    if (!this.shouldCompact(contextTokens) || this.running.has(sessionId)) return;
    this.running.add(sessionId);
    void this.compactSession(sessionId)
      .then((created) => {
        if (created > 0) {
          this.logger.info(
            { sessionId, segments: created, contextTokens },
            'Assistant history compacted',
          );
        }
      })
      .catch((error: unknown) => {
        this.logger.warn({ err: error, sessionId }, 'Assistant history compaction failed');
      })
      .finally(() => this.running.delete(sessionId));
  }

  /**
   * Префикс промпта: сегменты (блоки данных, не инструкции) + несжатые
   * ранние вопросы до последнего сегмента. Последние сообщения приходят
   * отдельно — они всегда дословны.
   */
  async historyPrefix(sessionId: string, oldestRecent: MessageRow | null): Promise<LlmMessage[]> {
    const segments = await this.contextRepo.listContextSegments(sessionId);
    const blocks: LlmMessage[] = [];
    const shown = segments.slice(-ASSISTANT_LIMITS.contextMaxSegments);
    const hidden = segments.length - shown.length;
    if (hidden > 0) {
      blocks.push({
        role: 'user',
        content: asToolData(
          'assistant_history',
          `Более ранняя история (${hidden} сегм.) не показана, чтобы не раздувать контекст; полный текст — в ленте диалога.`,
        ),
      });
    }
    for (const segment of shown) {
      blocks.push({ role: 'user', content: asToolData('assistant_history', segment.digest) });
    }

    if (!oldestRecent) return blocks;
    const older = await this.repo.messagesBefore(sessionId, oldestRecent);
    if (older.length === 0) return blocks;

    const last = segments.at(-1);
    let uncovered = older;
    if (last) {
      const index = older.findIndex((message) => message.id === last.toMessageId);
      if (index >= 0) uncovered = older.slice(index + 1);
    }
    const questions = uncovered
      .filter((message) => message.role === 'user')
      .map((message) => message.text.trim())
      .filter(Boolean);
    if (questions.length === 0) return blocks;

    // Пока сегмент не сгенерирован (или модель упала), вопросы не теряем:
    // ответы ассистента опускаем, вопросы идут дословно в пределах бюджета.
    let budget = ASSISTANT_LIMITS.contextSegmentMaxChars;
    const lines: string[] = [];
    for (let index = 0; index < questions.length; index += 1) {
      const line = `- ${questions[index]}`;
      if (lines.length > 0 && budget - line.length < 0) {
        lines.push(`- … ещё ${questions.length - index} ранних вопросов не показаны`);
        break;
      }
      lines.push(line);
      budget -= line.length;
    }
    blocks.push({
      role: 'user',
      content: asToolData(
        'assistant_history',
        [
          'Несжатые ранние вопросы сотрудника (дословно; ответы ассистента опущены для экономии контекста):',
          ...lines,
        ].join('\n'),
      ),
    });
    return blocks;
  }

  /**
   * Сжимает старые ходы (за пределами последних `maxHistoryMessages`) в
   * сегменты. Возвращает число созданных сегментов — для тестов и лога.
   */
  async compactSession(sessionId: string): Promise<number> {
    let created = 0;
    for (let pass = 0; pass < MAX_SEGMENTS_PER_RUN; pass += 1) {
      const recent = await this.repo.recentMessages(sessionId, ASSISTANT_LIMITS.maxHistoryMessages);
      // Сжимать нечего: вся история ещё помещается в окно дословно.
      if (recent.length < ASSISTANT_LIMITS.maxHistoryMessages) break;
      const boundary = recent[0];
      if (!boundary) break;
      let older = await this.repo.messagesBefore(sessionId, boundary);
      const segments = await this.contextRepo.listContextSegments(sessionId);
      const last = segments.at(-1) ?? null;
      if (last) {
        const index = older.findIndex((message) => message.id === last.toMessageId);
        if (index >= 0) older = older.slice(index + 1);
      }
      const eligible = older.filter(
        (message) => message.text.trim().length > 0 || message.actions.length > 0,
      );
      if (eligible.length === 0) break;

      const chunk = takeChunk(eligible);
      const first = chunk[0];
      const lastInChunk = chunk[chunk.length - 1];
      if (!first || !lastInChunk) break;
      const turns = groupTurns(chunk);
      if (turns.length === 0) break;

      const summary = await this.summarize(turns);
      const digest = buildDigest(turns, summary.summaries, ASSISTANT_LIMITS.contextSegmentMaxChars);
      try {
        await this.contextRepo.createContextSegment({
          sessionId,
          fromMessageId: first.id,
          toMessageId: lastInChunk.id,
          seq: (last?.seq ?? 0) + 1,
          digest,
          tokensBefore: turns.reduce(
            (sum, turn) => sum + Math.ceil((turn.question.length + turn.answer.length) / 3),
            0,
          ),
          tokensAfter: Math.ceil(digest.length / 3),
          modelId: summary.modelId,
        });
        created += 1;
      } catch (error) {
        // Гонка двух сжатий: второй сегмент с тем же seq уже создан.
        if (isUniqueViolation(error)) break;
        throw error;
      }
      // Порция кончилась — догнали весь хвост; иначе идём следующим кругом.
      if (chunk.length < eligible.length) continue;
      break;
    }
    return created;
  }

  /**
   * Сводки ответов через дешёвую модель-диспетчер (или модель по умолчанию).
   * Любой сбой — fallback-усечение: сегмент всё равно создаётся, данные целы.
   */
  private async summarize(
    turns: readonly DigestTurn[],
  ): Promise<{ summaries: string[]; modelId: string | null }> {
    const fallback = fallbackSummaries(turns);
    const router = await this.settings.resolveRouter().catch(() => null);
    const target = router ?? (await this.settings.resolveForRun().catch(() => null));
    if (!target) return { summaries: fallback, modelId: null };

    const { system, user } = buildAnswerSummaryPrompt(turns);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);
    try {
      let text = '';
      for await (const event of target.provider.streamChat({
        model: target.modelId,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        signal: controller.signal,
        temperature: 0,
        extra: { max_tokens: 1_500 },
      })) {
        if (event.type === 'text.delta') text += event.text;
        if (text.length > 12_000) break;
      }
      const parsed = parseAnswerSummaries(text, turns.length);
      return {
        summaries: parsed.map((summary, index) => summary ?? fallback[index] ?? 'ответа не было'),
        modelId: target.modelId,
      };
    } catch (error) {
      this.logger.warn({ err: error }, 'Answer summarization failed, using truncation');
      return { summaries: fallback, modelId: null };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Порция сжатия: не больше `contextSegmentMessages` и бюджета символов. */
function takeChunk(messages: readonly MessageRow[]): MessageRow[] {
  const chunk: MessageRow[] = [];
  let inputChars = 0;
  // Оценка будущего digest: вопрос идёт дословно, ответ сжимается до ~2 строк.
  // Держим её в бюджете сегмента, чтобы не обрезать хвост сводки.
  let digestChars = 80;
  for (const message of messages) {
    if (chunk.length >= ASSISTANT_LIMITS.contextSegmentMessages) break;
    const inputSize = Math.max(message.text.length, 1) + 8;
    if (chunk.length > 0 && inputChars + inputSize > ASSISTANT_LIMITS.contextSegmentInputChars) {
      break;
    }
    const digestSize = message.role === 'user' ? Math.min(message.text.length, 4_000) + 12 : 320;
    if (chunk.length > 0 && digestChars + digestSize > ASSISTANT_LIMITS.contextSegmentMaxChars) {
      break;
    }
    chunk.push(message);
    inputChars += inputSize;
    digestChars += digestSize;
  }
  return chunk;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
}
