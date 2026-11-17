import type { Position } from '@nodus/contracts';

/** Демо-должности оргструктуры (#441/#433): имена совпадают с
 *  `positionName` демо-пользователей, чтобы держатели считались в редакторе
 *  маршрутов. Удаление должности жёсткое (#768) — флага архива нет. */
const id = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;

export const demoPositions: Position[] = [
  { id: id(1), name: 'Директор', kind: 'management', sortOrder: 0 },
  { id: id(2), name: 'БИМ-менеджер', kind: 'management', sortOrder: 1 },
  { id: id(3), name: 'Главный архитектор', kind: 'management', sortOrder: 2 },
  { id: id(4), name: 'Главный специалист BIM', kind: 'management', sortOrder: 3 },
  { id: id(5), name: 'Инженер-проектировщик', kind: 'management', sortOrder: 4 },
  { id: id(6), name: 'Специалист по кадрам', kind: 'management', sortOrder: 5 },
  {
    id: id(7),
    name: 'Зам директора по персоналу',
    kind: 'management',
    sortOrder: 6,
  },
  { id: id(8), name: 'ГИП', kind: 'legal', sortOrder: 0 },
  { id: id(9), name: 'Юрист', kind: 'legal', sortOrder: 1 },
];
