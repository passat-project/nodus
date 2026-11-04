import { Permission } from '@nodus/contracts';
import { describe, expect, it } from 'vitest';

import { canViewConfidential, canViewLetter, letterAccessOf } from './letter-access.js';

const REGISTRAR = { id: 'u1', permissions: [Permission.CORRESPONDENCE_REGISTER] };
const EMPLOYEE = { id: 'u2', permissions: [] as string[] };
const CONFIDENTIAL_READER = {
  id: 'u5',
  permissions: [Permission.CORRESPONDENCE_VIEW_CONFIDENTIAL],
};
const REGISTERED = {
  registeredAt: new Date('2026-10-01T08:00:00.000Z'),
  systemState: 'active',
  addresseeId: 'u2',
  registrarId: 'u1',
  confidential: false,
};
const NEW = {
  registeredAt: null,
  systemState: 'backlog',
  addresseeId: null,
  registrarId: null,
  confidential: false,
};
const SECRET = {
  registeredAt: new Date('2026-10-01T08:00:00.000Z'),
  systemState: 'active',
  addresseeId: 'u3',
  registrarId: 'u1',
  confidential: true,
};

describe('видимость письма (#55, Р7)', () => {
  it('зарегистрированное видят все, незарегистрированное — только канцелярия', () => {
    expect(canViewLetter(EMPLOYEE, REGISTERED)).toBe(true);
    expect(canViewLetter(EMPLOYEE, NEW)).toBe(false);
    expect(canViewLetter(REGISTRAR, NEW)).toBe(true);
  });
});

describe('конфиденциальное письмо (#461, Р4, В3)', () => {
  it('видят регистратор, адресат, участники и держатель права — прочим 404', () => {
    expect(canViewLetter(REGISTRAR, SECRET)).toBe(true);
    expect(canViewLetter({ id: 'u3', permissions: [] }, SECRET)).toBe(true);
    expect(canViewLetter({ id: 'u4', permissions: [] }, SECRET, new Set(['u4']))).toBe(true);
    expect(canViewLetter(EMPLOYEE, SECRET)).toBe(false);
    // Администратор без отдельного права — тоже не видит (В3).
    expect(canViewLetter({ id: 'admin', permissions: [Permission.CORE_ADMIN] }, SECRET)).toBe(
      false,
    );
    expect(canViewConfidential(CONFIDENTIAL_READER)).toBe(true);
    expect(canViewLetter(CONFIDENTIAL_READER, SECRET)).toBe(true);
  });

  it('«Присоединиться» к конфиденциальному — регистратор ЭТОГО письма или право', () => {
    // Прочая канцелярия письма не видит — 404; регистратор может.
    expect(letterAccessOf(REGISTRAR, SECRET, false).canJoin).toBe(true);
    expect(
      letterAccessOf({ id: 'u7', permissions: [Permission.CORRESPONDENCE_REGISTER] }, SECRET, false)
        .canJoin,
    ).toBe(false);
    expect(letterAccessOf(CONFIDENTIAL_READER, SECRET, false).canJoin).toBe(true);
    // Участнику присоединяться незачем.
    expect(letterAccessOf({ id: 'u3', permissions: [] }, SECRET, false).canJoin).toBe(false);
  });
});

describe('права карточки письма (#55, Р11/Р12/Р10; редизайн #56)', () => {
  it('канцелярия правит и зарегистрированное, и «Новое»; спам — только из «Нового»', () => {
    expect(letterAccessOf(REGISTRAR, REGISTERED, false)).toMatchObject({
      canEdit: true,
      canDeleteSpam: false,
      canJoin: true,
    });
    expect(letterAccessOf(REGISTRAR, NEW, false)).toMatchObject({
      canEdit: true,
      canDeleteSpam: true,
      // «Начать обсуждение» незарегистрированного — тоже канцелярия.
      canJoin: true,
    });
  });

  it('сотрудник не правит и не начинает обсуждение «Нового»', () => {
    expect(letterAccessOf(EMPLOYEE, REGISTERED, false)).toMatchObject({
      canEdit: false,
      canDeleteSpam: false,
      canJoin: false,
      isParticipant: true,
    });
    expect(letterAccessOf(EMPLOYEE, NEW, false)).toMatchObject({
      canEdit: false,
      canJoin: false,
      isParticipant: false,
    });
    expect(letterAccessOf(REGISTRAR, { ...REGISTERED, addresseeId: 'u9' }, true)).toMatchObject({
      canJoin: false,
      isParticipant: true,
    });
  });

  it('закрытое незарегистрированное не удаляется как спам', () => {
    expect(letterAccessOf(REGISTRAR, { ...NEW, systemState: 'closed' }, false).canDeleteSpam).toBe(
      false,
    );
  });
});
