import { HttpResponse } from 'msw';
import { ErrorCode } from '@nodus/contracts';

/**
 * Общие ответы мок-мутаций проектов (#52, #714): единый формат ошибок
 * сервера, чтобы приёмка на демо-мире видела те же причины отказа.
 */

export const invalid = () =>
  HttpResponse.json(
    { code: ErrorCode.VALIDATION_FAILED, message: 'Invalid body' },
    { status: 400 },
  );

export const forbidden = () =>
  HttpResponse.json({ code: ErrorCode.FORBIDDEN, message: 'Forbidden' }, { status: 403 });

export const notFound = () =>
  HttpResponse.json({ code: ErrorCode.NOT_FOUND, message: 'Project not found' }, { status: 404 });

/** Состав (#714): снятие/понижение держателя ролей в задачах. */
export const memberHasTasks = () =>
  HttpResponse.json(
    {
      code: ErrorCode.PROJECT_MEMBER_HAS_TASKS,
      message: 'Remove the employee from the project tasks first',
    },
    { status: 422 },
  );

/** Состав (#714): участник из задач — наблюдатель не нужен/снять нельзя. */
export const alreadyParticipant = () =>
  HttpResponse.json(
    {
      code: ErrorCode.PROJECT_MEMBER_ALREADY_PARTICIPANT,
      message: 'Membership comes from the project tasks',
    },
    { status: 422 },
  );
