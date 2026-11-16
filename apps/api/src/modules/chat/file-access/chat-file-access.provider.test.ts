import { describe, expect, it, vi } from 'vitest';

import { ChatFileAccess } from './chat-file-access.provider.js';

/**
 * AUD-004: вложение принадлежит беседе, а не автору. Если файл приложен к
 * живым сообщениям, а пользователь не участник ни одной из этих бесед,
 * контрибьютор даёт явное вето (`deny`) поверх владения файлом — иначе
 * исключённый из беседы автор продолжал открывать и править своё вложение.
 * Незаклеймленная загрузка (нет привязки к сообщению) остаётся владельцу:
 * решение `null`, движок смотрит owner_id.
 */
function setup(opts: { conversations: string[]; memberOf?: string[] }) {
  const repo = {
    conversationIdsByFileId: vi.fn(async () => opts.conversations),
    membershipRole: vi.fn(async (conversationId: string) =>
      opts.memberOf?.includes(conversationId) ? 'member' : null,
    ),
  };
  return { access: new ChatFileAccess(repo as never), repo };
}

describe('ChatFileAccess (#138, AUD-004)', () => {
  it('участник беседы вложения — просмотр и правка', async () => {
    const { access, repo } = setup({ conversations: ['conv-1'], memberOf: ['conv-1'] });
    expect(await access.check('file-1', 'u1')).toEqual({ canView: true, canEdit: true });
    expect(repo.membershipRole).toHaveBeenCalledWith('conv-1', 'u1');
  });

  it('не-участник беседы вложения — явное вето (не только canView:false)', async () => {
    const { access } = setup({ conversations: ['conv-1'], memberOf: [] });
    expect(await access.check('file-1', 'u1')).toEqual({
      canView: false,
      canEdit: false,
      deny: true,
    });
  });

  it('файл приложен в две беседы: участник одной — доступ есть', async () => {
    const { access } = setup({ conversations: ['conv-1', 'conv-2'], memberOf: ['conv-2'] });
    expect(await access.check('file-1', 'u1')).toEqual({ canView: true, canEdit: true });
  });

  it('файл приложен в две беседы, пользователь не участник ни одной — вето', async () => {
    const { access } = setup({ conversations: ['conv-1', 'conv-2'], memberOf: [] });
    expect(await access.check('file-1', 'u1')).toEqual({
      canView: false,
      canEdit: false,
      deny: true,
    });
  });

  it('незаклеймленная загрузка контекстом не считается — null (доступ по владению)', async () => {
    const { access, repo } = setup({ conversations: [] });
    expect(await access.check('file-1', 'u1')).toBeNull();
    expect(repo.membershipRole).not.toHaveBeenCalled();
  });
});
