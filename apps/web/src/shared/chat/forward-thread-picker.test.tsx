// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ConversationListItem } from '@nodus/contracts';

vi.mock('@nodus/ui/components/dialog', () => ({
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('./chat-queries.js', () => ({
  useConversationMessages: () => ({
    data: {
      items: [
        {
          id: '0b6a4c1e-2b9f-4a55-9c1e-1f0f9b7a2d11',
          threadRootId: null,
          deletedAt: null,
          text: 'Очень длинный текст обсуждения, который не помещается в две строки превью',
          author: { displayName: 'Иванов Иван Иванович' },
          createdAt: '2026-11-09T10:00:00.000Z',
          attachments: [],
          threadRepliesCount: 0,
        },
        {
          id: '7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f',
          threadRootId: null,
          deletedAt: null,
          text: 'https://example.com/very/long/path/without/spaces/that/must/be/clamped/with/ellipsis/at/the/end',
          author: { displayName: 'Петров Пётр Петрович' },
          createdAt: '2026-11-09T10:05:00.000Z',
          attachments: [],
          threadRepliesCount: 0,
        },
      ],
    },
  }),
}));

import { ThreadLevel } from './forward-thread-picker.js';

/**
 * #672: `line-clamp-2` держится на `display: -webkit-box`, а соседний `block`
 * перебивает его в собранном CSS — превью треда не режется вовсе (граница
 * мёртвого `-webkit-line-clamp`, gotcha `docs/gotchas/frontend.md`, строка 2).
 * Без `wrap-anywhere` неразрывная строка (URL) тоже не клампится: `line-clamp`
 * не переносит её, и `overflow: hidden` режет по горизонтали без многоточия.
 * Тест сторожит возврат `block` и потерю переноса длинного URL.
 */
const conversation = {
  id: '5f1c9f7e-8c2a-4f6b-9d3e-7a1b2c3d4e5f',
  type: 'channel',
  title: 'Канал',
  membersPreview: [],
  task: null,
  letter: null,
} as unknown as ConversationListItem;

afterEach(cleanup);

describe('ThreadLevel — превью корня треда (#672)', () => {
  it('две строки с многоточием: line-clamp-2 без block', () => {
    render(<ThreadLevel conversation={conversation} onBack={vi.fn()} onPick={vi.fn()} />);

    const preview = screen.getByText(/Очень длинный текст обсуждения/);

    expect(preview.className).toContain('line-clamp-2');
    expect(preview.className).not.toMatch(/(^|\s)block(\s|$)/);
  });

  it('неразрывная строка (URL) тоже клампится: есть wrap-anywhere', () => {
    render(<ThreadLevel conversation={conversation} onBack={vi.fn()} onPick={vi.fn()} />);

    const preview = screen.getByText(/https:\/\/example\.com\/very\/long/);

    expect(preview.className).toContain('line-clamp-2');
    expect(preview.className).toContain('wrap-anywhere');
    expect(preview.className).not.toMatch(/(^|\s)block(\s|$)/);
  });
});
