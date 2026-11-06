import { describe, expect, it } from 'vitest';

import {
  clearedNodeFields,
  DEFAULT_NODE_KIND_CONFIG,
  effectiveNodeForm,
  missingNodeFields,
  nodeFormKey,
  nodeFormValues,
  nodeKindCapabilitiesOf,
  nodeKindFormSchema,
  nodeKindHas,
  nodeKindUpdateBodySchema,
  normalizeNodeKindConfig,
  requiredNodeFields,
} from './node-kind.schemas.js';

/** Вид папки как настраиваемый тип (#556, ревизия #631): форма (слоты
 *  атрибутов), возможности, чтение значений формы, обязательность. */

const MARKA = '35560000-0000-4000-8000-000000000001';
const GIP = '35560000-0000-4000-8000-000000000002';

const kind = (form: unknown, capabilities?: unknown) => ({ form, capabilities });

describe('normalizeNodeKindConfig', () => {
  it('пустой конфиг — умолчания (шифр по желанию, атрибутов и возможностей нет)', () => {
    expect(normalizeNodeKindConfig({})).toEqual(DEFAULT_NODE_KIND_CONFIG);
    expect(normalizeNodeKindConfig(null)).toEqual(DEFAULT_NODE_KIND_CONFIG);
    expect(normalizeNodeKindConfig('broken')).toEqual(DEFAULT_NODE_KIND_CONFIG);
  });

  it('битый раздел заменяется умолчанием, целый — сохраняется', () => {
    const config = normalizeNodeKindConfig({
      form: { fields: [{ fieldId: MARKA, state: 'required' }] },
      capabilities: 'nope',
    });
    expect(config.form.fields).toEqual([{ fieldId: MARKA, state: 'required' }]);
    expect(config.capabilities).toEqual([]);
    expect(
      normalizeNodeKindConfig({ form: { fields: 'bogus' }, capabilities: ['pulse_row'] }).form,
    ).toEqual(DEFAULT_NODE_KIND_CONFIG.form);
  });

  it('возможности нормализуются: без дублей, в порядке enum', () => {
    expect(
      normalizeNodeKindConfig({
        capabilities: ['schema_row', 'document_changes', 'schema_row', 'unknown'],
      }).capabilities,
    ).toEqual(['document_changes', 'schema_row']);
  });

  it('лишние ключи конфигурации отбрасываются', () => {
    const config = normalizeNodeKindConfig({ form: { code: 'optional', fields: [] }, extra: 1 });
    expect(config).toEqual(DEFAULT_NODE_KIND_CONFIG);
  });
});

describe('nodeKindFormSchema', () => {
  it('дубли fieldId — ошибка формы', () => {
    const parsed = nodeKindFormSchema.safeParse({
      fields: [
        { fieldId: MARKA, state: 'optional' },
        { fieldId: MARKA, state: 'required' },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it('тело правки непустое и разделы заменяются целиком', () => {
    expect(nodeKindUpdateBodySchema.safeParse({}).success).toBe(false);
    const parsed = nodeKindUpdateBodySchema.safeParse({
      form: { fields: [] },
    });
    expect(parsed.success).toBe(true);
  });
});

describe('effectiveNodeForm', () => {
  const definitions = [{ id: MARKA }, { id: GIP }];

  it('все известные определения остаются в форме (скрытие — у слота, О2)', () => {
    const form = effectiveNodeForm(
      kind({
        fields: [
          { fieldId: MARKA, state: 'required' },
          { fieldId: GIP, state: 'hidden' },
        ],
      }),
      definitions,
    );
    expect(form.fields.map((slot) => slot.fieldId)).toEqual([MARKA, GIP]);
  });

  it('неизвестный id (удалённый атрибут) исключается из формы (C2)', () => {
    const form = effectiveNodeForm(
      kind({
        fields: [
          { fieldId: MARKA, state: 'optional' },
          { fieldId: '35560000-0000-4000-8000-0000000000ff', state: 'optional' },
        ],
      }),
      definitions,
    );
    expect(form.fields).toHaveLength(1);
  });

  it('без списка определений форма берётся как есть (моки)', () => {
    const form = effectiveNodeForm(kind({ fields: [{ fieldId: GIP, state: 'hidden' }] }));
    expect(form.fields).toHaveLength(1);
  });
});

describe('nodeFormValues', () => {
  it('возвращает значения только формы вида, включая «скрыто» (Р5)', () => {
    const values = {
      [MARKA]: 'item-1',
      [GIP]: 'user-1',
      '35560000-0000-4000-8000-0000000000ff': 'чужое',
    };
    const form = kind({
      fields: [
        { fieldId: MARKA, state: 'required' },
        { fieldId: GIP, state: 'hidden' },
      ],
    });
    expect(nodeFormValues(values, form)).toEqual({ [MARKA]: 'item-1', [GIP]: 'user-1' });
    expect(nodeFormValues(undefined, form)).toEqual({});
  });

  it('неизвестное определение не попадает и в значения формы', () => {
    const values = { [MARKA]: 'item-1', [GIP]: 'user-1' };
    const form = kind({
      fields: [
        { fieldId: MARKA, state: 'required' },
        { fieldId: GIP, state: 'optional' },
      ],
    });
    expect(nodeFormValues(values, form, [{ id: MARKA }])).toEqual({ [MARKA]: 'item-1' });
  });
});

describe('missingNodeFields / clearedNodeFields', () => {
  const form = {
    fields: [
      { fieldId: MARKA, state: 'required' as const },
      { fieldId: GIP, state: 'optional' as const },
    ],
  };

  it('обязательные: слоты «обязательно»', () => {
    expect(requiredNodeFields(form)).toEqual([nodeFormKey(MARKA)]);
    expect(missingNodeFields(form, {})).toEqual([`cf.${MARKA}`]);
    expect(missingNodeFields(form, { customFields: { [MARKA]: 'item' } })).toEqual([]);
  });

  it('пустая строка и пустой массив — «не заполнено»', () => {
    expect(missingNodeFields(form, { customFields: { [MARKA]: [] } })).toEqual([`cf.${MARKA}`]);
  });

  it('очистка обязательного: null и пусто ловятся, отсутствующий ключ — нет', () => {
    const keys = requiredNodeFields(form);
    expect(clearedNodeFields(keys, { [`cf.${MARKA}`]: null })).toEqual([`cf.${MARKA}`]);
    expect(clearedNodeFields(keys, { [`cf.${MARKA}`]: '' })).toEqual([`cf.${MARKA}`]);
    expect(clearedNodeFields(keys, { [`cf.${MARKA}`]: 'item' })).toEqual([]);
    expect(clearedNodeFields(keys, { name: '' })).toEqual([]);
  });
});

describe('nodeKindHas / nodeKindCapabilitiesOf', () => {
  it('возможности читаются терпимо', () => {
    expect(nodeKindHas({ capabilities: ['pulse_row'] }, 'pulse_row')).toBe(true);
    expect(nodeKindHas({ capabilities: [] }, 'pulse_row')).toBe(false);
    expect(nodeKindHas({}, 'pulse_row')).toBe(false);
    expect(nodeKindCapabilitiesOf({ capabilities: ['schema_row', 'schema_row'] })).toEqual([
      'schema_row',
    ]);
  });
});
