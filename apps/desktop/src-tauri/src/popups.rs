use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow};

use crate::activity;
use crate::bridge::{self, PopupPayload, PopupReply};

// >500 строк — обоснование (I5): «стек попапов» — одна когерентная
// ответственность (жизненный цикл окна: очередь/вытеснение/ready-gate
// показа, угасание, поле ответа, IPC мини-UI), ~95 строк — inline-тесты;
// разрез на файлы размазал бы мьютекс стека и инварианты once-показа.

/// Геометрия попапа (логические px). Ширина фиксирована дизайном; ВЫСОТА —
/// по факту контента: мини-UI измеряет карточку и сообщает её командой
/// `popup_set_height` (#406). Константы: стартовая высота скрытого окна до
/// измерения и границы валидации (защита от мусора в IPC).
/// Окно прозрачное — скругления несёт карточка; скролл запрещён в UI.
pub(crate) const POPUP_W: f64 = 360.0;
/// Стартовая высота скрытого окна (до `popup_set_height`): окно показывается
/// только после измерения и `popup_ready`, поэтому кадров «обрезано» нет.
pub(crate) const POPUP_H: f64 = 88.0;
pub(crate) const POPUP_MIN_H: f64 = 64.0;
pub(crate) const POPUP_MAX_H: f64 = 400.0;
pub(crate) const HIDE_ALL_H: f64 = 28.0;
pub(crate) const MARGIN: f64 = 14.0;
pub(crate) const GAP: f64 = 5.0;
/// Максимум в столбик (фидбек 08.10, модель Telegram: «не более трёх, каждое
/// следующее заменяет старейшее как очередь»).
pub(crate) const MAX_STACK: u32 = 3;
/// Метка окна «Скрыть все» над стеком (Telegram HideAllButton).
pub(crate) const HIDE_ALL_LABEL: &str = "popup-hide-all";
/// Сколько ждать `popup_ready` от мини-UI попапа до принудительного показа
/// (#305): окно показывается ТОЛЬКО после применения темы и первого кадра
/// (иначе прозрачное непрогретое окно composite-ится чёрным, а гонка каналов
/// темы успевала накинуть тёмные токены в светлой теме портала). Вебваlew
/// не поднялся за таймаут — показываем как есть: потерянное уведомление
/// хуже одного некрасивого кадра.
pub(crate) const READY_FALLBACK_MS: u64 = 1200;

pub(crate) struct ActivePopup {
    pub(crate) label: String,
    pub(crate) slot: u32,
    /// Монотонный номер показа — жёсткий порядок «новейший внизу»
    /// (Instant имеет грубое разрешение на Windows, counter — нет).
    pub(crate) counter: u64,
    /// Ключ гашения источника: conversationId беседы ИЛИ letterId письма
    /// (#618) — портал гасит попапы по открытии источника (Telegram).
    dismiss_key: String,
    pub(crate) created_ms: u64,
    /// Фактическая высота окна (логические px): мини-UI измерил контент и
    /// прислал `popup_set_height`. Стек раскладывается по ЭТИМ высотам —
    /// никаких захардкоженных «88/124», которые разъезжаются с ui-scale.
    pub(crate) height: f64,
    /// Начало текущего угасания (None — полная яркость).
    pub(crate) fading: Option<Instant>,
    /// Курсор на попапе: угасание на паузе, яркость восстановлена.
    pub(crate) hover: bool,
    /// Открыто поле ответа: не гасим (пользователь печатает).
    pub(crate) replying: bool,
    /// Окно показано (popup_ready или fallback): повторный show не нужен.
    pub(crate) shown: bool,
    /// Payload для pull-модели: окно забирает данные само после загрузки
    /// (push-событие проигрывал бы гонку со скоростью монтирования React).
    payload: serde_json::Value,
}

/// Стек попапов: слоты 0..3 от право-низа вверх + очередь переполнения.
/// Поведение (фидбек владельца 08.10, модель Telegram Desktop):
/// - на экране ≤3; новое при полном стеке ЗАКРЫВАЕТ старейший спокойный
///   (hover/поле ответа не трогаем) и занимает его место;
/// - пользователь неактивен (нет кликов/клавиш) — попапы не угасают никогда;
/// - активность (клик/клавиша, НЕ движение мыши) — медленное угасание ~3 c
///   (CSS transition в окне), hover возвращает яркость и держит паузу;
/// - над стеком плашка «Скрыть все».
#[derive(Default)]
pub(crate) struct PopupStack {
    pub(crate) counter: u64,
    pub(crate) active: Vec<ActivePopup>,
    pub(crate) pending: VecDeque<PopupPayload>,
    /// Окно «Скрыть все» живёт (флаг под мьютексом — гонка двух
    /// reposition_all успевала создать ОКНО-ДУБЛЬ, висевшее поверх стека).
    pub(crate) hide_all_live: bool,
    /// Плашка «Скрыть все» показана (ready/fallback) — как shown у попапов.
    pub(crate) hide_all_shown: bool,
}

impl PopupStack {
    fn free_slot(&self) -> Option<u32> {
        (0..MAX_STACK).find(|k| !self.active.iter().any(|p| p.slot == *k))
    }
    /// Старейший попап без hover/поля ответа — кандидат на вытеснение.
    fn eviction_victim(&self) -> Option<String> {
        self.active
            .iter()
            .filter(|p| !p.hover && !p.replying)
            .min_by_key(|p| p.counter)
            .map(|p| p.label.clone())
    }
    /// Первый показ этого label? Помечает показ, true — окно надо показать
    /// (#305): show дергают ровно один раз — popup_ready ИЛИ fallback-таймер,
    /// кто раньше; остальным вызовам отказ (и уже закрытым окнам тоже).
    pub(crate) fn mark_shown(&mut self, label: &str) -> bool {
        if label == HIDE_ALL_LABEL {
            if !self.hide_all_live || self.hide_all_shown {
                return false;
            }
            self.hide_all_shown = true;
            return true;
        }
        match self.active.iter_mut().find(|p| p.label == label) {
            Some(p) if !p.shown => {
                p.shown = true;
                true
            }
            _ => false,
        }
    }
}

/// Payload попапа в JSON для pull-модели: тема прикладывается здесь же —
/// мини-UI применяет её ДО рендера карточки, видимые кадры всегда в теме
/// портала (#305).
fn payload_to_json(payload: &PopupPayload, theme: &str) -> serde_json::Value {
    serde_json::json!({
        "id": payload.id,
        "conversationId": payload.conversation_id,
        "letterId": payload.letter_id,
        "threadRootId": payload.thread_root_id,
        "title": payload.title,
        "avatarUrl": payload.avatar_url,
        "preview": payload.preview,
        "previewAttachment": payload.preview_attachment.unwrap_or(false),
        "urgent": payload.urgent,
        "canReply": payload.can_reply,
        "theme": theme,
    })
}

pub(crate) fn stack(app: &AppHandle) -> std::sync::MutexGuard<'_, PopupStack> {
    app.state::<Mutex<PopupStack>>().inner().lock().unwrap()
}

/// Показать попап. Вызывать ТОЛЬКО из async-команд: на Windows билдер окна
/// в синхронном контексте дедлокит WebView2 (см. bridge::notify_popup).
pub(crate) fn show(app: &AppHandle, payload: crate::bridge::PopupPayload) {
    let payload_json = payload_to_json(&payload, bridge::ui_theme());
    let dismiss_key = payload.dismiss_key().to_string();
    let (label, _slot) = {
        let mut s = stack(app);
        // Полный стек: новое вытесняет старейший спокойный (очередь-сдвиг);
        // сплошь hover/печать — уходим в очередь, докат при закрытии.
        if s.free_slot().is_none() {
            match s.eviction_victim() {
                Some(victim) => {
                    if let Some(w) = app.get_webview_window(&victim) {
                        let _ = w.close();
                    }
                    s.active.retain(|p| p.label != victim);
                }
                None => {
                    s.pending.push_back(payload);
                    log::info!("стек занят активным пользователем — попап в очереди");
                    return;
                }
            }
        }
        let slot = s.free_slot().expect("освободили слот выше");
        s.counter += 1;
        let counter = s.counter;
        let label = format!("popup-{counter}");
        s.active.push(ActivePopup {
            label: label.clone(),
            slot,
            counter,
            dismiss_key,
            created_ms: activity::monotonic_ms(),
            height: POPUP_H,
            fading: None,
            hover: false,
            replying: false,
            shown: false,
            payload: payload_json,
        });
        (label, slot)
    };
    // Окно рождается сразу в правом нижнем углу (позиция билдера) — системный
    // каскад в левом верхнем углу не показывается даже при неудачной
    // раскладке; дальше позицию уточнит reposition_all (кумулятив по стеку).
    // Показ — ТОЛЬКО по готовности (#305): мини-UI применит тему из payload
    // и отрисует карточку, позовёт popup_ready; не успел за таймаут —
    // fallback показывает как есть. Кражу фокуса подавляет WS_EX_NOACTIVATE.
    let position = crate::anchor::initial_position(app);
    let win = build_popup_window(app, &label, POPUP_H, position);
    crate::layout::reposition_all(app);
    if win.is_some() {
        spawn_ready_fallback(app, &label);
    }
    crate::fade::spawn_fade_ticker(app);
}

/// Показать окно, если оно ещё не показано (первый вызов из popup_ready или
/// fallback-таймера выигрывает, остальные — тихий no-op).
pub(crate) fn show_if_ready(app: &AppHandle, label: &str) {
    let should = stack(app).mark_shown(label);
    if !should {
        return;
    }
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.show();
    }
}

/// Страховка ready-gate (#305): мини-UI не поднялся/не позвал popup_ready —
/// показываем окно принудительно, уведомление не теряем.
pub(crate) fn spawn_ready_fallback(app: &AppHandle, label: &str) {
    let app = app.clone();
    let label = label.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(READY_FALLBACK_MS));
        show_if_ready(&app, &label);
    });
}

/// Сигнал готовности от мини-UI попапа/плашки: данные получены, тема
/// применена, первый кадр отрисован — окно можно показывать (#305).
#[tauri::command]
pub fn popup_ready(app: AppHandle, window: WebviewWindow) {
    show_if_ready(&app, window.label());
}

/// Общий билдер popup-окон (карточка + плашка «Скрыть все»). Окно НЕАКТИВИ-
/// РУЕМОЕ (WS_EX_NOACTIVATE, канон Telegram и Raymond Chen / Old New Thing):
/// показ и клики НЕ крадут фокус у портала — супер-курсор композера живёт.
/// Для печати в поле ответа флаг снимается (popup_set_expanded → allow_focus).
/// `position` — логические px правого нижнего угла рабочей области (#588):
/// окно создаётся уже на своём месте, не на системном каскаде.
pub(crate) fn build_popup_window(
    app: &AppHandle,
    label: &str,
    height: f64,
    position: Option<(f64, f64)>,
) -> Option<WebviewWindow> {
    let mut builder = WebviewWindowBuilder::new(app, label, WebviewUrl::App("index.html".into()))
        .title("Nodus")
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .focused(false)
        .inner_size(POPUP_W, height)
        .visible(false)
        // Прозрачное окно: скруглённые углы и тень рисует карточка (CSS).
        .transparent(true)
        .shadow(false)
        .additional_browser_args(crate::WEBVIEW2_BROWSER_ARGS);
    if let Some((x, y)) = position {
        builder = builder.position(x, y);
    }
    let win = match builder.build() {
        Ok(win) => win,
        Err(e) => {
            log::error!("попап не создан: {e}");
            stack(app).active.retain(|p| p.label != label);
            return None;
        }
    };
    set_noactivate(&win, true);
    // Тема попапа = тема ПРИЛОЖЕНИЯ (портал сообщил через set_ui_theme).
    crate::bridge::apply_ui_theme(&win);
    Some(win)
}

/// WS_EX_NOACTIVATE на топ-левел окно попапа (GWL_EXSTYLE).
const WS_EX_NOACTIVATE: isize = 0x0800_0000;

fn set_noactivate(win: &WebviewWindow, on: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE,
    };
    let Ok(hwnd) = win.hwnd() else { return };
    let hwnd = HWND(hwnd.0);
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let next = if on {
            style | WS_EX_NOACTIVATE
        } else {
            style & !WS_EX_NOACTIVATE
        };
        if next != style {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
        }
    }
}

/// Вернуть фокус окну портала: клик по попапу глушит каретку композера
/// (blur документа) — после закрытия попапа руками вернём фокус порталу,
/// супер-курсор поднимется сам.
fn refocus_portal(app: &AppHandle) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    if let Some(main) = app.get_webview_window("main") {
        // Возвращаем фокус ТОЛЬКО если портал сейчас в фокусе системы
        // (пользователь печатал в нём). Перекрытый другим окном / свёрнутый /
        // в трее портал не трогаем: клик по попапу = «пользователь занят»,
        // поднимать окно поверх чужого нельзя (фидбек 08.10). Попап не
        // активируется (WS_EX_NOACTIVATE), поэтому foreground не менялся.
        let Ok(hwnd) = main.hwnd() else { return };
        unsafe {
            if GetForegroundWindow() != HWND(hwnd.0) {
                return;
            }
        }
        let _ = main.set_focus();
    }
}

pub fn on_popup_destroyed(app: &AppHandle, label: &str) {
    let next: Option<PopupPayload> = {
        let mut s = stack(app);
        s.active.retain(|p| p.label != label);
        if s.active.len() < MAX_STACK as usize {
            s.pending.pop_front()
        } else {
            None
        }
    };
    // Хвост (док очереди строит ОКНО, reposition двигает/создаёт капсулу) —
    // ТОЛЬКО из async-контекста: сюда приходит синхронный обработчик
    // WindowEvent::Destroyed (event loop, main thread) — создание окна здесь
    // дедлокит WebView2 (gotcha «Десктоп», docs/gotchas/desktop.md).
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(payload) = next {
            show(&app, payload); // show завершает reposition_all
        } else {
            crate::layout::reposition_all(&app);
        }
    });
}

/// Погасить попапы источника: портал зовёт при открытии беседы ИЛИ письма
/// (#618) — ключ один и тот же (модель Telegram unlinkHistory: открыл
/// источник, его уведомления больше не висят).
pub fn dismiss_for_target(app: &AppHandle, key: &str) {
    let labels: Vec<String> = {
        let mut s = stack(app);
        s.pending.retain(|p| p.dismiss_key() != key);
        s.active
            .iter()
            .filter(|p| p.dismiss_key == key)
            .map(|p| p.label.clone())
            .collect()
    };
    for label in labels {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.close();
        }
    }
}

/// «Скрыть все»: закрыть стек и очередь (бейджи не трогаем — их ведёт портал).
#[tauri::command]
pub fn popup_close_all(app: AppHandle) {
    let labels: Vec<String> = {
        let mut s = stack(&app);
        s.pending.clear();
        s.hide_all_live = false;
        s.hide_all_shown = false;
        s.active.iter().map(|p| p.label.clone()).collect()
    };
    for label in labels {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.close();
        }
    }
    if let Some(w) = app.get_webview_window(HIDE_ALL_LABEL) {
        let _ = w.close();
    }
    refocus_portal(&app);
}

/// Курсор на попапе (mouseenter/leave из UI): пауза угасания + возврат
/// яркости; уход курсора возобновляет угасание с нуля (~3 c заново).
#[tauri::command]
pub fn popup_set_hover(app: AppHandle, window: WebviewWindow, hover: bool) {
    let label = window.label().to_string();
    let mut s = stack(&app);
    if let Some(p) = s.active.iter_mut().find(|p| p.label == label) {
        p.hover = hover;
        if !hover {
            p.fading = None; // ушли курсором — таймер заново с полной яркости
        }
    }
}

/// Payload попапа — pull-моделью после загрузки окна (без гонки со маунтом).
/// Плашке «Скрыть все» данных не надо — отдаём только тему (#305).
#[tauri::command]
pub fn popup_get_data(app: AppHandle, window: WebviewWindow) -> Option<serde_json::Value> {
    let label = window.label();
    if label == HIDE_ALL_LABEL {
        return Some(serde_json::json!({ "theme": bridge::ui_theme() }));
    }
    stack(&app)
        .active
        .iter()
        .find(|p| p.label == label)
        .map(|p| p.payload.clone())
}

/// Закрыть попап — вызывает само окно (крестик/Esc/после действия).
/// Клики по попапу глушат каретку портала (blur) — возвращаем фокус.
#[tauri::command]
pub fn popup_close(app: AppHandle, window: WebviewWindow) {
    let _ = window.close();
    refocus_portal(&app);
}

/// Фактическая высота окна от мини-UI (#406): карточка измерила контент
/// (заголовок+превью+поле ответа) и прислала ВЕРХНЮЮ границу окна в
/// логических px. Высота хранится на попапе, стек раскладывается по ней —
/// рост поля ответа поднимает верхние попапы кумулятивно, без «дыр».
/// Валидация на границе IPC: конечное число в разумных пределах.
#[tauri::command]
pub fn popup_set_height(app: AppHandle, window: WebviewWindow, height: f64) -> Result<(), String> {
    if !height.is_finite() || !(POPUP_MIN_H..=POPUP_MAX_H).contains(&height) {
        return Err("invalid_payload".into());
    }
    let label = window.label().to_string();
    let changed = {
        let mut s = stack(&app);
        match s.active.iter_mut().find(|p| p.label == label) {
            Some(p) => {
                let next = height.clamp(POPUP_MIN_H, POPUP_MAX_H);
                let changed = (p.height - next).abs() > 0.25;
                p.height = next;
                changed
            }
            None => false,
        }
    };
    if changed {
        crate::layout::reposition_all(&app);
    }
    Ok(())
}

/// Режим ответа: пауза угасания и фокус окна (печать требует активности).
/// Высоту окна задаёт НЕ эта команда, а `popup_set_height` по измерению
/// мини-UI: константы «88/124» разъезжались с реальным ui-scale (#406).
/// Открыли поле — снимаем NOACTIVATE и даём фокус; закрытие — обратно.
#[tauri::command]
pub fn popup_set_expanded(app: AppHandle, window: WebviewWindow, expanded: bool) {
    let label = window.label().to_string();
    {
        let mut s = stack(&app);
        if let Some(p) = s.active.iter_mut().find(|p| p.label == label) {
            p.replying = expanded;
        }
    }
    set_noactivate(&window, !expanded);
    if expanded {
        let _ = window.set_focus();
    }
    crate::layout::reposition_all(&app);
}

#[tauri::command]
pub fn popup_submit_reply(
    app: AppHandle,
    window: WebviewWindow,
    payload: PopupReply,
) -> Result<(), String> {
    // Граница контракта на Rust-стороне (security-аудит #254): попап-UI
    // доверенный, но зеркало обязано валидировать само.
    if payload.text.trim().is_empty()
        || payload.text.chars().count() > 4000
        || payload.id.len() > 200
        || !bridge::is_valid_conversation(&payload.conversation_id)
    {
        return Err("invalid_payload".into());
    }
    bridge::push_to_portal(&app, "popup-reply", &payload);
    let _ = window.close();
    Ok(())
}

#[tauri::command]
pub fn popup_open(
    app: AppHandle,
    window: WebviewWindow,
    conversation_id: Option<String>,
    thread_root_id: Option<String>,
    letter_id: Option<String>,
) -> Result<(), String> {
    // Цель — ровно одна (#618): письмо открывается событием open-letter,
    // беседа — как раньше (трэд — окно трэда, #300).
    let bad_thread = thread_root_id
        .as_deref()
        .is_some_and(|t| !bridge::is_valid_conversation(t));
    let letter = match (conversation_id.as_deref(), letter_id.as_deref()) {
        (Some(c), None) => {
            if !bridge::is_valid_conversation(c) {
                return Err("invalid_payload".into());
            }
            None
        }
        (None, Some(l)) => {
            if !bridge::is_valid_conversation(l) {
                return Err("invalid_payload".into());
            }
            Some(l.to_string())
        }
        // Ни цели, или сразу две — отказ (контракт: ровно одна).
        (None, None) | (Some(_), Some(_)) => return Err("invalid_payload".into()),
    };
    if bad_thread {
        return Err("invalid_payload".into());
    }
    crate::show_main(&app);
    if let Some(letter_id) = letter {
        bridge::push_to_portal(&app, "open-letter", &serde_json::json!({ "letterId": letter_id }));
    } else {
        bridge::push_to_portal(
            &app,
            "open-conversation",
            &serde_json::json!({ "conversationId": conversation_id, "threadRootId": thread_root_id }),
        );
    }
    let _ = window.close();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(id: &str, conversation_id: &str) -> PopupPayload {
        PopupPayload {
            id: id.into(),
            conversation_id: Some(conversation_id.into()),
            letter_id: None,
            thread_root_id: None,
            title: "Автор".into(),
            avatar_url: None,
            preview: "текст".into(),
            preview_attachment: None,
            urgent: false,
            can_reply: true,
        }
    }

    /** Попап письма (#618): цель — letterId, ключ гашения — он же. */
    fn letter_payload(id: &str, letter_id: &str) -> PopupPayload {
        PopupPayload {
            conversation_id: None,
            letter_id: Some(letter_id.into()),
            can_reply: false,
            ..payload(id, "unused")
        }
    }

    fn occupy(s: &mut PopupStack, n: u32) {
        for k in 0..n {
            let slot = s.free_slot().expect("свободный слот");
            s.counter += 1;
            s.active.push(ActivePopup {
                label: format!("popup-{k}"),
                slot,
                counter: k as u64,
                dismiss_key: format!("conv-{k}"),
                created_ms: 0,
                height: POPUP_H,
                fading: None,
                hover: false,
                replying: false,
                shown: false,
                payload: serde_json::Value::Null,
            });
        }
    }

    #[test]
    fn полное_меньше_трёх() {
        let mut s = PopupStack::default();
        occupy(&mut s, 2);
        assert!(s.free_slot().is_some());
        occupy(&mut s, 1);
        assert!(s.free_slot().is_none(), "максимум 3 в столбик");
    }

    #[test]
    fn вытеснение_берёт_старейший_спокойный() {
        let mut s = PopupStack::default();
        occupy(&mut s, 3);
        // Первый — под печать, второй — под курсором: жертва третий.
        s.active[0].replying = true;
        s.active[1].hover = true;
        assert_eq!(s.eviction_victim().as_deref(), Some("popup-2"));
        // Все заняты пользователем — жертв нет.
        s.active[2].hover = true;
        assert!(s.eviction_victim().is_none());
    }

    #[test]
    fn очередь_и_dismiss() {
        let mut s = PopupStack::default();
        s.pending.push_back(payload("m1", "conv-1"));
        s.pending.push_back(payload("m2", "conv-2"));
        s.pending.retain(|p| p.dismiss_key() != "conv-1");
        assert_eq!(s.pending.pop_front().map(|p| p.id), Some("m2".into()));
    }

    /** Письмо (#618): ключ гашения попапов — letterId, чат не задет. */
    #[test]
    fn письмо_гасится_своим_ключом() {
        let mut s = PopupStack::default();
        s.pending.push_back(letter_payload("l1", "letter-9"));
        s.pending.push_back(payload("m1", "conv-1"));
        // Открытие письма гасит только попапы письма, чат остаётся.
        s.pending.retain(|p| p.dismiss_key() != "letter-9");
        assert_eq!(s.pending.pop_front().map(|p| p.id), Some("m1".into()));
    }

    #[test]
    fn показ_ровно_один_раз() {
        let mut s = PopupStack::default();
        occupy(&mut s, 1);
        // Первый сигнал (ready или fallback — кто раньше) показывает.
        assert!(s.mark_shown("popup-0"));
        assert!(!s.mark_shown("popup-0"), "повторный show — no-op");
        // Закрытого попапа нет в стеке — показывать нечего.
        assert!(!s.mark_shown("popup-9"));
    }

    #[test]
    fn плашка_скрыть_все_показ_один_раз() {
        let mut s = PopupStack::default();
        // Плашки нет — сигнал тихий (окно ещё не создано/уже закрыто).
        assert!(!s.mark_shown(HIDE_ALL_LABEL));
        s.hide_all_live = true;
        assert!(s.mark_shown(HIDE_ALL_LABEL));
        assert!(!s.mark_shown(HIDE_ALL_LABEL));
    }

    #[test]
    fn payload_несёт_тему() {
        let json = payload_to_json(&payload("m1", "conv-1"), "light");
        assert_eq!(json["theme"], "light");
        assert_eq!(json["conversationId"], "conv-1");
        assert!(json["letterId"].is_null());
    }

    #[test]
    fn payload_письма_несёт_цель() {
        let json = payload_to_json(&letter_payload("l1", "letter-9"), "dark");
        assert_eq!(json["letterId"], "letter-9");
        assert!(json["conversationId"].is_null());
        assert_eq!(json["canReply"], false);
    }
}
