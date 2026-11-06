// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomFieldDefinition, LetterDetail } from '@nodus/contracts';
import { ui } from '@nodus/contracts';
import { cleanup, render, screen } from '@testing-library/react';

import { RegistrationFields } from './registration-fields.js';
import { initialDraft } from '../../lib/registration-draft.js';

/** Форма регистрации (#55, #631): атрибуты — только привязанные к типу
 *  письма («Где используется», Р3); поле «Проект» — только при доступном
 *  модуле проектов (Р15); обязательные — звёздочкой, ошибки — строкой. */
const TYPE_ID = '00000000-0000-4000-8000-0000000000a1';

vi.mock('../../api/letters-queries.js', () => ({
  useReceiptMethods: () => ({ data: [] }),
}));

const definitionsData = { current: undefined as CustomFieldDefinition[] | undefined };
vi.mock('../../../../shared/custom-fields/queries.js', () => ({
  useCustomFieldDefinitions: () => ({ data: definitionsData.current }),
}));

vi.mock('../../lib/registration-suggestion.js', () => ({
  useSuggestedCounterparty: () => ({ suggestion: null, fromSuggestion: false }),
}));

const projectsOn = { current: true };
vi.mock('../../../../shared/api/projects-available.js', () => ({
  projectsAvailable: () => projectsOn.current,
}));

/** Дети-тяжеловесы — заглушки: форма проверяется в своих решениях. */
vi.mock('./reply-suggestion.js', () => ({
  ReplySuggestion: () => <div data-testid="reply-suggestion" />,
}));
vi.mock('./addressee-field.js', () => ({
  AddresseeField: () => <div data-testid="addressee" />,
}));
vi.mock('./signer-field.js', () => ({ SignerField: () => <div data-testid="signer" /> }));
vi.mock('./date-input.js', () => ({ DateInput: () => <div data-testid="date-input" /> }));
vi.mock('./attached-refs-section.js', () => ({
  AttachedRefsSection: () => <div data-testid="attached-refs" />,
}));
vi.mock('../../../../shared/counterparties/counterparty-combobox.js', () => ({
  CounterpartyCombobox: () => <div data-testid="counterparty" />,
}));
vi.mock('../../../../shared/ui/project-picker.js', () => ({
  ProjectPicker: () => <div data-testid="project-picker" />,
}));

const attributeProps: { current: { ids: string[] } | null } = { current: null };
vi.mock('./registration-attributes.js', () => ({
  RegistrationAttributes: (props: { definitions: CustomFieldDefinition[] }) => {
    attributeProps.current = { ids: props.definitions.map((d) => d.id) };
    return <div data-testid="registration-attributes" />;
  },
}));

function definition(id: string, typeIds: string[]) {
  return {
    id,
    number: 1,
    type: 'text',
    name: `Поле ${id}`,
    hint: null,
    settings: {},
    dictionary: null,
    defaultValue: null,
    defaultRefs: [],
    reportIndexed: false,
    isCompany: false,
    companyValue: null,
    bindings: { processTypeIds: typeIds, projectTypeIds: [], nodeKindIds: [] },
    sortOrder: 0,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
  } satisfies CustomFieldDefinition;
}

const BOUND = definition('58000000-0000-4000-8000-000000000001', [TYPE_ID]);
const OTHER_TYPE = definition('58000000-0000-4000-8000-000000000002', [
  '00000000-0000-4000-8000-0000000000a9',
]);

const LETTER: LetterDetail = {
  id: '70000000-0000-4000-8000-000000000001',
  typeId: TYPE_ID,
  direction: 'incoming',
  stage: {
    id: '00000000-0000-4000-8000-0000000000s1',
    name: 'Новые',
    order: 0,
    systemState: 'active',
    color: 'neutral',
  },
  regNumber: null,
  regDate: null,
  registeredAt: null,
  receivedAt: '2026-11-05T09:00:00.000Z',
  source: 'mail',
  mailFromName: 'Галургия',
  mailFromAddress: 'mail@galurgia.by',
  subject: 'О поставке оборудования',
  counterparty: null,
  theirNumber: null,
  theirDate: null,
  receiptMethod: null,
  project: null,
  addressee: null,
  responseDeadline: null,
  replyTo: null,
  attachmentCount: 0,
  viewed: false,
  confidential: false,
  type: {
    id: TYPE_ID,
    code: 'letter',
    name: 'Входящее письмо',
    category: 'letter',
    icon: 'square-check',
    color: 'neutral',
  },
  signer: null,
  registrar: null,
  mail: null,
  replySuggestion: null,
  counterpartySuggestion: null,
  attachments: [],
  body: { kind: 'none' },
  customFields: {},
  customFieldRefs: [],
  attachedRefs: [],
  canManageRelations: false,
  access: { canEdit: true, canDeleteSpam: false, canJoin: false, isParticipant: false },
};

function renderForm(props: Partial<Parameters<typeof RegistrationFields>[0]> = {}) {
  return render(
    <RegistrationFields
      letter={LETTER}
      value={initialDraft(LETTER, [])}
      onChange={() => {}}
      {...props}
    />,
  );
}

afterEach(() => {
  cleanup();
  definitionsData.current = undefined;
  projectsOn.current = true;
  attributeProps.current = null;
});

describe('RegistrationFields', () => {
  it('модуль проектов доступен — поле «Проект» с пикером', () => {
    projectsOn.current = true;
    renderForm();
    expect(screen.getByText(ui.letters.fields.project)).toBeTruthy();
    expect(screen.getByTestId('project-picker')).toBeTruthy();
  });

  it('модуль проектов недоступен — поля «Проект» нет', () => {
    projectsOn.current = false;
    renderForm();
    expect(screen.queryByText(ui.letters.fields.project)).toBeNull();
    expect(screen.queryByTestId('project-picker')).toBeNull();
  });

  it('атрибуты — только привязанные к типу письма (#631, Р3)', () => {
    definitionsData.current = [BOUND, OTHER_TYPE];
    renderForm();

    expect(screen.getByTestId('registration-attributes')).toBeTruthy();
    expect(attributeProps.current?.ids).toEqual([BOUND.id]);
  });

  it('без привязанных атрибутов секции атрибутов нет', () => {
    definitionsData.current = [OTHER_TYPE];
    renderForm();
    expect(screen.queryByTestId('registration-attributes')).toBeNull();
  });

  it('обязательные поля — со звёздочкой, ошибки — строкой у поля', () => {
    renderForm({ invalidKeys: { counterpartyId: 'Выберите контрагента' } });

    const [label] = screen.getAllByText(ui.letters.fields.counterparty, { exact: false });
    expect(label?.textContent).toContain('*');
    expect(screen.getByText('Выберите контрагента')).toBeTruthy();
    // Необязательное поле — без звёздочки.
    expect(screen.getByText(ui.letters.fields.signer).textContent).not.toContain('*');
  });
});
