import { devUiStrings } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@nodus/ui/components/empty';
import { Inbox, Search, TriangleAlert } from 'lucide-react';

import { DevGroup, DevSection } from '../dev-section.js';

/**
 * Ф4: состояния экранов. Формы взяты из продуктовых экранов (пустой журнал,
 * ошибка загрузки списка, пустой результат поиска) — галерея проверяет, что
 * канон один: иконка, заголовок, объяснение, действие; зона списка не меняет
 * габарит при пустом результате.
 */
export function StatesSection() {
  return (
    <DevSection
      id="dev-states"
      label={devUiStrings.sections.states}
      hint={devUiStrings.states.hint}
    >
      <div className="grid min-w-0 gap-4 xl:grid-cols-3">
        <DevGroup
          title={devUiStrings.states.empty}
          hint={devUiStrings.states.emptyHint}
          caption={devUiStrings.states.captionEmpty}
        >
          <div className="flex min-h-64 items-center justify-center">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Inbox strokeWidth={1.75} />
                </EmptyMedia>
                <EmptyTitle>{devUiStrings.states.emptyTitle}</EmptyTitle>
                <EmptyDescription>{devUiStrings.states.emptyText}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline">{devUiStrings.states.emptyAction}</Button>
              </EmptyContent>
            </Empty>
          </div>
        </DevGroup>

        <DevGroup
          title={devUiStrings.states.loadError}
          hint={devUiStrings.states.loadErrorHint}
          caption={devUiStrings.states.captionLoadError}
        >
          <div className="flex min-h-64 items-center justify-center">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <TriangleAlert strokeWidth={1.75} />
                </EmptyMedia>
                <EmptyTitle>{devUiStrings.states.loadErrorTitle}</EmptyTitle>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline">{devUiStrings.states.retry}</Button>
              </EmptyContent>
            </Empty>
          </div>
        </DevGroup>

        <DevGroup
          title={devUiStrings.states.searchEmpty}
          hint={devUiStrings.states.searchEmptyHint}
          caption={devUiStrings.states.captionSearchEmpty}
        >
          <div className="flex min-h-64 items-center justify-center">
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search strokeWidth={1.75} />
                </EmptyMedia>
                <EmptyTitle>{devUiStrings.states.searchEmptyTitle}</EmptyTitle>
                <EmptyDescription>{devUiStrings.states.searchEmptyText}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          </div>
        </DevGroup>
      </div>
    </DevSection>
  );
}
