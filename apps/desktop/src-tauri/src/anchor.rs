//! Якорь раскладки попапов (#588): монитор, в рабочую область которого
//! встаёт стек. Курсор — идеальный якорь (пользователь работает на этом
//! мониторе), но `GetCursorPos` отказывает вне input desktop — сессия
//! заблокирована, экран входа, смена пользователя, RDP (Microsoft Learn:
//! «The input desktop must be the current desktop»). Раньше это был
//! молчаливый `return` раскладчика, и окна оставались на системном каскаде
//! `CW_USEDEFAULT` в левом верхнем углу; теперь резерв — монитор главного
//! окна → первичный монитор (эти API input desktop не требуют).
//!
//! Переякоривание (возврат input desktop, смена конфигурации дисплеев) живёт
//! в `reanchor.rs`: там же подпись топологии и тикер.

use tauri::{AppHandle, Manager, Monitor};

use crate::popups::{MARGIN, POPUP_H, POPUP_W};

/// Опорная площадка раскладки: рабочая область монитора (физические px).
pub(crate) struct Anchor {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: i32,
    pub(crate) height: i32,
    pub(crate) scale: f64,
    /// Якорь найден по курсору — пользователь работает на этом мониторе.
    pub(crate) from_cursor: bool,
}

impl Anchor {
    fn from_monitor(monitor: &Monitor, from_cursor: bool) -> Self {
        let wa = monitor.work_area();
        Self {
            x: wa.position.x,
            y: wa.position.y,
            width: wa.size.width as i32,
            height: wa.size.height as i32,
            scale: monitor.scale_factor(),
            from_cursor,
        }
    }

    pub(crate) fn px(&self, value: f64) -> i32 {
        (value * self.scale).round() as i32
    }

    /// Левый край попапа: правый край рабочей области минус ширина и отступ.
    pub(crate) fn right(&self) -> i32 {
        self.x + self.width - self.px(POPUP_W) - self.px(MARGIN)
    }

    /// Низ столбика — над панелью задач.
    pub(crate) fn bottom(&self) -> i32 {
        self.y + self.height - self.px(MARGIN)
    }
}

/// Монитор для раскладки: курсор → главное окно → первичный монитор.
/// Input desktop нужен только курсору; монитор окна и первичный монитор
/// доступны всегда — попапы не остаются на системном каскаде, даже если
/// уведомление пришло на заблокированную сессию (#588).
pub(crate) fn resolve_anchor(app: &AppHandle) -> Option<Anchor> {
    if let Ok(position) = app.cursor_position() {
        if let Ok(Some(monitor)) = app.monitor_from_point(position.x, position.y) {
            return Some(Anchor::from_monitor(&monitor, true));
        }
    }
    if let Some(main) = app.get_webview_window("main") {
        if let Ok(Some(monitor)) = main.current_monitor() {
            return Some(Anchor::from_monitor(&monitor, false));
        }
    }
    app.primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| Anchor::from_monitor(&monitor, false))
}

/// Позиция НОВОГО попапа (логические px) для билдера окна: он всегда самый
/// нижний в столбике (новейший у пола), высота — стартовая POPUP_H. Окно
/// рождается сразу в правом нижнем углу — системный каскад `CW_USEDEFAULT`
/// (лесенка от левого верхнего угла) не показывается даже при неудачной
/// раскладке (#588). Фактический якорь фиксирует раскладчик
/// (`reanchor::note_layout`).
pub(crate) fn initial_position(app: &AppHandle) -> Option<(f64, f64)> {
    let anchor = resolve_anchor(app)?;
    let x = anchor.right();
    let y = anchor.bottom() - anchor.px(POPUP_H);
    Some((f64::from(x) / anchor.scale, f64::from(y) / anchor.scale))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn anchor(x: i32, y: i32, width: i32, height: i32, scale: f64) -> Anchor {
        Anchor {
            x,
            y,
            width,
            height,
            scale,
            from_cursor: true,
        }
    }

    #[test]
    fn якорь_прижимает_попап_к_правому_нижнему_углу() {
        let anchor = anchor(0, 0, 1920, 1080, 1.25);
        // 360×1.25 = 450, отступ 14×1.25 ≈ 18: x = 1920 − 450 − 18 = 1452.
        assert_eq!(anchor.right(), 1452);
        // Низ столбика: 1080 − 18 = 1062; попап 88×1.25 = 110 → y = 952.
        assert_eq!(anchor.bottom(), 1062);
        assert_eq!(anchor.bottom() - anchor.px(POPUP_H), 952);
    }

    #[test]
    fn якорь_учитывает_второй_монитор_слева() {
        // Монитор слева от первичного: отрицательные координаты — норма.
        let anchor = anchor(-1920, -200, 1920, 1080, 1.0);
        assert_eq!(anchor.right(), -374);
        assert_eq!(anchor.bottom(), 866);
    }
}
