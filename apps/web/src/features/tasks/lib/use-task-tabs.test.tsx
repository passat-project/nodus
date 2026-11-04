// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ViewerTarget } from '../../../shared/files/viewer-store.js';
import { useTaskTabs } from './use-task-tabs.js';

const file: ViewerTarget = {
  fileId: 'file-1',
  name: 'smeta.docx',
  mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  size: 1024,
  url: '/files/file-1',
};

describe('useTaskTabs', () => {
  it('открывает, активирует и закрывает вкладки; смена задачи сбрасывает к «Чату»', () => {
    const { result, rerender } = renderHook(({ id }: { id: string }) => useTaskTabs(id), {
      initialProps: { id: 'task-1' },
    });

    act(() => result.current.openFile(file));
    expect(result.current.tabs.active).toBe('file:file-1');
    expect(result.current.tabs.files).toHaveLength(1);

    act(() => result.current.activateTab('chat'));
    expect(result.current.tabs.active).toBe('chat');

    act(() => result.current.closeFile('file-1'));
    expect(result.current.tabs.files).toHaveLength(0);

    act(() => result.current.openFile(file));
    rerender({ id: 'task-2' });
    expect(result.current.tabs.active).toBe('chat');
    expect(result.current.tabs.files).toHaveLength(0);
  });
});
