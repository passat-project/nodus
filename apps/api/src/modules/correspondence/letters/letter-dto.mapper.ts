import { Inject, Injectable } from '@nestjs/common';
import {
  attachmentPreviewKind,
  isPdfDerivativeCandidate,
  type ContactRef,
  type CounterpartyRef,
  type LetterAccess,
  type LetterAttachment,
  type LetterBody,
  type LetterCounterpartySuggestion,
  type LetterDetail,
  type LetterListItem,
  type LetterMailInfo,
  type LetterRef,
  type ProcessTypeRef,
  type ProjectRef,
  type ReceiptMethodRef,
  type UserRef,
} from '@nodus/contracts';

import { SignedUrlService } from '../../../core/crypto/signed-url.service.js';
import {
  FILE_OBJECT_READER,
  type FileObjectReader,
} from '../../../core/ports/file-object-reader.port.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import {
  CUSTOM_FIELD_REGISTRY,
  type CustomFieldRegistry,
} from '../../custom-fields/ports/custom-field-registry.port.js';
import {
  DICTIONARY_READER,
  type DictionaryReader,
} from '../../dictionaries/ports/dictionary-reader.port.js';
import {
  COUNTERPARTY_READER,
  type CounterpartyReader,
} from '../../crm/ports/counterparty-reader.port.js';
import {
  PROJECT_READER,
  type ProjectActor,
  type ProjectReader,
} from '../../projects/ports/project-reader.port.js';
import {
  PROCESS_CATALOG_READER,
  type CatalogStage,
  type ProcessCatalogReader,
} from '../../workflows/ports/process-catalog-reader.port.js';
import { canRegisterLetters } from '../access/letter-access.js';
import type {
  LetterAttachedRefRow,
  LetterAttachmentRow,
  LetterDetailRow,
  LetterListRow,
} from './letter-row.js';

/** Ссылки страницы: гидратация пачками — один запрос на вид ссылки (Р6). */
export interface LetterRefs {
  stages: Map<string, CatalogStage>;
  types: Map<string, ProcessTypeRef>;
  counterparties: Map<string, CounterpartyRef>;
  contacts: Map<string, ContactRef>;
  users: Map<string, UserRef>;
  receipts: Map<string, ReceiptMethodRef>;
  projects: Map<string, ProjectRef>;
}

const EMPTY_REFS = (): LetterRefs => ({
  stages: new Map(),
  types: new Map(),
  counterparties: new Map(),
  contacts: new Map(),
  users: new Map(),
  receipts: new Map(),
  projects: new Map(),
});

const dateOnly = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

/**
 * Сборка DTO писем (#55): ссылки — пачками через порты (типы и стадии —
 * «Процессы», корреспондент и подписант — CRM, сотрудники — directory,
 * способ поступления — справочник); подписанные ссылки файлов — только
 * после проверки видимости (её делает сервис до вызова маппера).
 */
@Injectable()
export class LetterDtoMapper {
  constructor(
    @Inject(PROCESS_CATALOG_READER) private readonly catalog: ProcessCatalogReader,
    @Inject(COUNTERPARTY_READER) private readonly counterparties: CounterpartyReader,
    @Inject(USER_PROFILE_READER) private readonly profiles: UserProfileReader,
    @Inject(DICTIONARY_READER) private readonly dictionaries: DictionaryReader,
    @Inject(FILE_OBJECT_READER) private readonly files: FileObjectReader,
    @Inject(CUSTOM_FIELD_REGISTRY) private readonly customFields: CustomFieldRegistry,
    @Inject(PROJECT_READER) private readonly projects: ProjectReader,
    private readonly signedUrls: SignedUrlService,
  ) {}

  /** Ссылки для страницы списка (стадии/типы/корреспонденты/сотрудники/справочник). */
  async refsOf(
    rows: readonly (LetterListRow | LetterDetailRow)[],
    extra: {
      contacts?: readonly string[];
      users?: readonly string[];
      /** Смотрящий: проект строки — только видимый ему (#52 Р13). */
      actor?: ProjectActor;
    } = {},
  ): Promise<LetterRefs> {
    const pick = <T>(values: (T | null)[]): string[] => [
      ...new Set(values.filter((value): value is T & string => Boolean(value))),
    ];
    const stageIds = pick(rows.map((row) => row.stageId));
    const typeIds = pick(rows.map((row) => row.typeId));
    const counterpartyIds = pick(rows.map((row) => row.counterpartyId));
    const receiptIds = pick(rows.map((row) => row.receiptMethodId));
    const projectIds = pick(rows.map((row) => row.projectId));
    const userIds = pick([...rows.map((row) => row.addresseeId), ...(extra.users ?? [])]);
    const [stages, types, counterparties, receipts, users, projects] = await Promise.all([
      this.catalog.stagesByIds(stageIds),
      this.catalog.typeRefs(typeIds),
      this.counterparties.refs(counterpartyIds),
      this.dictionaries.itemRefs(receiptIds),
      this.profiles.findRefs(userIds),
      extra.actor ? this.projects.refsFor(extra.actor, projectIds) : Promise.resolve([]),
    ]);
    const contacts = extra.contacts?.length
      ? await this.counterparties.contactRefs(extra.contacts)
      : [];
    const refs = EMPTY_REFS();
    for (const stage of stages) refs.stages.set(stage.id, stage);
    for (const type of types) refs.types.set(type.id, type);
    for (const item of counterparties) refs.counterparties.set(item.id, item);
    for (const item of receipts) refs.receipts.set(item.id, { id: item.id, name: item.name });
    for (const item of users) refs.users.set(item.id, item);
    for (const item of contacts) refs.contacts.set(item.id, item);
    for (const item of projects) refs.projects.set(item.id, item);
    return refs;
  }

  toListItem(
    row: LetterListRow | LetterDetailRow,
    refs: LetterRefs,
    attachmentCount: number,
    replyTo: LetterRef | null = null,
    viewed: boolean = false,
  ): LetterListItem {
    const stage = refs.stages.get(row.stageId);
    return {
      id: row.id,
      typeId: row.typeId,
      direction: row.direction as LetterListItem['direction'],
      stage: {
        id: row.stageId,
        name: stage?.name ?? 'Статус',
        order: stage?.sortOrder ?? 0,
        systemState: (stage?.systemState ??
          row.systemState) as LetterListItem['stage']['systemState'],
        color: (stage?.color ?? 'neutral') as LetterListItem['stage']['color'],
        outcome: (stage?.outcome ?? null) as LetterListItem['stage']['outcome'],
      },
      regNumber: row.regNumber,
      regDate: dateOnly(row.regDate),
      registeredAt: row.registeredAt?.toISOString() ?? null,
      receivedAt: row.receivedAt.toISOString(),
      source: row.source as LetterListItem['source'],
      mailFromName: row.mailFromName,
      mailFromAddress: row.mailFromAddress,
      subject: row.subject,
      counterparty: row.counterpartyId
        ? (refs.counterparties.get(row.counterpartyId) ?? null)
        : null,
      theirNumber: row.theirNumber,
      theirDate: dateOnly(row.theirDate),
      receiptMethod: row.receiptMethodId ? (refs.receipts.get(row.receiptMethodId) ?? null) : null,
      // Проект письма — только видимый смотрящему; невидимый → null (#52 Р13).
      project: row.projectId ? (refs.projects.get(row.projectId) ?? null) : null,
      addressee: row.addresseeId ? (refs.users.get(row.addresseeId) ?? null) : null,
      responseDeadline: dateOnly(row.responseDeadline),
      replyTo,
      attachmentCount,
      viewed,
      confidential: row.confidential,
    };
  }

  async toListItems(
    rows: readonly LetterListRow[],
    counts: Map<string, number>,
    actor: ProjectActor,
    replyTos: ReadonlyMap<string, LetterRef> = new Map(),
    viewed: ReadonlySet<string> = new Set(),
  ): Promise<LetterListItem[]> {
    const refs = await this.refsOf(rows, { actor });
    return rows.map((row) =>
      this.toListItem(
        row,
        refs,
        counts.get(row.id) ?? 0,
        replyTos.get(row.id) ?? null,
        viewed.has(row.id),
      ),
    );
  }

  /** Деталь: тип, подписант, регистратор, файлы, тело и атрибуты.
   *  Почтовые подсказки (#56) вычисляет сервис чтения (динамика: контакт
   *  могут завести позже — Р6) и передаёт сюда готовыми. */
  async toDetail(
    row: LetterDetailRow,
    attachments: readonly LetterAttachmentRow[],
    access: LetterAccess,
    actor: ProjectActor,
    extra: {
      replyTo: LetterRef | null;
      replySuggestion: LetterRef | null;
      counterpartySuggestion: LetterCounterpartySuggestion | null;
      attachedRefs: readonly LetterAttachedRefRow[];
    },
  ): Promise<LetterDetail> {
    const refs = await this.refsOf([row], {
      contacts: row.signerId ? [row.signerId] : [],
      users: row.registrarId ? [row.registrarId] : [],
      actor,
    });
    const fileRefs = new Map(
      (await this.files.refs(attachments.map((a) => a.fileId))).map((f) => [f.id, f]),
    );
    const files: LetterAttachment[] = attachments.map((a) => {
      const file = fileRefs.get(a.fileId);
      const name = file?.name ?? 'Файл';
      const mime = file?.mime ?? 'application/octet-stream';
      const previewKind = attachmentPreviewKind(name, mime);
      return {
        id: a.id,
        fileId: a.fileId,
        role: a.role as LetterAttachment['role'],
        name,
        mime,
        size: file?.size ?? 0,
        contentId: a.contentId,
        inline: a.inline,
        url: this.signedUrls.fileContentUrl(a.fileId),
        pdfUrl:
          previewKind === 'office' && isPdfDerivativeCandidate(name)
            ? this.signedUrls.fileDerivativeUrl(a.fileId, 'pdf')
            : null,
        previewKind,
      };
    });
    const values = (row.customFields ?? {}) as LetterDetail['customFields'];
    // «Приложенные письма» (#461, Р3): организация — контрагент справочника
    // или текст с листа; ссылки гидрируются пачкой (один запрос).
    const attachedCounterpartyIds = [
      ...new Set(
        extra.attachedRefs
          .map((ref) => ref.counterpartyId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const attachedCounterparties = new Map(
      (await this.counterparties.refs(attachedCounterpartyIds)).map((ref) => [ref.id, ref]),
    );
    return {
      ...this.toListItem(
        row,
        refs,
        // Скрепка в списке — только настоящие вложения: тело письма и главный
        // документ (скан) — части самого письма, а не приложения (вердикт 28.10).
        files.filter((file) => file.role === 'attachment' && !file.inline).length,
        extra.replyTo,
        // Карточку показывают только тому, кто её открыл — он и просмотрел.
        true,
      ),
      type: refs.types.get(row.typeId) ?? {
        id: row.typeId,
        code: 'letter',
        name: 'Письмо',
        category: 'letter',
        icon: 'send',
        color: 'info',
      },
      signer: row.signerId ? (refs.contacts.get(row.signerId) ?? null) : null,
      registrar: row.registrarId ? (refs.users.get(row.registrarId) ?? null) : null,
      mail: mailInfoOf(row),
      replySuggestion: extra.replyTo ? null : extra.replySuggestion,
      counterpartySuggestion: extra.counterpartySuggestion,
      attachments: files,
      body: bodyOf(files),
      customFields: values,
      customFieldRefs: await this.customFields.refs('letter', values, actor),
      attachedRefs: extra.attachedRefs.map((ref) => ({
        id: ref.id,
        number: ref.number,
        counterparty: ref.counterpartyId
          ? (attachedCounterparties.get(ref.counterpartyId) ?? null)
          : null,
        orgText: ref.orgText,
        date: dateOnly(ref.letterDate),
      })),
      canManageRelations: canRegisterLetters(actor),
      access,
    };
  }
}

/** Конверт в DTO (#56): null — бумажное письмо, внесённое вручную. */
function mailInfoOf(row: LetterDetailRow): LetterMailInfo | null {
  if (!row.mailFromAddress && !row.mailMessageId) return null;
  return {
    fromAddress: row.mailFromAddress ?? '',
    fromName: row.mailFromName,
    messageId: row.mailMessageId,
    parseIssue: row.mailParseIssue,
    storageIncomplete: row.mailStorageIncomplete,
    bodyPdfIssue: row.mailBodyPdfIssue,
  };
}

/** Вкладка «Письмо» (Р8): документ во вьювере, иначе пусто — текст письма
 *  показывается ТОЛЬКО PDF-копией («Основной документ письма» #56, вердикт
 *  владельца 28.10). Главный де-факто — выбор канцелярии (main) или
 *  PDF-копия тела (body_pdf, системный кандидат по умолчанию). */
export function bodyOf(files: readonly LetterAttachment[]): LetterBody {
  const main = files.find((file) => file.role === 'main' || file.role === 'body_pdf');
  if (main) return { kind: 'document', attachmentId: main.id };
  return { kind: 'none' };
}
