import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../core/database/prisma.service.js';
import type { BirthdayUserRow } from './birthdays.js';

/**
 * Единственная точка доступа витрины к данным (patterns.md): читающие
 * запросы к справочнику сотрудников (users — общая таблица ядра, только
 * SELECT; пишет её directory). Методы — на языке витрины, Prisma наружу не
 * выходит.
 */
@Injectable()
export class HomeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Число активных сотрудников (карточка метрики «Сотрудники»); уволенные не
   *  входят — тот же штат, что считает раздел «Сотрудники» (#723). */
  async countActiveEmployees(): Promise<number> {
    return this.prisma.user.count({ where: { status: 'active' } });
  }

  /** Активные сотрудники с указанной датой рождения — сырьё для выбора годовщин. */
  async findActiveWithBirthDate(): Promise<BirthdayUserRow[]> {
    const rows = await this.prisma.user.findMany({
      where: { status: 'active', birthDate: { not: null } },
      select: { id: true, displayName: true, avatarUrl: true, birthDate: true },
    });
    return rows.filter((u): u is typeof u & { birthDate: Date } => u.birthDate !== null);
  }
}
