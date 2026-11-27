import { afterEach, describe, expect, it } from 'vitest';

import {
  acquireOpenThread,
  getOpenThread,
  isOpenThreadMatch,
  resetOpenThreadRegistry,
} from './open-thread.js';

/** Реестр открытого окна треда (#1072): область тишины для ответов в треде. */

const CONV = 'conv-1';
const ROOT_A = 'root-a';
const ROOT_B = 'root-b';

afterEach(resetOpenThreadRegistry);

describe('open-thread registry (#1072)', () => {
  it('пусто — треда нет', () => {
    expect(getOpenThread()).toBeNull();
    expect(isOpenThreadMatch({ conversationId: CONV, threadRootId: ROOT_A })).toBe(false);
  });

  it('открытый тред совпадает только сам с собой', () => {
    const release = acquireOpenThread(CONV, ROOT_A);
    expect(isOpenThreadMatch({ conversationId: CONV, threadRootId: ROOT_A })).toBe(true);
    expect(isOpenThreadMatch({ conversationId: CONV, threadRootId: ROOT_B })).toBe(false);
    expect(isOpenThreadMatch({ conversationId: 'conv-2', threadRootId: ROOT_A })).toBe(false);
    // корневое сообщение областью треда не считается
    expect(isOpenThreadMatch({ conversationId: CONV, threadRootId: null })).toBe(false);
    release();
  });

  it('последний хост побеждает; реестр живёт до последнего release', () => {
    const releaseA = acquireOpenThread(CONV, ROOT_A);
    const releaseB = acquireOpenThread(CONV, ROOT_B);
    expect(getOpenThread()).toMatchObject({ conversationId: CONV, threadRootId: ROOT_B });
    releaseB();
    expect(getOpenThread()).toMatchObject({ conversationId: CONV, threadRootId: ROOT_A });
    releaseA();
    expect(getOpenThread()).toBeNull();
  });
});
