/**
 * Классификация и Δ счётчиков витрины беседы (#211) — чистые функции и
 * типы, общие для чтения (vault.repository), записи (vault-write.repository)
 * и правки состава (messages-edit-attachments). Выделено из VaultRepository
 * (I5: файл перерос порог).
 */

/** Δ счётчиков одной операции состава (0 — не трогать). */
export interface VaultDelta {
  image: number;
  video: number;
  audio: number;
  document: number;
  link: number;
}

export function emptyVaultDelta(): VaultDelta {
  return { image: 0, video: 0, audio: 0, document: 0, link: 0 };
}

/** Δ состава без ссылок (ссылки считает проекция). */
export type VaultAttachmentDelta = Omit<VaultDelta, 'link'>;

export function emptyAttachmentDelta(): VaultAttachmentDelta {
  return { image: 0, video: 0, audio: 0, document: 0 };
}

/**
 * Витринная категория вложения (ревизия 05.10 — модель Telegram):
 * kind='image' → image, видео — по mime video/* (storage-kind video|file),
 * аудио — по mime audio/*, остальное — document. Это классификация ВИТРИНЫ:
 * storage-kind в БД — image|video|file|sticker; стикеры — не пользовательские
 * файлы, null.
 */
export type VaultKind = 'image' | 'video' | 'audio' | 'document';
export function vaultKindOf(mime: string, kind: string): VaultKind | null {
  if (kind === 'image') return 'image';
  if (kind === 'sticker') return null;
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return kind === 'file' ? 'document' : null;
}

/** Δ счётчиков по составам вложений ДО/ПОСЛЕ (правка #188): стикеры и
 *  посторонние виды не участвуют. */
export function attachmentKindDelta(
  before: readonly { kind: string; mime: string }[],
  after: readonly { kind: string; mime: string }[],
): VaultAttachmentDelta {
  const tally = (rows: readonly { kind: string; mime: string }[]) => {
    const acc = emptyAttachmentDelta();
    for (const a of rows) {
      const kind = vaultKindOf(a.mime, a.kind);
      if (kind) acc[kind] += 1;
    }
    return acc;
  };
  const beforeTally = tally(before);
  const afterTally = tally(after);
  return {
    image: afterTally.image - beforeTally.image,
    video: afterTally.video - beforeTally.video,
    audio: afterTally.audio - beforeTally.audio,
    document: afterTally.document - beforeTally.document,
  };
}

/** Контекст сообщения для вставки строк message_links. */
export interface LinkMessageContext {
  id: string;
  conversationId: string;
  threadRootId: string | null;
  authorId: string;
  createdAt: Date;
}
