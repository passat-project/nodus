// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { useViewerStore } from './viewer-store.js';

/**
 * #1005: снимок триггера делается при открытии (пока фокус на источнике) —
 * к моменту закрытия activeElement уже внутри портала (плеер/кнопка).
 */
describe('viewer-store: возврат фокуса после закрытия', () => {
  afterEach(() => {
    useViewerStore.setState({ target: null, returnFocus: null });
    document.body.innerHTML = '';
  });

  it('open запоминает активный элемент, close его не теряет', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'открыть';
    document.body.append(trigger);
    trigger.focus();

    useViewerStore.getState().open({
      fileId: '00000000-0000-4000-8000-000000000001',
      name: 'ролик.mp4',
      mime: 'video/mp4',
      size: 1000,
      url: '/files/roll.mp4',
    });

    expect(useViewerStore.getState().returnFocus).toBe(trigger);
    useViewerStore.getState().close();
    expect(useViewerStore.getState().target).toBeNull();
    expect(useViewerStore.getState().returnFocus).toBe(trigger);
  });
});
