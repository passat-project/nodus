// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConversationListItem } from '@nodus/contracts';

import { stubLoadedImage } from '../../test/stub-loaded-image.js';
import { ConversationAvatar } from './conversation-avatar.js';

/**
 * Аватар БЕСЕДЫ (#726): у личного чата своего фото не бывает — показываем фото
 * собеседника из `membersPreview` (сервер отдаёт там всех, КРОМЕ зрителя).
 * Загруженный аватар беседы (группа/канал) остаётся приоритетным; группа без
 * своего аватара не подменяется лицом участника.
 */

const ME = '00000000-0000-4000-8000-0000000000e1';
const PEER_PHOTO = 'https://files.nodus.local/avatar/peer.png';
const GROUP_PHOTO = 'https://files.nodus.local/avatar/group.png';

const conv = (overrides: Partial<ConversationListItem> = {}): ConversationListItem => ({
  id: '00000000-0000-4000-8000-0000000000c1',
  type: 'direct',
  title: null,
  avatarUrl: null,
  myRole: 'member',
  permissions: {
    changeInfo: 'admin',
    addMembers: 'member',
    removeMembers: 'admin',
    post: 'member',
    manageSettings: 'owner',
  },
  draft: null,
  visibility: null,
  description: null,
  project: null,
  task: null,
  letter: null,
  membersPreview: [{ id: 'peer', displayName: 'Пётр Сидоров', avatarUrl: PEER_PHOTO }],
  membersCount: 2,
  lastMessage: null,
  lastActivityAt: null,
  unreadCount: 0,
  myLastReadSeq: 0,
  pinned: false,
  muted: false,
  snoozed: false,
  ...overrides,
});

const avatarImg = (root: Element) => root.querySelector('[data-slot="avatar"] img');
const fallbackText = (root: Element) =>
  root.querySelector('[data-slot="avatar-fallback"]')?.textContent ?? null;

let restoreImage: (() => void) | null = null;
afterEach(() => {
  restoreImage?.();
  restoreImage = null;
  cleanup();
});

describe('ConversationAvatar — фото собеседника в личном чате (#726)', () => {
  it('личный чат: фото из membersPreview (собеседник, id ≠ meId)', () => {
    restoreImage = stubLoadedImage();
    const { container } = render(<ConversationAvatar conversation={conv()} meId={ME} />);
    expect(avatarImg(container)?.getAttribute('src')).toBe(PEER_PHOTO);
  });

  it('личный чат без фото собеседника: инициалы', () => {
    const { container } = render(
      <ConversationAvatar
        conversation={conv({
          membersPreview: [{ id: 'peer', displayName: 'Пётр Сидоров', avatarUrl: null }],
        })}
        meId={ME}
      />,
    );
    expect(avatarImg(container)).toBeNull();
    expect(fallbackText(container)).toBe('ПС');
  });

  it('личный чат: собеседник определяется по membersPreview, а не по порядку', () => {
    restoreImage = stubLoadedImage();
    const { container } = render(
      <ConversationAvatar
        conversation={conv({
          membersPreview: [
            { id: ME, displayName: 'Я', avatarUrl: 'https://files.nodus.local/avatar/me.png' },
            { id: 'peer', displayName: 'Пётр Сидоров', avatarUrl: PEER_PHOTO },
          ],
        })}
        meId={ME}
      />,
    );
    expect(avatarImg(container)?.getAttribute('src')).toBe(PEER_PHOTO);
  });

  it('группа со своим аватаром: приоритет у фото беседы', () => {
    restoreImage = stubLoadedImage();
    const { container } = render(
      <ConversationAvatar
        conversation={conv({
          type: 'group',
          avatarUrl: GROUP_PHOTO,
          membersPreview: [{ id: 'peer', displayName: 'Пётр Сидоров', avatarUrl: PEER_PHOTO }],
        })}
        meId={ME}
      />,
    );
    expect(avatarImg(container)?.getAttribute('src')).toBe(GROUP_PHOTO);
  });

  it('группа без своего аватара: инициалы, лицо участника не подставляется', () => {
    const { container } = render(
      <ConversationAvatar
        conversation={conv({
          type: 'group',
          title: 'Проектировщики',
          membersPreview: [{ id: 'peer', displayName: 'Пётр Сидоров', avatarUrl: PEER_PHOTO }],
        })}
        meId={ME}
      />,
    );
    expect(avatarImg(container)).toBeNull();
    expect(fallbackText(container)).toBe('П');
  });
});
