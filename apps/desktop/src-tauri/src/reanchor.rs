//! Переякоривание стека попапов (#588, #763): один тикер на процесс, который
//! переставляет попапы, когда меняется ФИЗИЧЕСКАЯ конфигурация дисплеев или
//! возвращается input desktop.
//!
//! Почему тикер, а не событие: tao 0.37.1 не пробрасывает `WM_DISPLAYCHANGE`
//! (`WM_SETTINGCHANGE` у него обновляет только тему, `ScaleFactorChanged`
//! приходит лишь на `WM_DPICHANGED`) — при выключении монитора по DisplayPort
//! Windows считает его УДАЛЁННЫМ, рабочий стол переезжает на временный экран,
//! и ни одного события оболочка не получает (#763). Зрелые приложения держат
//! для этого отдельное скрытое окно под `WM_DISPLAYCHANGE` (крейт
//! `display-config`), у нас уже есть тикер #588 — расширяем его.
//!
//! Что НЕ триггерит перестановку: движение курсора между мониторами. Якорь
//! раскладки по-прежнему курсор (пользователь работает на текущем мониторе),
//! но попапы не должны «бегать» за мышью каждые полсекунды: сравнивается
//! подпись ТОПОЛОГИИ (позиции/размеры/масштабы/рабочие области мониторов),
//! а не позиция курсора.
//!
//! Второе правило — наследие #588: якорь, найденный по резервной цепочке
//! (сессия заблокирована, `GetCursorPos` отказывает), переставляется на
//! монитор курсора, как только input desktop вернулся.

use std::sync::{Mutex, Once};
use std::time::Duration;

use tauri::{AppHandle, Monitor};

use crate::anchor::{resolve_anchor, Anchor};
use crate::popups::stack;

/// Период проверки: смена дисплея и разблокировка замечаются в пределах
/// полусекунды (как тикер #588).
const REANCHOR_TICK_MS: u64 = 500;

/// Подпись одного монитора. Сравниваются позиция, размер, масштаб и рабочая
/// область: выключение монитора, смена разрешения, DPI и переезд панели
/// задач меняют подпись, движение курсора — нет.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct MonitorSignature {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: u32,
    pub(crate) height: u32,
    /// Масштаб в тысячных (f64 не бывает Eq/Ord; 1.25 → 1250).
    pub(crate) scale_milli: u32,
    pub(crate) work_x: i32,
    pub(crate) work_y: i32,
    pub(crate) work_width: u32,
    pub(crate) work_height: u32,
}

impl MonitorSignature {
    fn from_monitor(monitor: &Monitor) -> Self {
        let work = monitor.work_area();
        Self {
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
            scale_milli: (monitor.scale_factor() * 1000.0).round() as u32,
            work_x: work.position.x,
            work_y: work.position.y,
            work_width: work.size.width,
            work_height: work.size.height,
        }
    }
}

/// Подпись топологии: мониторы в стабильном порядке (EnumDisplayMonitors
/// порядок не гарантирует, поэтому сортируем).
fn topology(app: &AppHandle) -> Vec<MonitorSignature> {
    let mut list: Vec<MonitorSignature> = app
        .available_monitors()
        .unwrap_or_default()
        .iter()
        .map(MonitorSignature::from_monitor)
        .collect();
    list.sort();
    list
}

/// Применённый раскладкой якорь. `from_cursor` участвует: переход
/// «резервный → курсор» требует перестановки даже при совпадающем
/// прямоугольнике (снять флаг ожидания #588).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct AnchorSignature {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: i32,
    pub(crate) height: i32,
    pub(crate) scale_milli: u32,
    pub(crate) from_cursor: bool,
}

impl AnchorSignature {
    pub(crate) fn of(anchor: &Anchor) -> Self {
        Self {
            x: anchor.x,
            y: anchor.y,
            width: anchor.width,
            height: anchor.height,
            scale_milli: (anchor.scale * 1000.0).round() as u32,
            from_cursor: anchor.from_cursor,
        }
    }
}

/// Нужно ли переставлять попапы на этом тике. Чистая функция — юнит-тесты.
pub(crate) fn should_reanchor(
    topology_changed: bool,
    applied: Option<&AnchorSignature>,
    current: &AnchorSignature,
) -> bool {
    let Some(applied) = applied else {
        // Стек не пуст, а раскладка ещё не записана — выравниваем немедленно.
        return true;
    };
    let pending_cursor = !applied.from_cursor && current.from_cursor;
    (topology_changed || pending_cursor) && applied != current
}

#[derive(Default)]
struct TickerState {
    /// Последний применённый раскладкой якорь; `None` — стек пуст.
    applied: Option<AnchorSignature>,
    /// Топология на момент последней раскладки/проверки.
    topology: Option<Vec<MonitorSignature>>,
}

static STATE: Mutex<TickerState> = Mutex::new(TickerState {
    applied: None,
    topology: None,
});

fn state() -> std::sync::MutexGuard<'static, TickerState> {
    STATE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Запомнить фактически применённую раскладку: якорь и топологию дисплеев.
/// Вызывается раскладчиком (`layout::reposition_all`) после применения позиций.
pub(crate) fn note_layout(app: &AppHandle, anchor: &Anchor) {
    {
        let mut st = state();
        st.applied = Some(AnchorSignature::of(anchor));
        st.topology = Some(topology(app));
    }
    ensure_ticker(app);
}

/// Тикер один на процесс: запускается с первой раскладки и живёт до выхода.
/// Пока стек пуст — спит, ничего не опрашивая тяжёлого.
fn ensure_ticker(app: &AppHandle) {
    static STARTED: Once = Once::new();
    STARTED.call_once(|| {
        let app = app.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(REANCHOR_TICK_MS));
            tick(&app);
        });
    });
}

fn tick(app: &AppHandle) {
    let stack_empty = stack(app).active.is_empty();
    if stack_empty {
        let mut st = state();
        st.applied = None;
        return;
    }
    let current_topology = topology(app);
    let (applied, topology_changed) = {
        let st = state();
        (
            st.applied.clone(),
            st.topology.as_ref() != Some(&current_topology),
        )
    };
    let Some(anchor) = resolve_anchor(app) else {
        return;
    };
    let current = AnchorSignature::of(&anchor);
    if should_reanchor(topology_changed, applied.as_ref(), &current) {
        // Раскладчик сам запишет новую топологию (note_layout).
        crate::layout::reposition_all(app);
        return;
    }
    // Перестановка не нужна — фиксируем топологию, иначе следующий тик снова
    // увидит «изменение» (например, пришло то же самое разрешение).
    state().topology = Some(current_topology);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sig(x: i32, y: i32, w: u32, h: u32, scale_milli: u32) -> MonitorSignature {
        MonitorSignature {
            x,
            y,
            width: w,
            height: h,
            scale_milli,
            work_x: x,
            work_y: y,
            work_width: w,
            work_height: h,
        }
    }

    fn anchor(x: i32, y: i32, width: i32, height: i32, scale: f64, from_cursor: bool) -> Anchor {
        Anchor {
            x,
            y,
            width,
            height,
            scale,
            from_cursor,
        }
    }

    #[test]
    fn порядок_мониторов_не_считается_сменой_топологии() {
        let mut first = vec![sig(0, 0, 3440, 1440, 1000), sig(-1920, 0, 1920, 1080, 1000)];
        let mut second = vec![sig(-1920, 0, 1920, 1080, 1000), sig(0, 0, 3440, 1440, 1000)];
        first.sort();
        second.sort();
        assert_eq!(first, second);
    }

    #[test]
    fn выключение_монитора_меняет_топологию() {
        let before = vec![sig(0, 0, 3440, 1440, 1000)];
        let after = vec![sig(0, 0, 1280, 720, 1000)];
        assert_ne!(before, after);
    }

    #[test]
    fn смена_рабочей_области_меняет_топологию() {
        // Панель задач переехала: monitor size тот же, work area другой.
        let mut before = sig(0, 0, 1920, 1080, 1000);
        before.work_height = 1040;
        let mut after = before.clone();
        after.work_height = 1080;
        assert_ne!(before, after);
    }

    #[test]
    fn смена_якоря_при_сменившейся_топологии_переставляет() {
        let applied = AnchorSignature::of(&anchor(0, 0, 3440, 1400, 1.25, true));
        let current = AnchorSignature::of(&anchor(0, 0, 1280, 672, 1.25, true));
        assert!(should_reanchor(true, Some(&applied), &current));
    }

    #[test]
    fn неизменная_топология_и_якорь_не_дёргают_попапы() {
        let applied = AnchorSignature::of(&anchor(0, 0, 3440, 1400, 1.25, true));
        let same = AnchorSignature::of(&anchor(0, 0, 3440, 1400, 1.25, true));
        assert!(!should_reanchor(false, Some(&applied), &same));
    }

    #[test]
    fn движение_курсора_между_мониторами_без_смены_топологии_не_переставляет() {
        let applied = AnchorSignature::of(&anchor(0, 0, 3440, 1400, 1.25, true));
        let other_monitor = AnchorSignature::of(&anchor(-1920, 0, 1920, 1040, 1.0, true));
        assert!(!should_reanchor(false, Some(&applied), &other_monitor));
    }

    #[test]
    fn возврат_input_desktop_переставляет_на_монитор_курсора() {
        let applied = AnchorSignature::of(&anchor(0, 0, 1280, 672, 1.0, false));
        let current = AnchorSignature::of(&anchor(0, 0, 1280, 672, 1.0, true));
        assert!(should_reanchor(false, Some(&applied), &current));
    }

    #[test]
    fn смена_топологии_без_смены_якоря_возвращает_ложь_но_топология_фиксируется_тиком() {
        let applied = AnchorSignature::of(&anchor(0, 0, 3440, 1400, 1.25, true));
        let same = AnchorSignature::of(&anchor(0, 0, 3440, 1400, 1.25, true));
        assert!(!should_reanchor(true, Some(&applied), &same));
    }

    #[test]
    fn без_применённого_якоря_тик_выравнивает_стек() {
        let current = AnchorSignature::of(&anchor(0, 0, 1920, 1040, 1.0, true));
        assert!(should_reanchor(false, None, &current));
    }
}
