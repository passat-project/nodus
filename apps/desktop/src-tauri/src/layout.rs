//! Единый раскладчик стека попапов (#254): один проход решает всё —
//! порядок по счёту показа (новейший у ПОЛА), позиции КУМУЛЯТИВНО по
//! ФАКТИЧЕСКИМ высотам окон (`popup_set_height` от мини-UI, #406): разросшееся
//! поле ответа приподнимает верхние — дыр и наездов не бывает. Окно «Скрыть
//! все» стоит строго над ПОЛНЫМ столбиком с тем же зазором, что между
//! карточками (фидбек владельца 08.10).
//!
//! Позиция и размер применяются ОДНИМ `SetWindowPos` (атомарно): пара
//! set_size+set_position давала промежуточный кадр, в котором контент уже
//! вырос, а окно ещё нет — фокус поля ответа успевал прокрутить карточку
//! (`overflow:hidden` — это scroll container) и унести крестик за край (#406).
//!
//! Монитор раскладки выбирает `anchor` (#588): курсор → главное окно →
//! первичный монитор; попап рождается сразу на своём месте (позиция билдера),
//! поэтому системный каскад в левом верхнем углу не показывается никогда.

use tauri::{AppHandle, Manager};

use crate::anchor::{remember_anchor, resolve_anchor, Anchor};
use crate::popups::{
    build_popup_window, show_without_activation, spawn_ready_fallback, stack, ActivePopup, GAP,
    HIDE_ALL_H, HIDE_ALL_LABEL, MAX_STACK, POPUP_MAX_H, POPUP_MIN_H, POPUP_W,
};

/// Готовая раскладка одного окна: координаты и размер — физические px.
struct Placement {
    label: String,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    /// Масштаб монитора — для логической позиции билдера окна.
    scale: f64,
}

impl Placement {
    /// Позиция для билдера `WebviewWindow` (логические px, tao переведёт её
    /// обратно по DPI монитора).
    fn logical_position(&self) -> (f64, f64) {
        (
            f64::from(self.x) / self.scale,
            f64::from(self.y) / self.scale,
        )
    }
}

/// Вертикальная раскладка столбика: `heights` — в порядке «новейший первым»
/// (он у пола). Возвращает (y, физическая высота) для каждого окна.
/// Чистая функция — юнит-тесты на кумулятивный подъём и клампы.
fn column(bottom: i32, heights: &[f64], scale: f64, gap: f64) -> Vec<(i32, i32)> {
    let px = |v: f64| (v * scale).round() as i32;
    let mut cursor = bottom;
    heights
        .iter()
        .map(|h| {
            let height = px(h.clamp(POPUP_MIN_H, POPUP_MAX_H));
            let y = cursor - height;
            cursor = y - px(gap);
            (y, height)
        })
        .collect()
}

/// ЕДИНЫЙ раскладчик стека (фидбек 08.10): один проход решает всё —
/// порядок по счёту показа (новейший у ПОЛА), позиции кумулятивно по
/// фактическим высотам, «Скрыть все» только над ПОЛНЫМ столбиком
/// (смысл — быстро убрать 3 попапа; фидбек 08.10 п.4).
pub(crate) fn reposition_all(app: &AppHandle) {
    let Some(anchor) = resolve_anchor(app) else {
        return;
    };
    remember_anchor(app, &anchor);
    let plan: Vec<Placement> = {
        let x = anchor.right();
        // Низ стека — над панелью задач; идём снизу вверх: новейший первым.
        let bottom = anchor.bottom();
        let mut s = stack(app);
        let mut order: Vec<&mut ActivePopup> = s.active.iter_mut().collect();
        order.sort_by_key(|p| std::cmp::Reverse(p.counter));
        let heights: Vec<f64> = order.iter().map(|p| p.height).collect();
        let placed = column(bottom, &heights, anchor.scale, GAP);
        let mut plan = Vec::with_capacity(order.len());
        for (index, (p, (y, height))) in order.iter_mut().zip(placed).enumerate() {
            p.slot = index as u32;
            plan.push(Placement {
                label: p.label.clone(),
                x,
                y,
                width: anchor.px(POPUP_W),
                height,
                scale: anchor.scale,
            });
        }
        plan
    };
    for p in &plan {
        if let Some(w) = app.get_webview_window(&p.label) {
            place_window(&w, p);
        }
    }
    place_hide_all(app, &anchor);
}

/// Атомарно переставить и изменить размер окна: позиция+размер одним
/// `SetWindowPos`. `SWP_ASYNCWINDOWPOS` — команда может прийти не с потока
/// окна (tao делает так же); `NOZORDER|NOACTIVATE` — стек попапов не
/// переупорядочиваем и фокус не крадём.
fn place_window(win: &tauri::WebviewWindow, p: &Placement) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOZORDER,
    };
    let Ok(hwnd) = win.hwnd() else { return };
    unsafe {
        let _ = SetWindowPos(
            HWND(hwnd.0),
            None,
            p.x,
            p.y,
            p.width,
            p.height,
            SWP_ASYNCWINDOWPOS | SWP_NOZORDER | SWP_NOACTIVATE,
        );
    }
}

/// Окно «Скрыть все»: РОВНО межпопапный зазор (та же арифметика кумутива),
/// живёт ТОЛЬКО при полном столбике. Создание/закрытие — под мьютексом
/// (hide_all_live): два reposition_all подряд успевали создать ОКНО-ДУБЛЬ,
/// которое вечно висело над стеком и ломало зазор.
///
/// Регрессия создания (найдена при #305): условие «создать» требовало
/// hide_all_live УЖЕ истинным — флаг никто не поднимал, плашка не создавалась
/// никогда. Теперь флаг = «стек полон», создание — окно отсутствует.
/// Показ — только ready-gate (popup_ready/fallback), как у попапов.
fn place_hide_all(app: &AppHandle, anchor: &Anchor) {
    let action: Option<(bool, Placement)> = {
        let width = anchor.px(POPUP_W);
        let height = anchor.px(HIDE_ALL_H);
        let mut s = stack(app);
        let mut order: Vec<&mut ActivePopup> = s.active.iter_mut().collect();
        order.sort_by_key(|p| std::cmp::Reverse(p.counter));
        let heights: Vec<f64> = order.iter().map(|p| p.height).collect();
        let top = column(anchor.bottom(), &heights, anchor.scale, GAP)
            .last()
            .map(|(y, _)| *y);
        let full = s.active.len() >= MAX_STACK as usize;
        s.hide_all_live = full;
        if !full {
            None
        } else {
            // Окно уже существует (в т.ч. ещё закрывается после close_all) —
            // дубль-лейбл упал бы в Err; двигаем/создаём по факту.
            let window_absent = app.get_webview_window(HIDE_ALL_LABEL).is_none();
            top.map(|top| {
                let placement = Placement {
                    label: HIDE_ALL_LABEL.to_string(),
                    x: anchor.right(),
                    y: top - anchor.px(GAP) - height,
                    width,
                    height,
                    scale: anchor.scale,
                };
                (window_absent, placement)
            })
        }
    };
    match action {
        None => {
            if let Some(w) = app.get_webview_window(HIDE_ALL_LABEL) {
                let _ = w.close();
            }
        }
        Some((true, placement)) => {
            // Создание окна — ТОЛЬКО из async-контекста: сюда добирается
            // и синхронная команда (popup_set_expanded → reposition_all),
            // а WebviewWindowBuilder в sync-контексте дедлокит WebView2
            // (gotchas «Десктоп», #254; security-ревью #305).
            let app = app.clone();
            let position = placement.logical_position();
            tauri::async_runtime::spawn(async move {
                build_popup_window(&app, HIDE_ALL_LABEL, HIDE_ALL_H, Some(position));
                // Новый цикл жизни плашки — показ снова ждёт готовности.
                stack(&app).hide_all_shown = false;
                spawn_ready_fallback(&app, HIDE_ALL_LABEL);
                if let Some(win) = app.get_webview_window(HIDE_ALL_LABEL) {
                    place_window(&win, &placement);
                }
            });
        }
        Some((false, placement)) => {
            if let Some(win) = app.get_webview_window(HIDE_ALL_LABEL) {
                place_window(&win, &placement);
                // Гонка close↔create (security-прогон d25c82b): окно могло
                // родиться в эпоху неполного стека (показ не состоялся), а
                // стек снова полон — контент давно отрисован, показываем
                // через тот же одноразовый гейт (повтор — no-op).
                if stack(app).mark_shown(HIDE_ALL_LABEL) {
                    show_without_activation(&win, HIDE_ALL_LABEL);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn колонка_поднимает_верхние_при_росте_нижнего() {
        // Новейший (нижний) раскрыл поле ответа: 139 вместо 91.
        let column = column(1000, &[139.0, 91.0, 91.0], 1.0, GAP);
        assert_eq!(column[0], (861, 139), "нижний прижат к полу");
        assert_eq!(column[1], (765, 91), "средний поднялся над выросшим нижним");
        assert_eq!(column[2], (669, 91), "верхний поднялся кумулятивно");
        // Зазор ровно GAP между окнами (без дыр и наездов).
        assert_eq!(column[1].0 + column[1].1 + GAP as i32, column[0].0);
        assert_eq!(column[2].0 + column[2].1 + GAP as i32, column[1].0);
    }

    #[test]
    fn раскрытие_нижнего_поднимает_весь_столбик() {
        let idle = column(1000, &[91.0, 91.0, 91.0], 1.0, GAP);
        let expanded = column(1000, &[139.0, 91.0, 91.0], 1.0, GAP);
        assert_eq!(idle[0].0 - expanded[0].0, 48);
        assert_eq!(idle[1].0 - expanded[1].0, 48);
        assert_eq!(idle[2].0 - expanded[2].0, 48);
    }

    #[test]
    fn высоты_клампятся_и_масштабируются() {
        let column = column(1000, &[10.0, 1000.0], 1.25, GAP);
        assert_eq!(column[0].1, (POPUP_MIN_H * 1.25).round() as i32);
        assert_eq!(column[1].1, (POPUP_MAX_H * 1.25).round() as i32);
    }

    #[test]
    fn логическая_позиция_делится_на_масштаб() {
        let placement = Placement {
            label: "popup-1".into(),
            x: 1452,
            y: 952,
            width: 450,
            height: 110,
            scale: 1.25,
        };
        let (x, y) = placement.logical_position();
        assert!((x - 1161.6).abs() < 1e-9);
        assert!((y - 761.6).abs() < 1e-9);
    }
}
