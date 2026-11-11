// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ReactNode } from 'react';

import { SurfaceVisibilityProvider, useSurfaceVisible } from './surface-visibility.js';

/** Видимость поверхности (#770, ADR-0038): карточка под верхней и страница под
 *  стеком карточек — не «видимая»; вложенный провайдер не возвращает видимость. */
describe('useSurfaceVisible', () => {
  function probe(wrapper?: (children: ReactNode) => ReactNode) {
    return renderHook(() => useSurfaceVisible(), {
      wrapper: ({ children }) => (wrapper ? wrapper(children) : children),
    }).result;
  }

  it('вне провайдеров — видима (обычная страница)', () => {
    expect(probe().current).toBe(true);
  });

  it('накрытая поверхность — не видима', () => {
    expect(
      probe((children) => (
        <SurfaceVisibilityProvider visible={false}>{children}</SurfaceVisibilityProvider>
      )).current,
    ).toBe(false);
  });

  it('вложенность: родитель накрыт — дочерний не «возвращает» видимость', () => {
    expect(
      probe((children) => (
        <SurfaceVisibilityProvider visible={false}>
          <SurfaceVisibilityProvider visible>{children}</SurfaceVisibilityProvider>
        </SurfaceVisibilityProvider>
      )).current,
    ).toBe(false);
  });

  it('вложенность: оба видимы — видима', () => {
    expect(
      probe((children) => (
        <SurfaceVisibilityProvider visible>
          <SurfaceVisibilityProvider visible>{children}</SurfaceVisibilityProvider>
        </SurfaceVisibilityProvider>
      )).current,
    ).toBe(true);
  });
});
