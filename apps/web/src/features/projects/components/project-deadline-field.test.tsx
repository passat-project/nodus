// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ui } from '@nodus/contracts';
import { cleanup, render } from '@testing-library/react';

import { ProjectDeadlineField, toIsoDate } from './project-deadline-field.js';

/** Крайний срок проекта (#631): только дата, НАШ пикер; локальная дата ↔
 *  ISO-день контракта без сдвига часового пояса. */
const pickerProps: { current: Record<string, unknown> | null } = { current: null };
vi.mock('../../../shared/ui/date-time-picker.js', () => ({
  DateTimePicker: (props: Record<string, unknown>) => {
    pickerProps.current = props;
    return <div data-testid="date-time-picker" />;
  },
}));

afterEach(() => {
  cleanup();
  pickerProps.current = null;
});

describe('toIsoDate', () => {
  it('локальная дата → `YYYY-MM-DD` с нулями; null → null', () => {
    expect(toIsoDate(new Date(2026, 10, 6))).toBe('2026-11-06');
    expect(toIsoDate(new Date(2026, 0, 31))).toBe('2026-01-31');
    expect(toIsoDate(new Date(2027, 11, 5))).toBe('2027-12-05');
    expect(toIsoDate(null)).toBeNull();
  });
});

describe('ProjectDeadlineField', () => {
  it('пикер без времени, метка и placeholder — «Крайний срок»', () => {
    render(<ProjectDeadlineField value="2026-11-06" onChange={() => {}} />);

    expect(pickerProps.current).toMatchObject({
      withTime: false,
      ariaLabel: ui.projects.deadline,
      placeholder: ui.common.pickDate,
    });
    // ISO-день → локальная полночь того же дня.
    const value = pickerProps.current!.value as Date;
    expect(value).toEqual(new Date(2026, 10, 6));
  });

  it('null — пикер без даты; выбор даты отдаёт ISO-день, очистка — null', () => {
    const onChange = vi.fn();
    render(<ProjectDeadlineField value={null} onChange={onChange} />);

    expect(pickerProps.current!.value).toBeNull();

    (pickerProps.current!.onChange as (date: Date | null) => void)(new Date(2026, 10, 6));
    expect(onChange).toHaveBeenCalledWith('2026-11-06');

    (pickerProps.current!.onChange as (date: Date | null) => void)(null);
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
