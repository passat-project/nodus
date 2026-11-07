/**
 * > 355 строк — осознанное превышение ориентира I5: единый атомарный сид
 * > (роли → должности → отделы → люди → канал) читается как один сценарий;
 * > разнос по модулям усложнил бы порядок зависимостей.
 *
 * Сидинг (ADR-0002): пилотная группа мессенджера — Группа BIM-технологий
 * ПассатПроект (вердикт владельца 26.09.2026: 5 сотрудников + системный
 * админ, БОЛЬШЕ сотрудников и отделов на пилоте нет).
 * Идемпотентен (upsert по уникальным ключам): dev/CI-БД сеются свободно,
 * прод nodus.by — стабильные данные.
 *
 * Пароли (гигиена 26.09: известных дефолтов в git больше нет):
 * - SEED_ADMIN_PASSWORD / SEED_DEMO_PASSWORD — явная установка (обновит
 *   пароль и у существующих записей — способ ротации стенда);
 * - без env — случайный пароль на каждого НОВОГО пользователя с одноразовой
 *   печатью ниже (существующие записи не перезаписываются).
 */
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';

import { Prisma, PrismaClient } from '../src/generated/prisma/client.js';
import { GRANTED_ADMIN_PERMISSIONS } from './all-permissions.js';
import { seedFormulaWorld } from './seed-formulas.js';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL не задан (запуск — через `prisma db seed`, он подхватывает .env)');
}
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
} as const;

/** Созданные этой прогоном учётки с паролями — печать в конце сида
 * (только реально созданные записи — пуш в user()). */
const createdCredentials: { email: string; password: string }[] = [];

function newPassword(envValue: string | undefined): string {
  return envValue ?? `N-${randomBytes(9).toString('base64url')}`;
}

async function main(): Promise<void> {
  // --- Роли (системные) ---
  const adminRole = await prisma.role.upsert({
    where: { code: 'admin' },
    update: {},
    create: {
      code: 'admin',
      name: 'Администратор',
      description: 'Полный доступ к порталу',
      isSystem: true,
      permissions: {
        create: GRANTED_ADMIN_PERMISSIONS.map((permission) => ({ permission })),
      },
    },
  });
  // Досев прав на существующей БД: upsert роли создаёт permissions только при
  // создании — новые права (sticker.manage, #143) добавляются строками PK-идемпотентно.
  // Состав — каталог минус исключения (#52: секретные проекты админ не видит).
  for (const permission of GRANTED_ADMIN_PERMISSIONS) {
    await prisma.rolePermission.upsert({
      where: { roleId_permission: { roleId: adminRole.id, permission } },
      update: {},
      create: { roleId: adminRole.id, permission },
    });
  }
  // Системный надзор (#52, вердикт 29.10): роль и право — миграцией
  // 20261105000000_projects_core; сид назначает в неё учётку Системного
  // Администратора (ниже, после создания пользователя).
  const supervisionRole = await prisma.role.upsert({
    where: { code: 'system-supervision' },
    update: {},
    create: {
      code: 'system-supervision',
      name: 'Системный надзор',
      description: 'Видит секретные проекты вне участия (служебная учётка)',
      isSystem: true,
      permissions: { create: [{ permission: 'project.view_secret' }] },
    },
  });
  const headRole = await prisma.role.upsert({
    where: { code: 'head' },
    update: {},
    create: {
      code: 'head',
      name: 'Руководитель',
      description: 'Руководитель подразделения: постановка и назначение задач',
      isSystem: true,
      permissions: {
        create: ['directory.read', 'task.create', 'task.assign'].map((permission) => ({
          permission,
        })),
      },
    },
  });
  const employeeRole = await prisma.role.upsert({
    where: { code: 'employee' },
    update: {},
    create: {
      code: 'employee',
      name: 'Сотрудник',
      description: 'Базовая роль: чтение справочника, работа с задачами',
      isSystem: true,
      permissions: {
        create: ['directory.read', 'task.create'].map((permission) => ({ permission })),
      },
    },
  });
  // Модератор портала (#245): удаление любых сообщений в группах/каналах.
  const moderatorRole = await prisma.role.upsert({
    where: { code: 'moderator' },
    update: {},
    create: {
      code: 'moderator',
      name: 'Модератор портала',
      description: 'Модерация мессенджера: удаление любых сообщений в группах и каналах',
      isSystem: true,
      permissions: {
        create: ['directory.read', 'chat.moderate'].map((permission) => ({ permission })),
      },
    },
  });
  // Досев права на существующей БД (как у admin выше) — PK-идемпотентно.
  await prisma.rolePermission.upsert({
    where: { roleId_permission: { roleId: moderatorRole.id, permission: 'chat.moderate' } },
    update: {},
    create: { roleId: moderatorRole.id, permission: 'chat.moderate' },
  });
  // Канцелярия (#55, Р13): регистрация писем и ведение контрагентов.
  // На проде роль и права доезжают миграцией 20261101120000_correspondence_core.
  const officeRole = await prisma.role.upsert({
    where: { code: 'office' },
    update: {},
    create: {
      code: 'office',
      name: 'Канцелярия',
      description: 'Регистрация входящих писем, ведение контрагентов',
      isSystem: true,
      permissions: {
        create: ['correspondence.register', 'crm.create', 'crm.manage'].map((permission) => ({
          permission,
        })),
      },
    },
  });
  for (const permission of ['correspondence.register', 'crm.create', 'crm.manage']) {
    await prisma.rolePermission.upsert({
      where: { roleId_permission: { roleId: officeRole.id, permission } },
      update: {},
      create: { roleId: officeRole.id, permission },
    });
  }

  // --- Должности (management; юр-структуры на пилоте нет) ---
  async function position(name: string, sortOrder = 0) {
    return prisma.position.upsert({
      where: { name_kind: { name, kind: 'management' } },
      update: {},
      create: { name, kind: 'management', sortOrder },
    });
  }

  const posHeadBim = await position('Руководитель группы BIM');
  const posBimManager = await position('BIM-менеджер', 10);
  const posBimMaster = await position('BIM-мастер', 20);

  // --- Подразделения: компания → единственная пилотная группа ---
  async function department(name: string, parentId: string | null, sortOrder = 0) {
    const existing = await prisma.department.findFirst({
      where: { name, kind: 'management', parentId },
    });
    if (existing) return existing;
    return prisma.department.create({ data: { name, kind: 'management', parentId, sortOrder } });
  }

  const company = await department('ПассатПроект', null);
  const bimGroup = await department('Группа BIM-технологий', company.id, 10);

  // --- Пользователи ---
  const demoPasswordEnv = process.env.SEED_DEMO_PASSWORD; // стенды: единый пароль
  const adminPassword = newPassword(process.env.SEED_ADMIN_PASSWORD);
  const adminHash = await argon2.hash(adminPassword, ARGON2_OPTIONS);

  const pilotHashes = new Map<string, string>();
  const pilotPasswords = new Map<string, string>();
  const pilots: {
    email: string;
    lastName: string;
    firstName: string;
    middleName?: string;
    positionId: string;
    roleId: string;
  }[] = [
    {
      email: 'a.klimovich@passatproekt.by',
      lastName: 'Климович',
      firstName: 'Александр',
      middleName: 'Геннадьевич',
      positionId: posHeadBim.id,
      roleId: headRole.id,
    },
    {
      email: 'a.matorin@passatproekt.by',
      lastName: 'Маторин',
      firstName: 'Артём',
      middleName: 'Николаевич',
      positionId: posBimManager.id,
      roleId: employeeRole.id,
    },
    {
      email: 'e.polomar@passatproekt.by',
      lastName: 'Поломар',
      firstName: 'Екатерина',
      middleName: 'Александровна',
      positionId: posBimMaster.id,
      roleId: employeeRole.id,
    },
    {
      email: 'd.klemantovich@passatproekt.by',
      lastName: 'Клемантович',
      firstName: 'Денис',
      middleName: 'Теофанович',
      positionId: posBimMaster.id,
      roleId: employeeRole.id,
    },
    {
      email: 'a.voronich@passatproekt.by',
      lastName: 'Воронич',
      firstName: 'Алина',
      middleName: 'Николаевна',
      positionId: posBimMaster.id,
      roleId: employeeRole.id,
    },
  ];
  for (const pilot of pilots) {
    const pass = newPassword(demoPasswordEnv);
    pilotPasswords.set(pilot.email, pass);
    pilotHashes.set(pilot.email, await argon2.hash(pass, ARGON2_OPTIONS));
  }

  /**
   * Upsert пользователя: пароль применяется к существующему ТОЛЬКО при явном
   * env (ротация стенда); без env — только при создании.
   */
  async function user(data: {
    email: string;
    passwordHash: string;
    updatePassword: boolean;
    /** Пароль, показанный один раз — только если запись реально создаётся. */
    generatedPassword?: string;
    lastName: string;
    firstName: string;
    middleName?: string;
    departmentId?: string;
    positionId?: string;
    managerId?: string;
    roleId: string;
  }) {
    // #132: displayName без отчества («Фамилия Имя») — отчество живёт только
    // в middleName (карточка сотрудника); существующие строки чистит миграция.
    const displayName = [data.lastName, data.firstName].filter(Boolean).join(' ');
    const existing = await prisma.user.findUnique({
      where: { email: data.email },
      select: { id: true },
    });
    const record = await prisma.user.upsert({
      where: { email: data.email },
      update: data.updatePassword ? { passwordHash: data.passwordHash } : {},
      create: {
        email: data.email,
        passwordHash: data.passwordHash,
        lastName: data.lastName,
        firstName: data.firstName,
        middleName: data.middleName ?? null,
        displayName,
        departmentId: data.departmentId ?? null,
        positionId: data.positionId ?? null,
        managerId: data.managerId ?? null,
      },
    });
    if (!existing && data.generatedPassword) {
      createdCredentials.push({ email: data.email, password: data.generatedPassword });
    }
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: record.id, roleId: data.roleId } },
      update: {},
      create: { userId: record.id, roleId: data.roleId },
    });
    return record;
  }

  // Системный админ (владелец): без отдела, полные права.
  const admin = await user({
    email: 'admin@nodus.by',
    passwordHash: adminHash,
    updatePassword: Boolean(process.env.SEED_ADMIN_PASSWORD),
    generatedPassword: process.env.SEED_ADMIN_PASSWORD ? undefined : adminPassword,
    lastName: 'Администратор',
    firstName: 'Системный',
    roleId: adminRole.id,
  });
  // Системный надзор (#52): учётка Системного Администратора видит секретные
  // проекты (модель Битрикс-суперадмина; на проде — назначение матрицей).
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: supervisionRole.id } },
    update: {},
    create: { userId: admin.id, roleId: supervisionRole.id },
  });

  // Пилотная группа: все в Группе BIM-технологий, у группы — руководитель.
  const pilotRecords = [];
  for (const pilot of pilots) {
    pilotRecords.push(
      await user({
        ...pilot,
        passwordHash: pilotHashes.get(pilot.email)!,
        updatePassword: Boolean(demoPasswordEnv),
        generatedPassword: demoPasswordEnv ? undefined : pilotPasswords.get(pilot.email)!,
        departmentId: bimGroup.id,
      }),
    );
  }
  const head = pilotRecords[0]!;
  await prisma.department.update({ where: { id: bimGroup.id }, data: { headId: head.id } });
  for (const member of pilotRecords.slice(1)) {
    await prisma.user.update({ where: { id: member.id }, data: { managerId: head.id } });
  }

  await prisma.featureFlag.upsert({
    where: { key: 'chat' },
    update: {},
    create: { key: 'chat', enabled: true },
  });
  // Модуль задач (#37): маршруты и тип сеет бутстрап api (системный каталог
  // ADR-0020), здесь — только флаг. Веб ходит в моки, пока домен tasks в
  // VITE_API_MOCK (#311 переключает).
  await prisma.featureFlag.upsert({
    where: { key: 'tasks' },
    update: {},
    create: { key: 'tasks', enabled: true },
  });
  // CRM (#460, ADR-0033): справочник контрагентов. На проде флаг и права
  // доезжают миграцией (#311/#398), здесь — свежая установка.
  await prisma.featureFlag.upsert({
    where: { key: 'crm' },
    update: {},
    create: { key: 'crm', enabled: true },
  });
  // Корреспонденция (#55, ADR-0027): письма на движке «Процессы».
  await prisma.featureFlag.upsert({
    where: { key: 'correspondence' },
    update: {},
    create: { key: 'correspondence', enabled: true },
  });
  // Проекты (#52, ADR-0030): флаг и сид-типы («Договор», «Тема») на проде —
  // миграцией 20261105000000_projects_core, здесь — свежая установка.
  await prisma.featureFlag.upsert({
    where: { key: 'projects' },
    update: {},
    create: { key: 'projects', enabled: true },
  });

  // Канал новостей компании (Ф4; вердикт 24.09: «Новости» — КАНАЛ, публикация
  // post=admin, обсуждение в тредах всем). Участники — админ + пилотная группа.
  const NEWS_CHANNEL_ID = '00000000-0000-4000-8000-000000000c01';
  await prisma.conversation.upsert({
    where: { id: NEWS_CHANNEL_ID },
    update: { type: 'project_channel' },
    create: {
      id: NEWS_CHANNEL_ID,
      type: 'project_channel',
      title: 'Новости компании',
      description: 'Официальные новости и объявления; обсуждение — в тредах постов.',
      visibility: 'open',
      permissions: {
        changeInfo: 'admin',
        addMembers: 'member',
        removeMembers: 'admin',
        post: 'admin',
        manageSettings: 'owner',
      },
      createdBy: admin.id,
      members: {
        create: [
          { userId: admin.id, role: 'owner' },
          ...pilotRecords.map((u) => ({ userId: u.id, role: 'member' as const })),
        ],
      },
    },
  });
  // Существующим (пилот мог завестись раньше канала) досеиваем участие.
  for (const member of pilotRecords) {
    await prisma.conversationMember.upsert({
      where: { conversationId_userId: { conversationId: NEWS_CHANNEL_ID, userId: member.id } },
      update: {},
      create: { conversationId: NEWS_CHANNEL_ID, userId: member.id, role: 'member' },
    });
  }

  // Приветствие пилота (детерминированные id — идемпотентный upsert).
  const newsPosts: { id: string; seq: number; authorId: string; text: string }[] = [
    {
      id: '00000000-0000-4000-8000-000000000c11',
      seq: 1,
      authorId: admin.id,
      text: 'Коллеги, добрый день! Это пилот корпоративного мессенджера Нодус. Пишите друг другу, пробуйте треды, реакции и закрепы — замечания и пожелания оставляйте прямо здесь в тредах под этим постом.',
    },
    {
      id: '00000000-0000-4000-8000-000000000c12',
      seq: 2,
      authorId: admin.id,
      text: 'Регламент: одно сообщение — до 4000 символов, вложения до 100 МБ. Если отправка не удалась, сообщение повторится автоматически и не задвоится.',
    },
    {
      id: '00000000-0000-4000-8000-000000000c13',
      seq: 3,
      authorId: head.id,
      text: 'От BIM-группы: все на связи. Вопросы по пилоту собираем в тредах, живые обсуждения — в наших чатах.',
    },
  ];
  for (const post of newsPosts) {
    await prisma.message.upsert({
      where: { id: post.id },
      update: {},
      create: {
        id: post.id,
        conversationId: NEWS_CHANNEL_ID,
        seq: BigInt(post.seq),
        authorId: post.authorId,
        clientMessageId: `seed:news:${post.seq}`,
        text: post.text,
      },
    });
  }
  // Курсор порядка только вперёд: ре-сид на живом пилоте не должен откатить
  // last_seq ниже уже отправленных (unique(conversation_id, seq)).
  await prisma.conversation.updateMany({
    where: { id: NEWS_CHANNEL_ID, lastSeq: { lt: 3n } },
    data: { lastSeq: 3n, lastMessageAt: new Date() },
  });

  // ===== Атрибуты портала (#631): демо-мир песочницы =====
  // Цвета вариантов «Марки» (Р6): палитра темы по порядку справочника —
  // только строкам без цвета (администраторские правки не трогаем).
  const markDictionary = await prisma.dictionary.findUnique({
    where: { code: 'set-mark' },
    select: { id: true },
  });
  if (markDictionary) {
    const PALETTE = [
      'info',
      'warning',
      'success',
      'pink',
      'neutral',
      'danger',
      'violet',
      'teal',
      'orange',
      'cyan',
    ] as const;
    const items = await prisma.dictionaryItem.findMany({
      where: { dictionaryId: markDictionary.id, color: null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true },
      take: PALETTE.length,
    });
    for (const [index, item] of items.entries()) {
      await prisma.dictionaryItem.update({
        where: { id: item.id },
        data: { color: PALETTE[index] },
      });
    }
  }

  // Глобальная переменная (Р7): «Срок мобилизации, дней» со значением 14 —
  // сеем только под свободным именем (администратор мог занять своим).
  const globalTaken = await prisma.fieldDefinition.findFirst({
    where: { name: { equals: 'Срок мобилизации, дней', mode: 'insensitive' } },
    select: { id: true },
  });
  if (!globalTaken) {
    const [{ n }] = await prisma.$queryRaw<{ n: bigint }[]>(
      Prisma.sql`SELECT nextval('field_definitions_number_seq') AS n`,
    );
    await prisma.fieldDefinition.create({
      data: {
        number: Number(n),
        type: 'number',
        name: 'Срок мобилизации, дней',
        settings: {},
        isCompany: true,
        sortOrder: 100,
        companyValue: { create: { value: 14 } },
      },
    });
  }

  // Привязка посевной «Марки» к типу задачи (#631 Р9/§9.1): демо-мир должен
  // сразу показывать один атрибут в двух местах — вид папки и тип задачи.
  const marka = await prisma.fieldDefinition.findUnique({
    where: { id: '35560000-0000-4000-8000-000000000001' },
    select: { id: true },
  });
  const taskType = await prisma.processType.findFirst({
    where: { category: 'task', archivedAt: null },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
  });
  if (marka && taskType) {
    await prisma.fieldBinding.upsert({
      where: {
        definitionId_targetKind_targetId: {
          definitionId: marka.id,
          targetKind: 'process_type',
          targetId: taskType.id,
        },
      },
      update: {},
      create: {
        definitionId: marka.id,
        targetKind: 'process_type',
        targetId: taskType.id,
      },
    });
  }

  // Демо-проект со шифром (Р9): «Шифр» и «Заказчик» — атрибуты, значение
  // живёт в customFields; колонки code/client_id заморожены. Только при
  // пустом журнале проектов (ре-сид живого стенда ничего не добавляет).
  const projectCount = await prisma.project.count();
  const adminUser = await prisma.user.findFirst({
    where: { email: 'admin@nodus.by' },
    select: { id: true },
  });
  const contractType = await prisma.projectType.findUnique({
    where: { id: '11111111-1111-4111-8111-111111111111' },
    select: { id: true },
  });
  if (projectCount === 0 && adminUser && contractType) {
    await prisma.project.create({
      data: {
        name: 'Демо-договор «Пассат»',
        typeId: contractType.id,
        managerId: adminUser.id,
        creatorId: adminUser.id,
        visibility: 'open',
        customFields: {
          '4b91bbe0-2d81-5ba2-8c51-93beb41da2cf': 'ПР-2026-01',
        } as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // ===== Демо-мир формул (#632, пакет 2c) — ТОЛЬКО песочница =====
  // Тип «Комплект» с формулой шифра, здания с «№ по ГП», окно «Изм.»,
  // конфиденциальный комплект и секретный проект: критерии 1–5 владельца.
  // Гейт внутри: nodus_night или явный SEED_FORMULA_DEMO=1 (на проде — нет).
  await seedFormulaWorld(prisma, connectionString);

  const users = await prisma.user.count();
  const departments = await prisma.department.count();
  console.log(`Seed OK: ${users} пользователей, ${departments} подразделений`);
  console.log('Чат: флаг chat включён; канал «Новости компании» с приветствием пилоту');
  console.log('Задачи: флаг tasks включён (каталог маршрутов создаёт api при старте)');
  if (createdCredentials.length > 0) {
    console.log(
      '--- Созданные учётки (пароли показать один раз, передать лично; смена при первом входе) ---',
    );
    for (const c of createdCredentials) console.log(`${c.email} -> ${c.password}`);
  } else if (process.env.SEED_ADMIN_PASSWORD || demoPasswordEnv) {
    console.log('Пароли: применены из SEED_*_PASSWORD (в т.ч. у существующих)');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
