//! Арбитраж угасания попапов (фидбек владельца 08.10, модель Telegram
//! Desktop `checkLastInput`): решает КОГДА гасить, плавность делает CSS
//! в окне попапа (`window.__popupFade('start'|'reset')`).
//!
//! Правила: пользователь неактивен (нет кликов/клавиш — `activity`) — попапы
//! не угасают никогда; активность пришла — медленное угасание ~3 c; курсор
//! на попапе или открытое поле ответа ставят угасание на паузу и возвращают
//! яркость; уход курсора перезапускает таймер. Тикер общий на процесс.

use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::activity;
use crate::bridge::PopupPayload;
use crate::layout::reposition_all;
use crate::popups::{show, stack, MAX_STACK};

/// Полное угасание с момента активности пользователя (~3 c, медленно).
const FADE_MS: u64 = 3000;
/// Период тикера (плавность стартует CSS-transition, тикер — арбитр).
const TICK_MS: u64 = 120;

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
    {
        let mut s = stack(app);
        let last_input = activity::last_input_ms();
        for p in s.active.iter_mut() {
            if p.hover || p.replying {
                if p.fading.take().is_some() {
                    eval_popup_js(
                        app,
                        &p.label,
                        "window.__popupFade&&window.__popupFade('reset')",
                    );
                }
                continue;
            }
            // Неактивен (нет кликов/клавиш после показа) — не угасаем никогда;
            // активность пришла — медленное угасание с этого тика (~3 c).
            if last_input < p.created_ms {
                if p.fading.take().is_some() {
                    eval_popup_js(
                        app,
                        &p.label,
                        "window.__popupFade&&window.__popupFade('reset')",
                    );
                }
                continue;
            }
            match p.fading {
                None => {
                    p.fading = Some(std::time::Instant::now());
                    eval_popup_js(
                        app,
                        &p.label,
                        "window.__popupFade&&window.__popupFade('start')",
                    );
                }
                Some(t) if t.elapsed() >= Duration::from_millis(FADE_MS) => {
                    to_close.push(p.label.clone());
                }
                Some(_) => {}
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
