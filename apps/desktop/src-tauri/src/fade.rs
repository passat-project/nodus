//! Арбитраж угасания попапов (фидбек владельца 08.10, модель Telegram
//! Desktop `checkLastInput`): решает КОГДА гасить, плавность делает CSS
//! в окне попапа (`window.__popupFade('start'|'reset')`).
//!
//! Правила (вердикт владельца 23–24.11.2026, #998): пользователь неактивен
//! (нет кликов/клавиш — `activity`) — попапы не угасают никогда; первое
//! нажатие после появления запускает паузу (~1 с, попап полностью яркий),
//! затем медленное угасание (~3 с); повторные нажатия отсчёт не продлевают;
//! курсор на попапе или открытое поле ответа ставят паузу и после ухода
//! дают свежий отсчёт. Тикер общий на процесс.
//!
//! Здесь — тикер, конфиг и сигналы мини-UI; чистое правило состояния —
//! `fade_policy.rs` (unit-тесты без окна и WebView2).
//!
//! Длительности — конфиг процесса: значения читаются из env один раз
//! (`NODUS_POPUP_FADE_DELAY_MS`, `NODUS_POPUP_FADE_MS`) и валидируются —
//! это позволяет подбирать темп живой пробой без пересборки. `fadeMs`
//! уходит в payload мини-UI, чтобы CSS-переход и таймер закрытия совпадали
//! (две независимые константы разъезжались бы — рывок в конце).

use std::sync::OnceLock;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::activity;
use crate::bridge::PopupPayload;
use crate::fade_policy::FadeStep;
use crate::layout::reposition_all;
use crate::popups::{show, stack, MAX_STACK};

/// Пауза после первого нажатия (вердикт владельца 24.11.2026: 1 секунда —
/// 2 секунды оказались много). Попап стоит полностью ярким — сотрудник
/// успевает прочитать.
pub(crate) const DEFAULT_FADE_DELAY_MS: u64 = 1_000;
/// Полное угасание с начала таяния (~3 c, медленно).
pub(crate) const DEFAULT_FADE_MS: u64 = 3_000;
/// Границы локальной настройки: защита от мусора/бесконечного висяка.
const FADE_DELAY_MAX_MS: u64 = 30_000;
const FADE_MIN_MS: u64 = 200;
const FADE_MAX_MS: u64 = 15_000;
/// Период тикера (плавность стартует CSS-transition, тикер — арбитр).
const TICK_MS: u64 = 120;

/// Мс из env с валидацией: не число/вне границ — дефолт и предупреждение
/// (значение видно в журнале оболочки — диагностика, #811).
fn env_ms(name: &str, default: u64, min: u64, max: u64) -> u64 {
    let Ok(raw) = std::env::var(name) else {
        return default;
    };
    match raw.trim().parse::<u64>() {
        Ok(value) => value.clamp(min, max),
        Err(_) => {
            log::warn!("{name}={raw:?} — не число, беру {default} мс");
            default
        }
    }
}

/// Пауза перед угасанием (мс). Читается один раз на процесс: смена значения —
/// перезапуск оболочки (для живой пробы это дешевле пересборки).
pub(crate) fn fade_delay_ms() -> u64 {
    static VALUE: OnceLock<u64> = OnceLock::new();
    *VALUE.get_or_init(|| {
        let value = env_ms(
            "NODUS_POPUP_FADE_DELAY_MS",
            DEFAULT_FADE_DELAY_MS,
            0,
            FADE_DELAY_MAX_MS,
        );
        log::info!("попапы: пауза перед угасанием {value} мс");
        value
    })
}

/// Длительность перехода угасания (мс). Единый источник для Rust-таймера
/// закрытия и CSS мини-UI (payload `fadeMs`).
pub(crate) fn fade_ms() -> u64 {
    static VALUE: OnceLock<u64> = OnceLock::new();
    *VALUE.get_or_init(|| {
        let value = env_ms(
            "NODUS_POPUP_FADE_MS",
            DEFAULT_FADE_MS,
            FADE_MIN_MS,
            FADE_MAX_MS,
        );
        log::info!("попапы: длительность угасания {value} мс");
        value
    })
}

/// Срочные не гаснут по таймеру (#867). Карточку скачивания здесь не
/// выделяем: её полоса/поведение — #992, в этой ветке не меняются.
pub(crate) fn fadable(urgent: bool) -> bool {
    !urgent
}

/// Запустить общий тикер угасания (один на процесс; первый попап стартует).
pub fn spawn_fade_ticker(app: &AppHandle) {
    static STARTED: std::sync::Once = std::sync::Once::new();
    STARTED.call_once(|| {
        let app = app.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(Duration::from_millis(TICK_MS));
            tick_fade(&app);
        });
    });
}

/// JS-сигнал в окно попапа (fade старт/сброс): мост portal-bridge в
/// popup-окна не инъектируется — слушает сам popup-UI.
fn eval_popup_js(app: &AppHandle, label: &str, js: &str) {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.eval(js);
    }
}

/// Арбитр угасания: по глобальной активности (клик/клавиша) и состоянию
/// попапа (hover/печать) решает, CSS в окне делает плавность.
fn tick_fade(app: &AppHandle) {
    let mut to_close: Vec<String> = Vec::new();
    let mut queued: Option<PopupPayload> = None;
    let now = activity::monotonic_ms();
    let last_input = activity::last_input_ms();
    let delay = fade_delay_ms();
    let fade = fade_ms();
    {
        let mut s = stack(app);
        for p in s.active.iter_mut() {
            if !fadable(p.urgent) {
                continue;
            }
            match p
                .fade
                .step(now, last_input, delay, fade, p.hover || p.replying)
            {
                FadeStep::Hold => {}
                FadeStep::Start => {
                    let waited = p
                        .fade
                        .wait_started_ms()
                        .map(|started| now.saturating_sub(started))
                        .unwrap_or_else(|| now.saturating_sub(last_input));
                    log::info!(
                        "попап {}: пауза {} мс после ввода — начало угасания",
                        p.label,
                        waited
                    );
                    eval_popup_js(
                        app,
                        &p.label,
                        "window.__popupFade&&window.__popupFade('start')",
                    );
                }
                FadeStep::Reset => {
                    eval_popup_js(
                        app,
                        &p.label,
                        "window.__popupFade&&window.__popupFade('reset')",
                    );
                }
                FadeStep::Close => to_close.push(p.label.clone()),
            }
        }
        s.active.retain(|p| !to_close.contains(&p.label));
        if s.active.len() < usize::try_from(MAX_STACK).unwrap_or(3) {
            queued = s.pending.pop_front();
        }
    }
    let had_closes = !to_close.is_empty();
    for label in to_close {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.close();
        }
    }
    if let Some(payload) = queued {
        show(app, payload);
    } else if had_closes {
        reposition_all(app);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn срочные_не_гаснут() {
        assert!(fadable(false));
        assert!(!fadable(true));
    }
}
