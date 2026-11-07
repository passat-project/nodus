import { Injectable, type PipeTransform } from '@nestjs/common';
import { ErrorCode } from '@nodus/contracts';
import type { z } from 'zod';

import { DomainException } from '../errors/domain-exception.js';

/**
 * Канон валидации (patterns.md): схема из `@nodus/contracts` передаётся явно —
 * `@UsePipes(new ZodValidationPipe(createTaskSchema))`.
 * Любая ошибка валидации → `VALIDATION_FAILED` единого формата с `details.issues`.
 */
@Injectable()
export class ZodValidationPipe<T extends z.ZodType> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    // Рекурсивная схема формулы на патологической вложенности может
    // переполнить стек ДО проверки глубины движком: это ошибка входа (422),
    // а не 500.
    let result: { success: true; data: z.infer<T> } | { success: false; error: z.ZodError };
    try {
      result = this.schema.safeParse(value) as typeof result;
    } catch (error) {
      if (error instanceof RangeError) {
        throw new DomainException(ErrorCode.FORMULA_AST_INVALID, 'Formula is too deep', {
          issues: [{ path: '', code: 'depth', message: 'formula AST is too deep' }],
        });
      }
      throw error;
    }
    if (!result.success) {
      throw new DomainException(ErrorCode.VALIDATION_FAILED, 'Validation failed', {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          code: issue.code,
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
