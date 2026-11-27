import { describe, expect, it } from 'vitest';

import { requestMessageJump, useJumpStore } from './jump-store.js';

/** Прыжок к сообщению-причине уведомления (#1072): id чистится от префикса
 *  правок, произвольные id (не uuid) прыжка не просят. */

const CONV = '33333333-3333-3333-3333-333333333333';
const MSG = '44444444-4444-4444-4444-444444444444';
const THREAD = '55555555-5555-5555-5555-555555555555';

describe('requestMessageJump (#1072)', () => {
  it('uuid — прыжок с областью треда', () => {
    requestMessageJump(CONV, MSG, THREAD);
    expect(useJumpStore.getState().target).toMatchObject({
      conversationId: CONV,
      messageId: MSG,
      threadRootId: THREAD,
    });
  });

  it('id правки «edit:<uuid>» — префикс снимается', () => {
    requestMessageJump(CONV, `edit:${MSG}`);
    expect(useJumpStore.getState().target).toMatchObject({ messageId: MSG, threadRootId: null });
  });

  it('не-uuid (notificationId повтора срочного) и пустые — молча без прыжка', () => {
    useJumpStore.getState().consume(useJumpStore.getState().target!.nonce);
    requestMessageJump(CONV, 'n-12345');
    requestMessageJump(CONV, null);
    requestMessageJump(CONV, undefined);
    expect(useJumpStore.getState().target).toBeNull();
  });
});
