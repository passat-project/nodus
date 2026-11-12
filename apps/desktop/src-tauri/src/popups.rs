use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowLongPtrW, IsWindow, SetForegroundWindow, SetWindowLongPtrW,
    GWL_EXSTYLE,
};

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
    /// Абсолютный путь скачанного файла (#647) — ТОЛЬКО в Rust: мини-UI его
    /// не получает, «Показать в папке» берёт путь отсюда по метке окна.
    pub(crate) download_path: Option<String>,
    /// Кто был системным foreground перед активацией окна в режиме ответа
    /// (HWND, #709): после Esc/закрытия фокус возвращается туда — «забрали у
    /// Word, вернули Word», а не оставили клавиатуру в неактивируемом окне.
    pub(crate) activated_from: Option<isize>,
    /// HWND окна попапа (0 — ещё не создано). Нужен гварду клавиатурного
    /// фокуса: `GetGUIThreadInfo().hwndFocus` сравнивается с top-level предком
    /// окна, держащего клавиатуру (`focus.rs`, #709).
    pub(crate) hwnd: isize,
    /// Payload для pull-модели: окно забирает данные само после загрузки
    /// (push-событие проигрывало бы гонку со скоростью монтирования React).
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
    /// HWND плашки (0 — окна нет): гвард фокуса (#709) учитывает и её.
    pub(crate) hide_all_hwnd: isize,
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
        // Путь файла НЕ отдаём: мини-UI знает только имя и факт успеха (#647).
        "download": payload.download.as_ref().map(|d| serde_json::json!({
            "fileName": d.file_name,
            "success": d.success,
        })),
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
    let download_path = payload.download.as_ref().and_then(|d| d.path.clone());
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
            download_path,
            activated_from: None,
            hwnd: 0,
            payload: payload_json,
        });
        (label, slot)
    };
    // Окно рождается сразу в правом нижнем углу (позиция билдера) — системный
    // каскад в левом верхнем углу не показывается даже при неудачной
    // раскладке; дальше позицию уточнит reposition_all (кумулятив по стеку).
    // Показ — ТОЛЬКО по готовности (#305): мини-UI применит тему из payload
    // и отрисует карточку, позовёт popup_ready; не успел за таймаут —
    // fallback показывает как есть. Клавиатуру у портала отбирает webview-
    // ребёнок попапа — возвращает гвард `focus.rs` (#709, второй слой).
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
        show_without_activation(&win, label);
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

/// Общий билдер popup-окон (карточка + плашка «Скрыть все»). Окно
/// НЕАКТИВИРУЕМОЕ: неактивируемость держит tao — `.focusable(false)` кладёт
/// `WS_EX_NOACTIVATE` в ex-style и сохраняет его при каждой перезаписи стиля
/// (#709). Ручной бит после билда НЕ работает: `win.show()` → `apply_diff`
/// стирает его (tao-0.37.1 `window_state.rs:412-431`). Стиль закрывает только
/// ПОЛЬЗОВАТЕЛЬСКУЮ активацию: webview-ребёнок попапа всё равно забирает
/// клавиатуру программно, поэтому каждый показ проверяет и чинит `focus.rs`.
/// Для печати в поле ответа окно временно делается фокусируемым
/// (`popup_set_expanded` → `set_focusable`).
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
        // Неактивируемое окно: tao сам держит WS_EX_NOACTIVATE (ex-style
        // пересобирается из WindowFlags при каждом apply_diff, #709).
        .focusable(false)
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
    // Тема попапа = тема ПРИЛОЖЕНИЯ (портал сообщил через set_ui_theme).
    crate::bridge::apply_ui_theme(&win);
    // HWND — гварду фокуса (#709): создание контроллера WebView2 и первый кадр
    // мини-UI — известные моменты, когда кросс-процессный `Chrome_WidgetWin_1`
    // забирает клавиатуру у главного окна. Регистрируем окно в стеке ДО
    // проверки, иначе гвард не узнает «свой» попап.
    if let Ok(handle) = win.hwnd() {
        let mut s = stack(app);
        if label == HIDE_ALL_LABEL {
            s.hide_all_hwnd = handle.0 as isize;
        } else if let Some(p) = s.active.iter_mut().find(|p| p.label == label) {
            p.hwnd = handle.0 as isize;
        }
    }
    crate::focus::reclaim(app, "создание попапа");
    crate::focus::arm_guard(app, "сторож после создания");
    Some(win)
}

/// WS_EX_NOACTIVATE на топ-левел окно попапа (GWL_EXSTYLE).
const WS_EX_NOACTIVATE: isize = 0x0800_0000;

/// Есть ли в ex-style окна `WS_EX_NOACTIVATE` (`None` — окно недоступно).
fn has_noactivate(win: &WebviewWindow) -> Option<bool> {
    let hwnd = win.hwnd().ok()?;
    let style = unsafe { GetWindowLongPtrW(HWND(hwnd.0), GWL_EXSTYLE) };
    Some(style & WS_EX_NOACTIVATE != 0)
}

/// Аварийный ремонт ex-style: ручной бит живёт только до следующего
/// `apply_diff` (tao пересобирает стиль целиком) — применяется лишь если
/// `show_without_activation` обнаружил потерю флага (#709).
fn set_noactivate(win: &WebviewWindow, on: bool) {
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

fn hwnd_of(win: &WebviewWindow) -> Option<isize> {
    win.hwnd().ok().map(|hwnd| hwnd.0 as isize)
}

fn foreground_hwnd() -> isize {
    unsafe { GetForegroundWindow().0 as isize }
}

fn is_window(hwnd: isize) -> bool {
    unsafe { IsWindow(Some(HWND(hwnd as *mut std::ffi::c_void))).as_bool() }
}

/// Показать попап, НЕ забирая системный фокус — и не отдавая клавиатуру его
/// webview-ребёнку.
///
/// Слой 1 — неактивируемость: `.focusable(false)` в билдере, tao держит
/// `WS_EX_NOACTIVATE` в ex-style сам (tao-0.37.1 `window_state.rs:293-295`).
/// Проверка ниже — страховка от регрессии tao: без бита `ShowWindow(SW_SHOW)`
/// (`window_state.rs:459-466`) снова активирует topmost-окно поверх чужой
/// программы и «убивает» каретку пользователя (#709).
///
/// Слой 2 — клавиатурный фокус: `WS_EX_NOACTIVATE` запрещает только
/// пользовательскую активацию, а кросс-процессный `Chrome_WidgetWin_1` от
/// WebView2 забирает фокус программно и делает попап активным окном ПОТОКА
/// (`GetForegroundWindow()` при этом остаётся главным). Проверка и ремонт —
/// `focus::reclaim_now`; сторож добирает позднюю кражу (`focus::arm_guard`).
///
/// Показ и проверки — ТОЛЬКО на главном потоке (`run_on_main_thread`): с
/// фонового потока `win.show()` лишь постит сообщение в event loop и
/// возвращается (проверка ex-style читала бы старый стиль), а `SetFocus`
/// с чужого потока вообще не работает («the window must be attached to the
/// calling thread's message queue»).
pub(crate) fn show_without_activation(win: &WebviewWindow, label: &str) {
    let win = win.clone();
    let app = win.app_handle().clone();
    let label = label.to_string();
    let _ = app.run_on_main_thread(move || {
        let Ok(hwnd) = win.hwnd() else { return };
        let popup = HWND(hwnd.0);
        let previous = unsafe { GetForegroundWindow() };
        let _ = win.show();
        // Потеря ex-style — аварийный ремонт; клавиатурный слой проверяем
        // ВСЕГДА, а не только по этой ветке (прошлый #709 выходил здесь).
        if has_noactivate(&win) == Some(false) {
            log::error!("попап: WS_EX_NOACTIVATE потерян после show() — аварийный ремонт");
            set_noactivate(&win, true);
            // Окно всё же стало foreground — вернуть фокус прежнему владельцу.
            if unsafe { GetForegroundWindow() } == popup && !previous.0.is_null() {
                unsafe {
                    let _ = SetForegroundWindow(previous);
                }
            }
        }
        crate::focus::log_snapshot(win.app_handle(), &label, "показ");
        // `previous` — foreground ДО показа: единственный достоверный ответ на
        // «откуда украли клавиатуру» (поле ответа или портал), иначе возврат
        // выдернул бы каретку не оттуда.
        crate::focus::reclaim_now(win.app_handle(), "показ попапа", Some(previous.0 as isize));
    });
    crate::focus::arm_guard(&app, "сторож после показа");
}

/// Куда вернуть фокус после сворачивания/закрытия попапа. Возврат — ТОЛЬКО
/// когда foreground сейчас наше попап-окно: если пользователь уже ушёл в
/// другое приложение, его фокус не трогаем.
/// Приоритет: прежний владелец (его мы и обделили) → главное окно, если видимо.
fn restore_target(
    foreground: isize,
    popup: isize,
    previous: Option<isize>,
    main: isize,
    main_visible: bool,
) -> Option<isize> {
    if foreground == 0 || foreground != popup {
        return None;
    }
    if let Some(previous) = previous {
        if previous != 0 && previous != popup {
            return Some(previous);
        }
    }
    if main_visible && main != 0 {
        return Some(main);
    }
    None
}

/// Вернуть фокус из активированного попапа (режим ответа): `previous` —
/// `activated_from`, снятый при раскрытии поля ответа.
fn restore_focus(app: &AppHandle, win: &WebviewWindow, previous: Option<isize>) {
    let Some(popup) = hwnd_of(win) else { return };
    let (main, main_visible) = match app.get_webview_window("main") {
        Some(main) => (
            hwnd_of(&main).unwrap_or(0),
            main.is_visible().unwrap_or(false),
        ),
        None => (0, false),
    };
    let previous = previous.filter(|hwnd| is_window(*hwnd));
    let Some(target) = restore_target(foreground_hwnd(), popup, previous, main, main_visible)
    else {
        return;
    };
    if target == main {
        // Главное окно уже foreground: `SetForegroundWindow` для него — no-op
        // (как и tao `set_focus()`, window.rs:139-150), поэтому клавиатура
        // оставалась бы нигде. SetFocus возвращает её в главный webview
        // (wry сам зовёт MoveFocus на WM_SETFOCUS) — #709, второй слой.
        unsafe {
            let _ = SetForegroundWindow(HWND(target as *mut std::ffi::c_void));
        }
        crate::focus::focus_main(app);
    } else {
        unsafe {
            let _ = SetForegroundWindow(HWND(target as *mut std::ffi::c_void));
        }
    }
}

/// Живые попапы для гварда клавиатурного фокуса (#709): (HWND, режим ответа).
/// Только чтение стека — вызывается и с фонового потока сторожа.
pub(crate) fn focus_targets(app: &AppHandle) -> Vec<(isize, bool)> {
    let s = stack(app);
    let mut targets: Vec<(isize, bool)> = s
        .active
        .iter()
        .filter(|p| p.hwnd != 0)
        .map(|p| (p.hwnd, p.replying))
        .collect();
    if s.hide_all_live && s.hide_all_hwnd != 0 {
        targets.push((s.hide_all_hwnd, false));
    }
    targets
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
        // Уничтожение окна с webview-ребёнком часто оставляет очередь ввода
        // вообще без фокуса (`focus = 0`), хотя foreground остался порталом —
        // каретка умирает уже после закрытия попапа (winit #4345, #709).
        crate::focus::reclaim(&app, "закрытие попапа");
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
    // Режим ответа держал фокус в одном из попапов: вернуть его ДО close() —
    // после уничтожения окна прежний владелец уже неизвестен (#709).
    let foreground = foreground_hwnd();
    for label in &labels {
        let Some(win) = app.get_webview_window(label) else {
            continue;
        };
        if hwnd_of(&win) == Some(foreground) {
            let previous = stack(&app)
                .active
                .iter()
                .find(|p| p.label == *label)
                .and_then(|p| p.activated_from);
            restore_focus(&app, &win, previous);
            break;
        }
    }
    for label in labels {
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.close();
        }
    }
    if let Some(w) = app.get_webview_window(HIDE_ALL_LABEL) {
        let _ = w.close();
    }
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
/// Если окно было активировано режимом ответа, фокус возвращается прежнему
/// владельцу ДО close(): после уничтожения окна это уже не определить.
#[tauri::command]
pub fn popup_close(app: AppHandle, window: WebviewWindow) {
    let previous = stack(&app)
        .active
        .iter()
        .find(|p| p.label == window.label())
        .and_then(|p| p.activated_from);
    restore_focus(&app, &window, previous);
    let _ = window.close();
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
/// Открыли поле — `set_focusable(true)` + фокус; закрытие — обратно
/// `set_focusable(false)` и возврат фокуса прежнему foreground-окну (#709).
#[tauri::command]
pub fn popup_set_expanded(app: AppHandle, window: WebviewWindow, expanded: bool) {
    let label = window.label().to_string();
    let previous = {
        let mut s = stack(&app);
        match s.active.iter_mut().find(|p| p.label == label) {
            Some(p) => {
                p.replying = expanded;
                if expanded {
                    // Запоминаем, у кого забираем фокус (клик по неактивируемому
                    // попапу foreground не меняет — это чужая программа/портал).
                    // Повторный expand уже активированного окна владельца не
                    // перезаписывает: foreground там — сам попап.
                    let foreground = foreground_hwnd();
                    let popup = hwnd_of(&window).unwrap_or(0);
                    if foreground != 0 && foreground != popup {
                        p.activated_from = Some(foreground);
                    }
                }
                p.activated_from
            }
            None => None,
        }
    };
    // `focusable` — единственный механизм, который tao удерживает сам:
    // ручной WS_EX_NOACTIVATE стирается apply_diff при show()/смене флагов.
    let _ = window.set_focusable(expanded);
    if expanded {
        let _ = window.set_focus();
    } else {
        restore_focus(&app, &window, previous);
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
    // Ответ отправлен — окно закрывается; фокус возвращаем ДО close().
    let previous = stack(&app)
        .active
        .iter()
        .find(|p| p.label == window.label())
        .and_then(|p| p.activated_from);
    restore_focus(&app, &window, previous);
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
        bridge::push_to_portal(
            &app,
            "open-letter",
            &serde_json::json!({ "letterId": letter_id }),
        );
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
            download: None,
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
                download_path: None,
                activated_from: None,
                hwnd: 0,
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

    /** Возврат фокуса (#709): трогаем только наш попап, приоритет — прежний
     *  владелец; main — лишь резерв, когда прежнего владельца уже нет. */
    #[test]
    fn фокус_возвращается_только_из_нашего_попапа() {
        // Чужое окно в фокусе — не трогаем (пользователь уже переключился).
        assert_eq!(restore_target(500, 100, Some(400), 200, true), None);
        // Наш попап был foreground: возвращаем прежнего владельца (чужое окно).
        assert_eq!(restore_target(100, 100, Some(400), 200, true), Some(400));
        // Прежний владелец неизвестен — главное окно, если видимо.
        assert_eq!(restore_target(100, 100, None, 200, true), Some(200));
        assert_eq!(restore_target(100, 100, None, 200, false), None);
        // previous == popup — мусор, не «возвращаем в себя».
        assert_eq!(restore_target(100, 100, Some(100), 200, true), Some(200));
        // Нет foreground (локскрин/смена сессии) — ничего.
        assert_eq!(restore_target(0, 100, Some(400), 200, true), None);
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

    /** Скачивание (#647): мини-UI получает имя и успех, но НЕ путь — инвариант
     *  «путь только в Rust» держится и маппингом, и `skip_serializing`. */
    fn download_payload() -> PopupPayload {
        PopupPayload {
            id: "download-1".into(),
            conversation_id: None,
            letter_id: None,
            thread_root_id: None,
            title: "Смета.xlsx".into(),
            avatar_url: None,
            preview: String::new(),
            preview_attachment: None,
            urgent: false,
            can_reply: false,
            download: Some(crate::bridge::PopupDownload {
                file_name: "Смета.xlsx".into(),
                success: true,
                path: Some(r"C:\Users\user\Downloads\Смета.xlsx".into()),
            }),
        }
    }

    #[test]
    fn payload_скачивания_не_отдаёт_путь() {
        let payload = download_payload();
        let json = payload_to_json(&payload, "light");
        assert_eq!(json["download"]["fileName"], "Смета.xlsx");
        assert_eq!(json["download"]["success"], true);
        assert!(
            json["download"].get("path").is_none(),
            "путь не уходит в мини-UI"
        );
        // Полная serde-сериализация тоже не несёт путь (skip_serializing).
        let full = serde_json::to_value(&payload).expect("payload сериализуется");
        assert!(
            full["download"].get("path").is_none(),
            "path помечен skip_serializing"
        );
    }
}
