import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../core/database/prisma.service.js';
import type {
  SearchScanCursor,
  SearchScanPage,
  SearchSourceDocument,
  SearchSourceProvider,
} from '../../core/ports/search-source.port.js';

const employeeSelect = {
  id: true,
  displayName: true,
  email: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  position: { select: { name: true } },
  department: { select: { name: true } },
  legalPosition: { select: { name: true } },
  legalDepartment: { select: { name: true } },
} as const;

interface EmployeeRow {
  id: string;
  displayName: string;
  email: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  position: { name: string } | null;
  department: { name: string } | null;
  legalPosition: { name: string } | null;
  legalDepartment: { name: string } | null;
}

/**
 * Провайдер источника «сотрудник» (#952, Р5): ФИО — title, должность и
 * подразделение (управленческое и юридическое, если отличаются) + email —
 * body. Активен (status=active) — иначе tombstone: деактивированный исчезает
 * из выдачи, а его сообщения остаются с именем (имя резолвится портом).
 *
 * `loadByDepartment`/`loadByPosition` — переименование справочника меняет
 * текст всех держателей без отдельного события на каждого.
 */
@Injectable()
export class EmployeeSearchSourceProvider implements SearchSourceProvider {
  readonly searchSourceType = 'employee' as const;

  constructor(private readonly prisma: PrismaService) {}

  async load(ids: string[]): Promise<SearchSourceDocument[]> {
    const rows = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: employeeSelect,
    });
    return rows.map(toDocument);
  }

  async scan(after: SearchScanCursor | null, limit: number): Promise<SearchScanPage> {
    const rows = await this.prisma.user.findMany({
      where: after
        ? {
            OR: [
              { updatedAt: { gt: after.sourceUpdatedAt } },
              { updatedAt: after.sourceUpdatedAt, id: { gt: after.id } },
            ],
          }
        : {},
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: employeeSelect,
    });
    const last = rows[rows.length - 1];
    return {
      rows: rows.map(toDocument),
      next: rows.length === limit && last ? { sourceUpdatedAt: last.updatedAt, id: last.id } : null,
    };
  }

  async loadByDepartment(departmentId: string): Promise<SearchSourceDocument[]> {
    const rows = await this.prisma.user.findMany({
      where: { OR: [{ departmentId }, { legalDepartmentId: departmentId }] },
      select: employeeSelect,
    });
    return rows.map(toDocument);
  }

  async loadByPosition(positionId: string): Promise<SearchSourceDocument[]> {
    const rows = await this.prisma.user.findMany({
      where: { OR: [{ positionId }, { legalPositionId: positionId }] },
      select: employeeSelect,
    });
    return rows.map(toDocument);
  }
}

function toDocument(row: EmployeeRow): SearchSourceDocument {
  if (row.status !== 'active') {
    return { type: 'employee', id: row.id, deleted: true, sourceUpdatedAt: row.updatedAt };
  }
  const positionName = row.position?.name ?? null;
  const departmentName = row.department?.name ?? null;
  const legalPosition = row.legalPosition?.name ?? null;
  const legalDepartment = row.legalDepartment?.name ?? null;
  const body = [
    positionName,
    departmentName,
    legalPosition !== positionName ? legalPosition : null,
    legalDepartment !== departmentName ? legalDepartment : null,
    row.email,
  ]
    .filter((part): part is string => Boolean(part))
    .join(' · ');
  return {
    type: 'employee',
    id: row.id,
    title: row.displayName,
    body,
    keywords: '',
    projectId: null,
    conversationId: null,
    counterpartyId: null,
    authorId: null,
    participantIds: [],
    confidential: false,
    registered: true,
    aclKind: 'portal',
    payload: { positionName, departmentName, email: row.email },
    sourceCreatedAt: row.createdAt,
    sourceUpdatedAt: row.updatedAt,
  };
}
