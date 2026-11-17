import { Plus, Trash2 } from 'lucide-react';
import { ui, type AssistantHeader } from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';

import { PanelAction } from '../../../shared/ui/panel/panel-kit.js';

const strings = ui.assistant.settings;

/** Дополнительные заголовки провайдера (например, HTTP-Referer OpenRouter). */
export function HeadersEditor({
  headers,
  onChange,
}: {
  headers: AssistantHeader[];
  onChange: (headers: AssistantHeader[]) => void;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] text-muted-foreground">{strings.headers}</span>
      {headers.map((header, index) => (
        <div key={index} className="flex items-center gap-2">
          <Input
            className="w-44 font-mono text-label-sm"
            placeholder={strings.headerName}
            aria-label={strings.headerName}
            value={header.name}
            onChange={(event) =>
              onChange(
                headers.map((item, i) =>
                  i === index ? { ...item, name: event.target.value } : item,
                ),
              )
            }
          />
          <Input
            className="min-w-0 flex-1 font-mono text-label-sm"
            placeholder={strings.headerValue}
            aria-label={strings.headerValue}
            value={header.value}
            onChange={(event) =>
              onChange(
                headers.map((item, i) =>
                  i === index ? { ...item, value: event.target.value } : item,
                ),
              )
            }
          />
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-destructive"
            aria-label={ui.common.remove}
            onClick={() => onChange(headers.filter((_, i) => i !== index))}
          >
            <Trash2 className="size-3.5" strokeWidth={1.75} />
          </Button>
        </div>
      ))}
      <PanelAction
        icon={Plus}
        disabled={headers.length >= 10}
        onClick={() => onChange([...headers, { name: '', value: '' }])}
      >
        {strings.addHeader}
      </PanelAction>
    </div>
  );
}
