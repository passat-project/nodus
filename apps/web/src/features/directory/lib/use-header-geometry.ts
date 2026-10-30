import { useLayoutEffect, useRef, useState } from 'react';

import { measureCircuit } from '../../../app/shell/circuit-geometry.js';

/**
 * Геометрия страницы сотрудников (#441): верх панели подразделения — В ОДНУ
 * ГОРИЗОНТАЛЬ с осью контура (мера из того же источника, что рисует контур:
 * `measureCircuit.axisY` минус верх корня = сдвиг верха панели); ширина корня
 * — для адаптивной шапки. Вынесено из страницы: файл держится < 300 строк
 * (I5), пересчёт — на resize и ResizeObserver корня.
 */
export function useHeaderGeometry(pathname: string) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [topShift, setTopShift] = useState(0);
  const [rowWidth, setRowWidth] = useState(0);
  useLayoutEffect(() => {
    const el = rootRef.current;
    const update = () => {
      const axisY = measureCircuit(pathname, false)?.axisY;
      const rootTop = el?.getBoundingClientRect().top;
      setTopShift(axisY !== undefined && rootTop !== undefined ? axisY - rootTop : 0);
      setRowWidth(el?.clientWidth ?? 0);
    };
    update();
    const observer = el ? new ResizeObserver(update) : null;
    if (el) observer?.observe(el);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [pathname]);
  return { rootRef, topShift, rowWidth };
}
