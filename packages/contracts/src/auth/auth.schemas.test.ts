import { describe, expect, it } from 'vitest';

import { createInvitationSchema, createUserSchema } from '../directory/user.schemas.js';
import { emailInputSchema, loginSchema } from './auth.schemas.js';

describe('emailInputSchema (#321): адрес один независимо от набора', () => {
  it('обрезает пробелы и приводит к нижнему регистру до проверки формата', () => {
    expect(emailInputSchema.parse('  Ivanov@Nodus.BY ')).toBe('ivanov@nodus.by');
  });

  it('невалидный адрес отвергается и после нормализации', () => {
    for (const raw of ['', '   ', 'ivanov', 'ivanov@', '@nodus.by', 'a b@nodus.by']) {
      expect(emailInputSchema.safeParse(raw).success, raw).toBe(false);
    }
  });

  it('входные схемы логина, создания сотрудника и приглашения нормализуют email', () => {
    expect(loginSchema.parse({ email: 'A.Voronich@PassatProekt.by', password: 'x' }).email).toBe(
      'a.voronich@passatproekt.by',
    );
    const created = createUserSchema.parse({
      email: ' New.Hire@Nodus.by',
      password: 'Start!23456789',
      lastName: 'Новиков',
      firstName: 'Иван',
    });
    expect(created.email).toBe('new.hire@nodus.by');
    expect(
      createInvitationSchema.parse({
        email: 'Guest@Nodus.BY',
        lastName: 'Гость',
        firstName: 'Новый',
        positionId: '00000000-0000-4000-8000-000000000001',
        departmentId: '00000000-0000-4000-8000-000000000002',
      }).email,
    ).toBe('guest@nodus.by');
  });
});
