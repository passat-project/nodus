import { createElement, type ComponentType, type FunctionComponent } from 'react';

import { markChunkLoaded, reloadOnceOnChunkError } from './chunk-reload.js';

/**
 * Канон ленивой загрузки кода — и страницы разделов, и куски вне страниц
 * (тела карточек типов в стеке, `shell/card-type-entry.tsx`).
 *
 * Страница раздела отвечает на `preload()` (#1051): роутер зовёт его при
 * наведении и фокусе на ссылку раздела (`defaultPreload: 'intent'`) — чанк
 * грузится до клика. Предзагрузка guard НЕ включает: после выкатки устаревший
 * чанк перезагружал бы страницу по одному наведению, с потерей несохранённого
 * ввода.
 *
 * Компонент — НЕ `React.lazy`: тот при первом рендере всегда приостанавливается,
 * даже когда код давно загружен, а React после приостановки держит контент ещё
 * 300 мс (`FALLBACK_THROTTLE_MS`; react.dev, `<Suspense>`: «reveals suspended
 * content at most once every 300ms»). Прогретый раздел простаивал треть
 * секунды прежде, чем начать грузить данные (#1051, замер: раздел монтировался
 * через 360 мс после клика). Здесь код, полученный предзагрузкой, рендерится
 * сразу; ждёт импорта только тот, которого на руках нет (говорят об этом
 * броском промиса — границу `<Suspense>` со скелетом ставит вызывающий).
 * Пропсы уходят загруженному компоненту как есть.
 *
 * Guard гибели чанка после деплоя (репорт владельца 24.09, #88) включён только
 * реальным входом; семантика — общая в `chunk-reload.ts`.
 *
 * Листовый модуль (зависит только от `chunk-reload`): файл роутера импортирует
 * шелл (`AppShell`), а шелку нужен сам загрузчик — импорт из `router.tsx`
 * давал бы цикл router ↔ shell. Из `router.tsx` — реэкспорт.
 */
type PageModule<Props> = { default: ComponentType<Props> };
export type PreloadablePage<Props = object> = FunctionComponent<Props> & {
  preload: () => Promise<void>;
};

export function pageLoader<Props extends object = object>(
  loader: () => Promise<PageModule<Props>>,
): PreloadablePage<Props> {
  let pending: Promise<PageModule<Props>> | undefined;
  /** Код раздела на руках — признак ставится раньше, чем разрешится промис. */
  let loaded: ComponentType<Props> | undefined;
  let reloading = false;
  /** Один импорт на все пути; отказ не копится — следующая попытка пробует снова. */
  const importPage = (): Promise<PageModule<Props>> => {
    pending ??= loader().then(
      (module) => {
        loaded = module.default;
        markChunkLoaded();
        return module;
      },
      (error: unknown) => {
        pending = undefined;
        throw error;
      },
    );
    return pending;
  };
  /** Реальный вход кода на руках не принёс: отказ включает guard. */
  const enter = async (): Promise<PageModule<Props>> => {
    try {
      return await importPage();
    } catch (error) {
      // Запущенный reload не отменить: повторный рендер не должен «снимать»
      // флаг и показывать ошибку поверх уходящей страницы.
      if (reloading || reloadOnceOnChunkError()) {
        reloading = true;
        return new Promise<never>(() => {});
      }
      throw error;
    }
  };
  const Page: PreloadablePage<Props> = function Page(props: Props) {
    if (!loaded) throw enter();
    return createElement<Props>(loaded, props);
  };
  // Провал предзагрузки не рвёт страницу и не перезагружает её: вход повторит
  // импорт сам — и уже его guard решает, перезагружать ли.
  Page.preload = () =>
    importPage().then(
      () => undefined,
      () => undefined,
    );
  return Page;
}
