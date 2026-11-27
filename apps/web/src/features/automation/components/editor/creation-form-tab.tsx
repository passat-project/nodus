import { useMemo } from 'react';
import type { FormulaNode, ProcessType } from '@nodus/contracts';
import { effectiveCreationForm, ui } from '@nodus/contracts';

import { useCustomFieldDefinitions } from '../../../../shared/custom-fields/queries.js';
import type { BuilderValue } from '../../../../shared/forms/builder/builder-model.js';
import {
  BuilderSheet,
  BuilderLead,
  builderLeadNote,
  FormTabLayout,
} from '../../../../shared/forms/builder/form-builder-body.js';
import { BuilderRail } from '../../../../shared/forms/builder/builder-side.js';
import { PanelNote } from '../../../../shared/ui/panel/panel-kit.js';
import {
  creationFromBuilder,
  creationToBuilder,
  type CreationExtra,
} from '../../model/creation-builder.js';
import { useRouteDocStore } from '../../model/route-doc-store.js';
import { useCreationHost } from './creation-form-host.js';

const c = ui.automation.creation;

/**
 * Вкладка «Форма создания» типа задачи и письма (единая модель «Процессов»,
 * #857; ревизия 27.11): две панели на всю высоту — слева палитра полей
 * (`BuilderRail`: «Добавить в окно» и «Закрепить также»), по центру лист
 * окна целиком по ширине настоящего окна и на всю оставшуюся высоту;
 * прокручивается только содержимое листа. Не окном и не правой панелью:
 * правки идут прямо в черновик маршрута, как на холсте — каждая один коммит
 * стора, история, черновик и публикация общие с маршрутом; кнопок «Готово»
 * и «Отмена» нет. У письма и без права — только просмотр. Пока форма не
 * настроена (`doc.creation === null`), на листе стандартная — первая правка
 * пишет её в документ. Один редактор на экран: вкладка пишет в тот же
 * глобальный стор, что и холст, поэтому в раме под карточкой стека (и в
 * карточке под верхней) она не монтируется — `suspended` у `ProcessTypeCard`.
 */
export function CreationFormTab({
  type,
  readOnly,
  focusKey,
}: {
  type: ProcessType;
  readOnly: boolean;
  /** Поле, чьи настройки открыть сразу (пришли из проблемы публикации). */
  focusKey: string | null;
}) {
  const doc = useRouteDocStore((s) => s.document);
  // Определения уже отфильтрованы по модулю запросом (`?module=`).
  const { data: definitions } = useCustomFieldDefinitions(type.category);
  const scoped = useMemo(() => definitions ?? [], [definitions]);
  const form = useMemo(
    () => effectiveCreationForm(doc.creation, type.category),
    [doc.creation, type.category],
  );
  const value = useMemo(() => creationToBuilder(form), [form]);
  const commit = (next: BuilderValue<CreationExtra>, titleFormula: FormulaNode | null) => {
    // `creationFromBuilder` собирает форму заново без формулы названия —
    // возвращаем её в ТОЙ ЖЕ правке, иначе правка листа стирала формулу.
    const base = creationFromBuilder(form, next);
    useRouteDocStore.getState().setCreationForm(titleFormula ? { ...base, titleFormula } : base);
  };
  const host = useCreationHost(type, scoped, readOnly, form.titleFormula ?? null, (formula) =>
    commit(value, formula),
  );

  return (
    <FormTabLayout
      lead={<BuilderLead title={host.title} note={builderLeadNote({ readOnly })} />}
      notice={
        doc.creation === null ? (
          <PanelNote title={c.defaultForm}>{c.defaultFormHint}</PanelNote>
        ) : null
      }
      rail={
        readOnly && !host.lockMode ? null : (
          <BuilderRail
            value={value}
            host={host}
            readOnly={readOnly}
            onChange={(next) => commit(next, form.titleFormula ?? null)}
          />
        )
      }
    >
      <BuilderSheet
        fill
        host={host}
        value={value}
        readOnly={readOnly}
        focusKey={focusKey}
        onChange={(next) => commit(next, form.titleFormula ?? null)}
      />
    </FormTabLayout>
  );
}
