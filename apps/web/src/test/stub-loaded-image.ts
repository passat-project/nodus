/**
 * jsdom не загружает картинки, а Radix `AvatarImage` рисует `<img>` только
 * после `load` (пока статус не `loaded`, в DOM остаётся инициалы-заглушка).
 * Подменяем конструктор `Image` на «уже загруженный», чтобы компонентные
 * тесты видели url фото — проверяется РЕШЕНИЕ компонента (какой url отдан в
 * `<img>`), а не сетевая загрузка.
 *
 * Возвращает функцию восстановления — вызывать в `afterEach` (или в конце
 * теста), иначе подмена протечёт в соседние тесты файла:
 * `const restore = stubLoadedImage(); ... restore();`
 */
export function stubLoadedImage(): () => void {
  const original = window.Image;
  class LoadedImage extends EventTarget {
    complete = true;
    naturalWidth = 32;
    naturalHeight = 32;
    set src(_value: string) {}
  }
  window.Image = LoadedImage as unknown as typeof Image;
  return () => {
    window.Image = original;
  };
}
