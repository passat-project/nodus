import { Inject, Injectable } from '@nestjs/common';
import type {
  ConversationListItem,
  ConversationPermissions,
  LetterRef,
  ProjectRef,
  TaskRef,
  UserRef,
} from '@nodus/contracts';

import { SignedUrlService } from '../../../core/crypto/signed-url.service.js';
import {
  USER_PROFILE_READER,
  type UserProfileReader,
} from '../../../core/ports/user-profile.port.js';
import { parsePermissions } from '../permissions.js';
import {
  LETTER_CHAT_READER,
  type LetterChatReader,
} from '../../correspondence/ports/letter-chat-reader.port.js';
import { TASK_CHAT_READER, type TaskChatReader } from '../../tasks/ports/task-chat-reader.port.js';
import {
  PROJECT_CHAT_READER,
  type ProjectChatReader,
} from '../../projects/ports/project-reader.port.js';
import { MessageDtoMapper } from '../messages/message-dto.mapper.js';
import type { ConversationListRow } from './conversations-list.select.js';
import type { MemberRow } from './conversations.repository.js';

export interface ConversationItemContext {
  viewerId: string;
  /** Участники этой беседы (превью, курсоры для readAt lastMessage). */
  members: MemberRow[];
  /** Профили участников (маппер доберёт недостающее сам). */
  refs?: Map<string, UserRef>;
}

/**
 * Сборка ConversationListItem: membersPreview = участники кроме зрителя
 * («Заметки» — сам зритель; UI использует длину как счётчик группы),
 * lastMessage — полным маппером сообщений, права — из матрицы беседы.
 */
@Injectable()
export class ConversationItemMapper {
  constructor(
    private readonly messageMapper: MessageDtoMapper,
    private readonly signedUrls: SignedUrlService,
    @Inject(USER_PROFILE_READER) private readonly userProfiles: UserProfileReader,
    @Inject(TASK_CHAT_READER) private readonly tasks: TaskChatReader,
    @Inject(LETTER_CHAT_READER) private readonly letters: LetterChatReader,
    @Inject(PROJECT_CHAT_READER) private readonly projects: ProjectChatReader,
  ) {}

  async toItem(
    row: ConversationListRow,
    ctx: ConversationItemContext,
  ): Promise<ConversationListItem> {
    const [item] = await this.toItems([row], ctx);
    if (!item) throw new Error('toItem: empty page');
    return item;
  }

  /** Страница списка бесед (#124): lastMessage всех строк — ОДНИМ toDtos
   *  (6 батч-запросов на страницу вместо ~6 на строку; аудит #123: ~300
   *  запросов на GET /chat/conversations). Курсоры прочтения смешанной
   *  страницы — membersByConversation. */
  async toItems(
    rows: ConversationListRow[],
    ctx: ConversationItemContext,
  ): Promise<ConversationListItem[]> {
    const membersByConversation = new Map<string, MemberRow[]>();
    for (const row of rows) {
      membersByConversation.set(
        row.id,
        ctx.members.filter((m) => m.conversationId === row.id),
      );
    }
    const lastDtos = await this.messageMapper.toDtos(
      rows.filter((row) => row.lm_id !== null).map(rowToMessageRow),
      { viewerId: ctx.viewerId, members: ctx.members, membersByConversation },
    );
    const dtoById = new Map(lastDtos.map((dto) => [dto.id, dto]));
    // Ссылка на задачу беседы задачи (#252): номер и название — read-порт задач.
    const taskRefs = new Map<string, TaskRef>(
      (await this.tasks.refs(rows.flatMap((row) => (row.task_id ? [row.task_id] : [])))).map(
        (ref) => [ref.id, ref],
      ),
    );
    // Ссылка на проект канала (#52 Р8): имя — read-порт проектов
    // (членство в беседе уже гарантирует видимость — фильтр не нужен).
    const projectRefs = new Map<string, ProjectRef>(
      (
        await this.projects.refs(rows.flatMap((row) => (row.project_id ? [row.project_id] : [])))
      ).map((ref) => [ref.id, ref]),
    );
    // Ссылка на письмо беседы письма (#55): номер и тема — read-порт
    // корреспонденции (у незарегистрированного номера нет, тема может пустой).
    const letterRefs = new Map<string, LetterRef>(
      (await this.letters.refs(rows.flatMap((row) => (row.letter_id ? [row.letter_id] : [])))).map(
        (ref) => [ref.id, ref],
      ),
    );
    const items: ConversationListItem[] = [];
    for (const row of rows) {
      const members = membersByConversation.get(row.id) ?? [];
      const preview = await this.membersPreview(row, members, ctx.viewerId, ctx.refs);
      const lastMessage = row.lm_id ? (dtoById.get(row.lm_id) ?? null) : null;
      items.push({
        id: row.id,
        type: row.type as ConversationListItem['type'],
        title: row.title,
        // Аватар — файл-дериват (#186): подписная ссылка отдачи files.
        avatarUrl: row.avatar_file_id ? this.signedUrls.fileContentUrl(row.avatar_file_id) : null,
        myRole: row.role as ConversationListItem['myRole'],
        ...(row.readerAccess ? { readOnly: true } : {}),
        permissions: parsePermissions(row.permissions) as ConversationPermissions,
        draft:
          row.draft_text !== null
            ? {
                text: row.draft_text,
                revision: row.draft_revision ?? 0,
                updatedAt: (row.draft_updated_at ?? new Date()).toISOString(),
              }
            : null,
        visibility: (row.visibility as ConversationListItem['visibility']) ?? null,
        description: row.description,
        project: row.project_id ? (projectRefs.get(row.project_id) ?? null) : null,
        task: row.task_id ? (taskRefs.get(row.task_id) ?? null) : null,
        letter: row.letter_id ? (letterRefs.get(row.letter_id) ?? null) : null,
        membersPreview: preview,
        // Всего участников, считая зрителя (#186): кнопка «N участников».
        membersCount: members.length,
        lastMessage,
        // Активность сортировки (#215): звезда в «Избранном» — как новое
        // сообщение; null — активности не было.
        lastActivityAt: row.last_activity_at?.toISOString() ?? null,
        unreadCount: row.unread_count,
        // Watermark текущего пользователя: якорь «первое непрочитанное» при
        // открытии беседы (раунд 3) — seq > myLastReadSeq.
        myLastReadSeq: Number(row.my_last_read_seq),
        pinned: row.pinned,
        muted: row.muted,
        snoozed: row.snoozed,
      });
    }
    return items;
  }

  private async membersPreview(
    row: ConversationListRow,
    members: MemberRow[],
    viewerId: string,
    preloaded?: Map<string, UserRef>,
  ): Promise<UserRef[]> {
    const otherIds = members.filter((m) => m.userId !== viewerId).map((m) => m.userId);
    // «Заметки» (direct с собой): превью — сам зритель (мок: определяющий признак).
    const ids = otherIds.length === 0 && row.type === 'direct' ? [viewerId] : otherIds;
    if (ids.length === 0) return [];
    const refs = new Map(preloaded ?? []);
    const toLoad = ids.filter((id) => !refs.has(id));
    if (toLoad.length > 0) {
      for (const ref of await this.userProfiles.findRefs(toLoad)) refs.set(ref.id, ref);
    }
    return ids.flatMap((id) => {
      const ref = refs.get(id);
      return ref ? [ref] : [];
    });
  }
}

/** lastMessage из «плоской» строки списка (lm_* колонки) → MessageRow. */
function rowToMessageRow(row: ConversationListRow): Parameters<MessageDtoMapper['toDto']>[0] {
  return {
    id: row.lm_id!,
    conversationId: row.id,
    seq: row.lm_seq!,
    authorId: row.lm_author_id!,
    clientMessageId: row.lm_client_message_id!,
    text: row.lm_text ?? '',
    kind: 'text',
    payload: null,
    urgent: row.lm_urgent ?? false,
    mentionedUserIds: null,
    everMentionedUserIds: null,
    replyToId: row.lm_reply_to_id,
    replySnapshot: row.lm_reply_snapshot ?? null,
    threadRootId: row.lm_thread_root_id,
    fwdConversationId: row.lm_fwd_conversation_id,
    fwdMessageId: row.lm_fwd_message_id,
    fwdAuthorId: row.lm_fwd_author_id,
    fwdThreadRootId: row.lm_fwd_thread_root_id,
    editedAt: row.lm_edited_at,
    deletedAt: row.lm_deleted_at,
    obliterated: false,
    createdAt: row.lm_created_at!,
    updatedAt: row.lm_created_at!,
  };
}
