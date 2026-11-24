import { useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';

import { canonicalEmployeesView } from './employees-tab.js';

/**
 * Старые адреса «Сотрудников» (#768): `?view=divisions|subordination` →
 * `structure`, `?view=settings` и неизвестный → «Список». Остальные параметры
 * (`cards`) сохраняются; нормализация — заменой URL.
 */
export function useCanonicalEmployeesView(rawView: string | undefined): void {
  const navigate = useNavigate();

  useEffect(() => {
    const canonical = canonicalEmployeesView(rawView);
    if (canonical === null) return;
    void navigate({
      to: '/employees',
      replace: true,
      search: (prev) => {
        const next = { ...prev };
        if (canonical === undefined) delete next.view;
        else next.view = canonical;
        return next;
      },
    });
  }, [rawView, navigate]);
}
