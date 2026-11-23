//! Единый раскладчик стека попапов (#254): один проход решает всё — две
//! полосы (сообщения/письма — от пола вверх, подтверждение скачивания — от
//! потолка вниз, #992), порядок по счёту показа, позиции КУМУЛЯТИВНО по
//! ФАКТИЧЕСКИМ высотам окон (`popup_set_height` от мини-UI, #406): разросшееся
//! поле ответа приподнимает верхние — дыр и наездов не бывает. Окно «Скрыть
//! все» стоит строго над ПОЛНЫМ столбиком сообщений/писем с тем же зазором,
//! что между карточками (фидбек владельца 08.10).
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

use crate::anchor::{resolve_anchor, Anchor};
use crate::popups::{
    build_popup_window, show_without_activation, spawn_ready_fallback, stack, ActivePopup,
    PopupLane, GAP, HIDE_ALL_H, HIDE_ALL_LABEL, MAX_STACK, POPUP_MAX_H, POPUP_MIN_H, POPUP_W,
};
use crate::reanchor::note_layout;

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

/// Вертикальная раскладка нижней полосы: `heights` — в порядке «новейший
/// первым» (он у пола). Возвращает (y, физическая высота) для каждого окна.
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

/// Вертикальная раскладка верхней полосы (#992): `heights` — в порядке
/// «новейшее первым» (оно прижато к верху), следующие идут вниз с тем же
/// зазором, что и в нижней полосе. Чистая функция — юнит-тесты.
fn column_down(top: i32, heights: &[f64], scale: f64, gap: f64) -> Vec<(i32, i32)> {
    let px = |v: f64| (v * scale).round() as i32;
    let mut cursor = top;
    heights
        .iter()
        .map(|h| {
            let height = px(h.clamp(POPUP_MIN_H, POPUP_MAX_H));
            let y = cursor;
            cursor = y + height + px(gap);
            (y, height)
        })
        .collect()
}

/// ЕДИНЫЙ раскладчик стека (фидбек 08.10, две полосы — #992): один проход
/// решает всё — порядок по счёту показа, позиции кумулятивно по фактическим
/// высотам, «Скрыть все» только над ПОЛНЫМ столбиком сообщений/писем
/// (смысл — быстро убрать 3 попапа; фидбек 08.10 п.4).
pub(crate) fn reposition_all(app: &AppHandle) {
    let Some(anchor) = resolve_anchor(app) else {
        return;
    };
    note_layout(app, &anchor);
    let plan: Vec<Placement> = {
        let x = anchor.right();
        let width = anchor.px(POPUP_W);
        let mut s = stack(app);
        let mut order: Vec<&mut ActivePopup> = s.active.iter_mut().collect();
        order.sort_by_key(|p| std::cmp::Reverse(p.counter));
        // Слоты уникальны на всю раскладку: по ним `free_slot` ищет свободное
        // место (полос две, индексы внутри полосы пересекались бы).
        for (index, p) in order.iter_mut().enumerate() {
            p.slot = index as u32;
        }
        let (chats, downloads): (Vec<&mut ActivePopup>, Vec<&mut ActivePopup>) =
            order.into_iter().partition(|p| p.lane == PopupLane::Chat);
        let mut plan = Vec::with_capacity(chats.len() + downloads.len());
        // Нижняя полоса — сообщения и письма: новейший у пола, стек вверх.
        let chat_heights: Vec<f64> = chats.iter().map(|p| p.height).collect();
        let chat_placed = column(anchor.bottom(), &chat_heights, anchor.scale, GAP);
        for (p, (y, height)) in chats.into_iter().zip(chat_placed) {
            plan.push(Placement {
                label: p.label.clone(),
                x,
                y,
                width,
                height,
                scale: anchor.scale,
            });
        }
        // Верхняя полоса — подтверждение скачивания: новейшее у потолка,
        // следующие ниже с тем же зазором (#992).
        let download_heights: Vec<f64> = downloads.iter().map(|p| p.height).collect();
        let download_placed = column_down(anchor.top(), &download_heights, anchor.scale, GAP);
        for (p, (y, height)) in downloads.into_iter().zip(download_placed) {
            plan.push(Placement {
                label: p.label.clone(),
                x,
                y,
                width,
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

/// Single-flight создания плашки «Скрыть все» (#408): async-билд WebView2
/// идёт вне мьютекса, поэтому серия `reposition_all` успевала запустить
/// несколько билдов до появления окна в реестре Tauri. Флаг ставится под
/// мьютексом; снимает его только завершившийся билд.
fn begin_hide_all_create(creating: &mut bool, full: bool, window_absent: bool) -> bool {
    if !full || !window_absent || *creating {
        return false;
    }
    *creating = true;
    true
}

/// Окно «Скрыть все»: РОВНО межпопапный зазор (та же арифметика кумутива),
/// живёт ТОЛЬКО при полном столбике сообщений/писем (карточки скачивания в
/// верхней полосе в него не входят — #992). Создание/закрытие — под мьютексом
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
        let mut chats: Vec<&mut ActivePopup> = s
            .active
            .iter_mut()
            .filter(|p| p.lane == PopupLane::Chat)
            .collect();
        chats.sort_by_key(|p| std::cmp::Reverse(p.counter));
        let heights: Vec<f64> = chats.iter().map(|p| p.height).collect();
        let top = column(anchor.bottom(), &heights, anchor.scale, GAP)
            .last()
            .map(|(y, _)| *y);
        let full = chats.len() >= MAX_STACK as usize;
        s.hide_all_live = full;
        if !full {
            None
        } else {
            // Окно уже существует (в т.ч. ещё закрывается после close_all) —
            // дубль-лейбл упал бы в Err; двигаем/создаём по факту.
            let window_absent = app.get_webview_window(HIDE_ALL_LABEL).is_none();
            let create = begin_hide_all_create(&mut s.hide_all_creating, full, window_absent);
            if !window_absent || create {
                top.map(|top| {
                    let placement = Placement {
                        label: HIDE_ALL_LABEL.to_string(),
                        x: anchor.right(),
                        y: top - anchor.px(GAP) - height,
                        width,
                        height,
                        scale: anchor.scale,
                    };
                    (create, placement)
                })
            } else {
                // Билд уже в полёте — второй не запускаем.
                None
            }
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
                // Билд завершён: снимаем single-flight и перечитываем стек —
                // пока он строился, попапы могли закрыться (обратная гонка
                // #408): окно-дубль не должно остаться скрытым.
                let still_full = {
                    let mut s = stack(&app);
                    s.hide_all_creating = false;
                    s.hide_all_live
                };
                if !still_full {
                    if let Some(win) = app.get_webview_window(HIDE_ALL_LABEL) {
                        let _ = win.close();
                    }
                    return;
                }
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
    fn верхняя_полоса_растёт_вниз_новейшее_сверху() {
        // Новейшее (первое в списке) прижато к верху, следующие — ниже.
        let column = column_down(100, &[139.0, 91.0, 91.0], 1.0, GAP);
        assert_eq!(column[0], (100, 139), "новейшее прижато к потолку");
        assert_eq!(column[1], (244, 91), "следующее ниже с зазором");
        assert_eq!(column[2], (340, 91), "третье — кумулятивно ниже");
        // Зазор ровно GAP между окнами (без дыр и наездов).
        assert_eq!(column[0].0 + column[0].1 + GAP as i32, column[1].0);
        assert_eq!(column[1].0 + column[1].1 + GAP as i32, column[2].0);
    }

    #[test]
    fn верхняя_полоса_клампят_высоты_и_масштабирует() {
        let column = column_down(0, &[10.0, 1000.0], 1.25, GAP);
        assert_eq!(column[0].1, (POPUP_MIN_H * 1.25).round() as i32);
        assert_eq!(column[1].1, (POPUP_MAX_H * 1.25).round() as i32);
        // Второе окно начинается после первого и зазора (5×1.25 ≈ 6).
        assert_eq!(column[1].0, column[0].1 + 6);
    }

    #[test]
    fn создание_плашки_single_flight() {
        let mut creating = false;
        let mut creates = 0;
        // Два reposition_all подряд при полном стеке — ровно один билд.
        for _ in 0..2 {
            if begin_hide_all_create(&mut creating, true, true) {
                creates += 1;
            }
        }
        assert_eq!(creates, 1);

        // Билд завершился (флаг снят) — следующий цикл снова может создать.
        creating = false;
        assert!(begin_hide_all_create(&mut creating, true, true));
        // Неполный стек и уже существующее окно билд не запускают.
        creating = false;
        assert!(!begin_hide_all_create(&mut creating, false, true));
        assert!(!begin_hide_all_create(&mut creating, true, false));
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
