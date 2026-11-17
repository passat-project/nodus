/**
 * Общая шапка правой панели «Сотрудников» (#768, вердикт 16.11.2026): одна
 * строка h-14 — та же высота, что шапка страницы, поэтому название отдела,
 * «⋯»/«×» и «Список должностей» стоят на одной горизонтали с «Пригласить» и
 * поиском (центры совпадают; панель начинается на оси контура и верхнего
 * паддинга не имеет). Действия — справа, заголовок обрезается.
 */
export function StructurePanelHeader({
  title,
  leading,
  actions,
}: {
  title: string;
  /** Иконка перед названием (главная карточка компании). */
  leading?: React.ReactNode;
  /** Действия справа: «⋯» отдела или «×» панели должностей. */
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {leading}
        <h2 className="truncate text-base font-semibold">{title}</h2>
      </div>
      {actions}
    </div>
  );
}
