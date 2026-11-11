import { createContext, useContext, type ReactNode } from 'react';

/**
 * Видимость ПОВЕРХНОСТИ, в которой живёт наблюдатель (#770, ADR-0038): стена
 * карточек и накрытые слои — не «видимая вкладка». Карточка под верхней
 * (dormant, issue #63) и страница под непустым стеком карточек рендерятся, но
 * пользователь их не видит: квитанции прочтения, попапы и догон ленты обязаны
 * молчать, пока поверхность не вернётся на вид.
 *
 * Значение вложенное: дочерний провайдер не может «вернуть видимость» тому,
 * что накрыто предком (parent && visible). Вне провайдеров — true (обычная
 * страница).
 */
const SurfaceVisibilityContext = createContext(true);

export function SurfaceVisibilityProvider({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}): ReactNode {
  const parentVisible = useContext(SurfaceVisibilityContext);
  return (
    <SurfaceVisibilityContext.Provider value={parentVisible && visible}>
      {children}
    </SurfaceVisibilityContext.Provider>
  );
}

/** Видна ли текущая поверхность пользователю (с учётом накрывающих слоёв). */
export function useSurfaceVisible(): boolean {
  return useContext(SurfaceVisibilityContext);
}
