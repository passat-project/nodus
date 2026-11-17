import { Injectable } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';
import { errorMessages } from '@nodus/contracts';

import { asRecord, finalize, str } from './projections.js';
import type {
  AssistantToolDefinition,
  ToolContext,
  ToolEntity,
  ToolRequest,
} from './tool-definition.js';

/** Итог вызова инструмента: успех с компактным текстом или понятная ошибка. */
export type ToolExecution =
  | { ok: true; text: string; entity?: ToolEntity }
  | { ok: false; errorCode: string; message: string };

/** Потолок одного вызова: локальный inject быстрый, зависание — авария. */
const TOOL_TIMEOUT_MS = 20_000;

/**
 * Исполнитель инструментов (ADR-0043 п. 2): вызов API портала ОТ ИМЕНИ
 * СОТРУДНИКА через Fastify `inject` с его `Authorization`.
 *
 * Почему inject, а не импорт сервисов модулей: проходят те же guard-ы, права,
 * валидация и фильтры видимости, что и из интерфейса (I2/I3/I8); второй
 * бизнес-логики нет, сервисного токена нет. Ошибка API возвращается модели
 * человеческим текстом — она должна объяснить, а не уронить прогон.
 */
@Injectable()
export class ToolExecutorService {
  constructor(private readonly adapterHost: HttpAdapterHost) {}

  async execute(
    tool: AssistantToolDefinition,
    rawInput: unknown,
    ctx: ToolContext,
  ): Promise<ToolExecution> {
    // Второй слой предохранителя (первый — фильтр каталога): запись в Ф1
    // не исполняется даже при прямом вызове по имени.
    if (tool.kind !== 'read') {
      return {
        ok: false,
        errorCode: 'ASSISTANT_READ_ONLY',
        message: 'В этом режиме доступно только чтение',
      };
    }
    // «Стоп» мог нажаться до старта вызова: не тратим запрос впустую.
    if (ctx.signal.aborted) {
      return { ok: false, errorCode: 'ASSISTANT_TOOL_ABORTED', message: 'Прогон остановлен' };
    }

    const parsed = tool.input.safeParse(rawInput ?? {});
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map((issue) => `${issue.path.join('.') || 'аргументы'}: ${issue.message}`)
        .join('; ');
      return {
        ok: false,
        errorCode: 'VALIDATION_FAILED',
        message: `Аргументы инструмента неверны (${issues})`,
      };
    }
    const input = parsed.data as Record<string, unknown>;

    if (tool.handler) {
      const result = await tool.handler(input, ctx);
      if (ctx.signal.aborted) {
        return { ok: false, errorCode: 'ASSISTANT_TOOL_ABORTED', message: 'Прогон остановлен' };
      }
      return { ok: true, text: finalize(result.text), entity: result.entity };
    }
    if (!tool.api || !tool.build || !tool.project) {
      return { ok: false, errorCode: 'ASSISTANT_TOOL_INVALID', message: 'Инструмент не исполним' };
    }

    const request = tool.build(input);
    const url = toUrl(request);
    const response = await this.inject(url, ctx.authorization, ctx.signal);
    if ('error' in response) return response.error;

    const data = parseBody(response.body);
    if (response.status >= 400) {
      const body = asRecord(data);
      const code = str(body?.code) ?? `HTTP_${response.status}`;
      const human = errorMessages[code as keyof typeof errorMessages];
      const fallback = str(body?.message) ?? 'запрос отклонён';
      return {
        ok: false,
        errorCode: code,
        message:
          response.status === 403
            ? 'Недостаточно прав для этого действия (портал отклонил запрос)'
            : (human ?? `Ошибка API портала: ${fallback}`),
      };
    }
    const result = tool.project(data, input);
    return { ok: true, text: finalize(result.text), entity: result.entity };
  }

  /** Запрос через Fastify inject: полный конвейер Nest + guard-ы. */
  private async inject(
    url: string,
    authorization: string,
    signal: AbortSignal,
  ): Promise<{ status: number; body: string } | { error: ToolExecution }> {
    const fastify = this.adapterHost.httpAdapter?.getInstance<FastifyInstance>();
    if (!fastify) {
      return {
        error: {
          ok: false,
          errorCode: 'ASSISTANT_TOOL_INVALID',
          message: 'HTTP-конвейер недоступен',
        },
      };
    }
    const call = fastify.inject({
      method: 'GET',
      url,
      headers: { authorization, accept: 'application/json' },
      // Отмена прогона рвёт и запрос в API, а не только поток провайдера.
      signal,
    });
    const timeout = new Promise<'timeout'>((resolve) =>
      setTimeout(() => resolve('timeout'), TOOL_TIMEOUT_MS).unref?.(),
    );
    // Отмена — отдельный исход: не «ошибка инструмента», а остановка прогона.
    const aborted = new Promise<'aborted'>((resolve) => {
      if (signal.aborted) resolve('aborted');
      signal.addEventListener('abort', () => resolve('aborted'), { once: true });
    });
    const settled = await Promise.race([call.catch(() => 'aborted' as const), timeout, aborted]);
    if (settled === 'timeout') {
      return {
        error: {
          ok: false,
          errorCode: 'ASSISTANT_TOOL_TIMEOUT',
          message: 'Действие не ответило вовремя',
        },
      };
    }
    if (settled === 'aborted' || signal.aborted) {
      return {
        error: {
          ok: false,
          errorCode: 'ASSISTANT_TOOL_ABORTED',
          message: 'Прогон остановлен',
        },
      };
    }
    return { status: settled.statusCode, body: settled.body };
  }
}

/** Путь + query → URL внутри API (`/api/v1…`): глобальный префикс приложения. */
function toUrl(request: ToolRequest): string {
  const query = request.query
    ? Object.entries(request.query)
        .filter(([, value]) => value !== undefined && value !== '')
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
        .join('&')
    : '';
  return `/api/v1${request.path}${query ? `?${query}` : ''}`;
}

function parseBody(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}
