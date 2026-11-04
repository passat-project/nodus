import { Permission } from '@nodus/contracts';
import { describe, expect, it, vi } from 'vitest';

import { LetterFileAccess } from './letter-file-access.js';

const REGISTERED = [{ registeredAt: new Date('2026-10-01T08:00:00.000Z'), deletedAt: null }];
const UNREGISTERED = [{ registeredAt: null, deletedAt: null }];
const TOMBSTONE = [{ registeredAt: new Date('2026-10-01T08:00:00.000Z'), deletedAt: new Date() }];
const CONFIDENTIAL = [
  {
    registeredAt: new Date('2026-10-01T08:00:00.000Z'),
    deletedAt: null,
    confidential: true,
    registrarId: 'registrar',
    addresseeId: 'addressee',
    participants: ['guest'],
  },
];

type Row = { registeredAt: Date | null; deletedAt: Date | null };

function setup(letters: Row[], permissions: string[]) {
  const repo = { visibilityByFile: vi.fn(async () => letters) };
  const membership = { effectivePermissions: vi.fn(async () => permissions) };
  return { access: new LetterFileAccess(repo as never, membership as never), repo, membership };
}

describe('LetterFileAccess (#55, B5; #461 конфиденциальность и надгробия)', () => {
  it('файл зарегистрированного письма виден всем, правка запрещена', async () => {
    const { access } = setup(REGISTERED, []);
    expect(await access.check('file-1', 'u1')).toEqual({
      canView: true,
      canEdit: false,
      immutable: true,
    });
  });

  it('файл незарегистрированного письма — только держателю регистрации', async () => {
    const employee = setup(UNREGISTERED, []);
    expect(await employee.access.check('file-1', 'u1')).toEqual({
      canView: false,
      canEdit: false,
      deny: true,
    });
    const registrar = setup(UNREGISTERED, [Permission.CORRESPONDENCE_REGISTER]);
    expect(await registrar.access.check('file-1', 'u1')).toEqual({
      canView: true,
      canEdit: false,
      immutable: true,
    });
  });

  it('конфиденциальное: участник видит, чужой получает ВЕТО (не только false)', async () => {
    const outsider = setup(CONFIDENTIAL, []);
    // deny — чтобы владение файлом (ownerId загрузившего) не обходило круг
    // участников в движке просмотра офиса.
    expect(await outsider.access.check('file-1', 'u1')).toEqual({
      canView: false,
      canEdit: false,
      deny: true,
    });
    const participant = setup(CONFIDENTIAL, []);
    expect(await participant.access.check('file-1', 'guest')).toEqual({
      canView: true,
      canEdit: false,
      immutable: true,
    });
    const addressee = setup(CONFIDENTIAL, []);
    expect((await addressee.access.check('file-1', 'addressee'))?.canView).toBe(true);
  });

  it('надгробие: файл удалённого письма закрыт для всех, включая канцелярию', async () => {
    const { access } = setup(TOMBSTONE, [Permission.CORRESPONDENCE_REGISTER]);
    expect(await access.check('file-1', 'u1')).toEqual({
      canView: false,
      canEdit: false,
      deny: true,
    });
  });

  it('файл вне писем — null (вклад контрибьютора отсутствует)', async () => {
    const { access, membership } = setup([], []);
    expect(await access.check('file-1', 'u1')).toBeNull();
    expect(membership.effectivePermissions).not.toHaveBeenCalled();
  });
});
