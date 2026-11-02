import { useState } from 'react';
import type {
  CustomFieldDefinition,
  CustomFieldRef,
  CustomFieldValues,
  NodeKind,
  ProjectNode,
} from '@nodus/contracts';
import {
  effectiveNodeForm,
  missingNodeFields,
  NODE_LIMITS,
  ui,
  type NodeFormKey,
} from '@nodus/contracts';
import { Button } from '@nodus/ui/components/button';
import { Input } from '@nodus/ui/components/input';
import { NodeLabel } from '@nodus/ui/components/node-label';

import { CustomFieldEditor } from '../../../../shared/custom-fields/value-editor.js';

/** Встроенный шаг смены вида папки (#556, Р6): недостающие обязательные
 *  поля НОВОГО вида собираются здесь и уходят одним PATCH; значения прежнего
 *  вида не трогаются — они скрываются. Отмена возвращает прежний вид. */
export function NodeKindChangeStep({
  kind,
  definitions,
  node,
  refs,
  onApply,
  onCancel,
}: {
  kind: NodeKind;
  definitions: readonly CustomFieldDefinition[];
  node: ProjectNode;
  refs: readonly CustomFieldRef[];
  onApply: (body: { code?: string; customFields?: CustomFieldValues }) => void;
  onCancel: () => void;
}) {
  const form = effectiveNodeForm(kind, definitions);
  const missing = missingNodeFields(form, { code: node.code, customFields: node.customFields });
  const [code, setCode] = useState('');
  const [values, setValues] = useState<CustomFieldValues>({});
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const keys = new Set<NodeFormKey>(missing);

  const ready = missing.every((key) => {
    if (key === 'code') return code.trim().length > 0;
    const value = values[key.slice('cf.'.length)];
    return value !== undefined && value !== null && value !== '';
  });

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <span className="text-sm break-words">
        {ui.structure.kindChangeFill.replace('{name}', kind.name)}
      </span>
      {keys.has('code') ? (
        <Input
          autoFocus
          value={code}
          maxLength={NODE_LIMITS.codeLength}
          aria-label={ui.structure.nodeCode}
          placeholder={ui.structure.nodeCode}
          onChange={(event) => setCode(event.target.value)}
          className="h-8 text-sm"
        />
      ) : null}
      {[...keys]
        .filter((key) => key !== 'code')
        .map((key) => {
          const fieldId = key.slice('cf.'.length);
          const definition = byId.get(fieldId);
          if (!definition) return null;
          return (
            <div key={fieldId} className="flex flex-col gap-1">
              <NodeLabel label={definition.name} />
              <CustomFieldEditor
                definition={definition}
                value={values[fieldId]}
                refs={refs}
                variant="form"
                onCommit={(value) =>
                  setValues((prev) => {
                    const next = { ...prev };
                    if (value === null) delete next[fieldId];
                    else next[fieldId] = value;
                    return next;
                  })
                }
              />
            </div>
          );
        })}
      <div className="flex justify-end gap-1.5">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {ui.structure.kindChangeCancel}
        </Button>
        <Button
          size="sm"
          disabled={!ready}
          onClick={() =>
            onApply({
              ...(keys.has('code') ? { code: code.trim() } : {}),
              ...(Object.keys(values).length > 0 ? { customFields: values } : {}),
            })
          }
        >
          {ui.structure.kindChangeApply}
        </Button>
      </div>
    </div>
  );
}
