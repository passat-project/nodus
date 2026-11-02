import { ui } from '@nodus/contracts';
import { Input } from '@nodus/ui/components/input';
import { NodeLabel } from '@nodus/ui/components/node-label';

/** Поля пакетного создания папок в окне «Создать папку» (#556): общее
 *  название и диапазон номеров; предпросмотр имён собирает клиент.
 *  У вида с обязательным шифром режим недоступен (В1) — шеврон выключен
 *  вызывающим. */
export function NodeBatchFields({
  prefix,
  from,
  to,
  names,
  onPrefix,
  onFrom,
  onTo,
}: {
  prefix: string;
  from: string;
  to: string;
  names: readonly string[];
  onPrefix: (value: string) => void;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
}) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <NodeLabel label={ui.structure.batchPrefix} />
        <Input
          autoFocus
          value={prefix}
          onChange={(event) => onPrefix(event.target.value)}
          placeholder={ui.structure.kindsNamePlaceholder}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <NodeLabel label={ui.structure.batchFrom} />
          <Input
            inputMode="numeric"
            value={from}
            onChange={(event) => onFrom(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <NodeLabel label={ui.structure.batchTo} />
          <Input inputMode="numeric" value={to} onChange={(event) => onTo(event.target.value)} />
        </label>
      </div>
      {names.length > 0 ? (
        <div className="flex flex-col gap-1">
          <NodeLabel label={`${ui.structure.batchPreview}: ${names.length}`} />
          <ul className="max-h-32 overflow-y-auto text-sm text-muted-foreground">
            {names.map((entry) => (
              <li key={entry} className="truncate">
                {entry}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
