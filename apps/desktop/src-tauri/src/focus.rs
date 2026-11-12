//! Клавиатурный фокус попапов — второй слой (#709).
//!
//! Первый слой закрыт неактивируемостью: `.focusable(false)` даёт
//! `WS_EX_NOACTIVATE`, и tao держит бит сам. Но `WS_EX_NOACTIVATE` запрещает
//! только ПОЛЬЗОВАТЕЛЬСКУЮ активацию (клик, `ShowWindow`): программно окно
//! активируется (`SetActiveWindow`/`SetForegroundWindow`, Raymond Chen
//! «My window has WS_EX_NOACTIVATE, but it got activated anyway», 19.09.2024),
//! а `SetFocus` по документации MS «activates either the window that receives
//! the focus or the parent of the window that receives the focus».
//!
//! WebView2 живёт в отдельном процессе (`msedgewebview2.exe`): его
//! `Chrome_WidgetWin_1` — кросс-процессный ребёнок контейнера попапа, и фокус
//! он забирает сам — при создании контроллера и первом кадре (WebView2Feedback
//! #2487 «parent window can no longer get keyboard input after WebView2 is
//! created»; winit #4345 «webview child pulls focus … parent remains
//! foreground»; unoplatform/uno #23481 «spurious Deactivated raised when the
//! WebView2 renderer HWND gains focus»). Итог: попап становится активным окном
//! ПОТОКА, главное окно получает `WM_ACTIVATE(WA_INACTIVE)`, главный webview
//! слепнет по фокусу — каретка мёртвая, клавиши уходят в попап.
//!
//! Почему это не видел #709: `GetForegroundWindow()` при этом может остаться
//! ГЛАВНЫМ окном (`SetActiveWindow` меняет активное окно потока, не глобальный
//! foreground), а проверка была одна и в момент `show()`. Правда о клавиатуре
//! живёт в `GetGUIThreadInfo().hwndFocus`.
//!
//! Ремонт — `SetFocus(главное окно)`: `tao::set_focus()` бесполезен, он no-op,
//! когда окно уже foreground (tao-0.37.1 `window.rs:139-150`), а wry на
//! `WM_SETFOCUS` родителя сам зовёт `MoveFocus(PROGRAMMATIC)` в главный webview
//! (`wry-0.57.0/src/webview2/mod.rs:1325-1328`; сабкласс ставится при
//! `!is_child`, т.е. в дефолтной сборке Tauri без фичи `unstable`) — Chromium
//! возвращает каретку в поле, которое не теряло DOM-фокус.
//!
//! `SetFocus` вызывается ТОЛЬКО с главного потока: «the window must be attached
//! to the calling thread's message queue» — с фонового потока вернётся ошибка
//! (та же ловушка, что у проверки ex-style в `show_without_activation`, #709).

use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;
use windows::Win32::UI::WindowsAndMessaging::{
    GetAncestor, GetClassNameW, GetForegroundWindow, GetGUIThreadInfo, GetWindowThreadProcessId,
    SetForegroundWindow, GA_ROOT, GUITHREADINFO,
};

use crate::activity;
use crate::popups;

/// Возвратов фокуса на попап в пределах окна: защита от гонки. Наивный
/// app-side ремонт фокуса в tauri#15624 давал петли 140–200 Гц — при
/// превышении лимита возврат прекращается с `error` в лог (сигнал: нужен
/// другой механизм, а не «ещё раз SetFocus»).
const MAX_RECLAIMS: u32 = 8;
const RECLAIM_WINDOW_MS: u64 = 3_000;
/// Сторож после создания/показа: 40 мс × 50 = 2 с. Кража фокуса приходит
/// асинхронно (создание контроллера WebView2, первый composite, навигация
/// мини-UI), поэтому одной проверки в момент `show()` недостаточно — именно
/// на этом и провалился #709.
const GUARD_TICK_MS: u64 = 40;
const GUARD_TICKS: u32 = 50;

static RECLAIM_COUNT: AtomicU32 = AtomicU32::new(0);
static RECLAIM_START_MS: AtomicU64 = AtomicU64::new(0);
static LIMIT_LOGGED: AtomicBool = AtomicBool::new(false);

/// Снимок фокуса потока главного окна. `focus_root` — top-level предок окна с
/// клавиатурой (`GetAncestor(GA_ROOT)`), т.е. «чей это попап/портал».
#[derive(Debug, Clone)]
pub(crate) struct FocusSnapshot {
    pub(crate) foreground: isize,
    pub(crate) active: isize,
    pub(crate) focus: isize,
    pub(crate) focus_root: isize,
    pub(crate) focus_class: String,
}

impl FocusSnapshot {
    /// Строка для лога. Диагностика обязательна: три прошлых захода не
    /// оставили ни одной записи о фокусе, и разбор снова был бы догадкой.
    pub(crate) fn log_line(&self) -> String {
        format!(
            "fg=0x{:x} active=0x{:x} focus=0x{:x} ({}) root=0x{:x}",
            self.foreground, self.active, self.focus, self.focus_class, self.focus_root
        )
    }
}

fn hwnd(value: isize) -> HWND {
    HWND(value as *mut std::ffi::c_void)
}

fn class_name(value: isize) -> String {
    if value == 0 {
        return String::new();
    }
    let mut buf = [0u16; 64];
    let len = unsafe { GetClassNameW(hwnd(value), &mut buf) };
    if len <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buf[..len as usize])
}

/// Снимок клавиатурного фокуса потока, которому принадлежит `main`.
pub(crate) fn snapshot(main: isize) -> Option<FocusSnapshot> {
    if main == 0 {
        return None;
    }
    let thread = unsafe { GetWindowThreadProcessId(hwnd(main), None) };
    if thread == 0 {
        return None;
    }
    let mut info = GUITHREADINFO {
        cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
        ..Default::default()
    };
    unsafe { GetGUIThreadInfo(thread, &mut info) }.ok()?;
    let focus = info.hwndFocus.0 as isize;
    let focus_root = if focus == 0 {
        0
    } else {
        unsafe { GetAncestor(info.hwndFocus, GA_ROOT) }.0 as isize
    };
    Some(FocusSnapshot {
        foreground: unsafe { GetForegroundWindow() }.0 as isize,
        active: info.hwndActive.0 as isize,
        focus,
        focus_root,
        focus_class: class_name(focus),
    })
}

/// Нужно ли вернуть клавиатуру в портал. Чистая функция — вся политика
/// здесь, ОС трогает только вызывающий код (юнит-тесты без окон).
///
/// - пользователь ушёл в другое приложение (foreground не наш) — не трогаем;
/// - foreground наш, но фокус в портале — всё в порядке;
/// - фокус в попапе — возвращаем, если это не поле ответа (там печатают);
/// - фокус «потерялся» (0) при нашем foreground — возвращаем: уничтожение
///   окна с webview-ребёнком часто оставляет очередь вообще без фокуса
///   (winit #4345 — иначе каретка умирает уже после закрытия попапа).
///
/// «Нашим» считаем и foreground-попап: кража фокуса может как оставить
/// главное окно foreground (меняется активное окно ПОТОКА), так и увести
/// foreground в попап — чинить надо оба исхода, иначе фикс снова окажется
/// пустым при другом порядке активации.
pub(crate) fn should_reclaim(
    foreground: isize,
    focus_root: isize,
    main: isize,
    popups: &[(isize, bool)],
) -> bool {
    if foreground == 0 || focus_root == main {
        return false;
    }
    let ours = foreground == main || popups.iter().any(|(popup, _)| *popup == foreground);
    if !ours {
        return false;
    }
    match popups.iter().find(|(popup, _)| *popup == focus_root) {
        Some((_, replying)) => !*replying,
        None => focus_root == 0,
    }
}

fn allow_reclaim() -> bool {
    let now = activity::monotonic_ms();
    let start = RECLAIM_START_MS.load(Ordering::Relaxed);
    if start == 0 || now.saturating_sub(start) > RECLAIM_WINDOW_MS {
        RECLAIM_START_MS.store(now.max(1), Ordering::Relaxed);
        RECLAIM_COUNT.store(0, Ordering::Relaxed);
        LIMIT_LOGGED.store(false, Ordering::Relaxed);
    }
    let count = RECLAIM_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
    if count <= MAX_RECLAIMS {
        return true;
    }
    if !LIMIT_LOGGED.swap(true, Ordering::Relaxed) {
        log::error!(
            "фокус попапа: больше {MAX_RECLAIMS} возвратов за {RECLAIM_WINDOW_MS} мс — \
             возврат приостановлен (гонка фокуса, #709)"
        );
    }
    false
}

/// Вернуть клавиатуру в главный webview. ТОЛЬКО с главного потока.
pub(crate) fn focus_main_now(app: &AppHandle) -> bool {
    let Some(main) = app.get_webview_window("main") else {
        return false;
    };
    if !main.is_visible().unwrap_or(false) || main.is_minimized().unwrap_or(false) {
        return false;
    }
    let Ok(handle) = main.hwnd() else {
        return false;
    };
    // Foreground мог уйти в попап: возвращаем и окно (наш процесс и так
    // foreground-процесс, ограничение SetForegroundWindow не мешает); когда
    // главное окно уже foreground — вызов no-op.
    unsafe {
        let _ = SetForegroundWindow(HWND(handle.0));
    }
    match unsafe { SetFocus(Some(HWND(handle.0))) } {
        Ok(_) => true,
        Err(e) => {
            log::error!("фокус не вернулся в портал: SetFocus ошибка {e}");
            false
        }
    }
}

/// Вернуть клавиатуру в портал (маршалит на главный поток).
pub(crate) fn focus_main(app: &AppHandle) {
    let app = app.clone();
    if let Err(e) = app.clone().run_on_main_thread(move || {
        focus_main_now(&app);
    }) {
        log::warn!("возврат фокуса не поставлен в очередь: {e}");
    }
}

/// Проверка и, если надо, возврат фокуса. ТОЛЬКО с главного потока.
pub(crate) fn reclaim_now(app: &AppHandle, reason: &'static str) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let Ok(handle) = main.hwnd() else {
        return;
    };
    let main_hwnd = handle.0 as isize;
    let Some(snap) = snapshot(main_hwnd) else {
        return;
    };
    let targets = popups::focus_targets(app);
    if !should_reclaim(snap.foreground, snap.focus_root, main_hwnd, &targets) {
        return;
    }
    if !allow_reclaim() {
        return;
    }
    let Ok(target) = main.hwnd() else {
        return;
    };
    match unsafe { SetFocus(Some(HWND(target.0))) } {
        Ok(_) => log::warn!(
            "фокус ушёл из портала: {} → возвращён в портал ({reason})",
            snap.log_line()
        ),
        Err(e) => log::error!(
            "фокус ушёл из портала: {} — SetFocus не удался: {e} ({reason})",
            snap.log_line()
        ),
    }
}

/// Проверка фокуса с фонового потока (сторож, события создания окон).
pub(crate) fn reclaim(app: &AppHandle, reason: &'static str) {
    let app = app.clone();
    if let Err(e) = app.clone().run_on_main_thread(move || {
        reclaim_now(&app, reason);
    }) {
        log::warn!("проверка фокуса не поставлена в очередь: {e}");
    }
}

/// Сторож на 2 с после создания/показа попапа: кража фокуса асинхронная
/// (контроллер WebView2, первый кадр, навигация мини-UI) — одной проверки
/// в момент `show()` не хватает (#709).
pub(crate) fn arm_guard(app: &AppHandle, reason: &'static str) {
    let app = app.clone();
    let spawned = std::thread::Builder::new()
        .name("focus-guard".into())
        .spawn(move || {
            for _ in 0..GUARD_TICKS {
                std::thread::sleep(Duration::from_millis(GUARD_TICK_MS));
                reclaim(&app, reason);
            }
        });
    if let Err(e) = spawned {
        log::warn!("сторож фокуса не запущен: {e}");
    }
}

/// Одна строка на показ попапа: отрицательное доказательство («фокус был в
/// портале») нужно не меньше положительного — без него следующий разбор
/// снова останется догадкой. ТОЛЬКО с главного потока.
pub(crate) fn log_snapshot(app: &AppHandle, label: &str, stage: &str) {
    let Some(main) = app.get_webview_window("main") else {
        return;
    };
    let Ok(handle) = main.hwnd() else {
        return;
    };
    if let Some(snap) = snapshot(handle.0 as isize) {
        log::info!(
            "{label} ({stage}): main=0x{:x} {}",
            handle.0 as isize,
            snap.log_line()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAIN: isize = 0x100;
    const POPUP: isize = 0x200;
    const REPLYING: isize = 0x300;
    const FOREIGN: isize = 0x400;

    fn popups() -> Vec<(isize, bool)> {
        vec![(POPUP, false), (REPLYING, true)]
    }

    /// Политика возврата фокуса (#709): трогаем только СВОИ окна (портал или
    /// попап), только попап без режима ответа; чужое приложение не задеваем.
    #[test]
    fn возврат_только_из_своего_попапа_без_ответа() {
        // Фокус в попапе, foreground — портал: возвращаем.
        assert!(should_reclaim(MAIN, POPUP, MAIN, &popups()));
        // Фокус в попапе и foreground увели в попап: тоже возвращаем.
        assert!(should_reclaim(POPUP, POPUP, MAIN, &popups()));
        // Фокус в поле ответа — там печатают, не мешаем.
        assert!(!should_reclaim(MAIN, REPLYING, MAIN, &popups()));
        assert!(!should_reclaim(REPLYING, REPLYING, MAIN, &popups()));
        // Фокус в портале — всё в порядке.
        assert!(!should_reclaim(MAIN, MAIN, MAIN, &popups()));
        // Пользователь в другом приложении — не трогаем.
        assert!(!should_reclaim(FOREIGN, FOREIGN, MAIN, &popups()));
        // Нет foreground (локскрин/смена сессии) — не трогаем.
        assert!(!should_reclaim(0, 0, MAIN, &popups()));
        // Фокус «потерялся» при нашем foreground — возвращаем (winit #4345).
        assert!(should_reclaim(MAIN, 0, MAIN, &popups()));
        assert!(should_reclaim(POPUP, 0, MAIN, &popups()));
        // Фокус в чужом окне при нашем foreground — окно не наше, не трогаем.
        assert!(!should_reclaim(MAIN, FOREIGN, MAIN, &popups()));
        // Нет живых попапов — возврат только для потерянного фокуса.
        assert!(!should_reclaim(MAIN, POPUP, MAIN, &[]));
        assert!(should_reclaim(MAIN, 0, MAIN, &[]));
    }

    /// Лимит возвратов: защита от петли фокуса (tauri#15624 — наивный ремонт
    /// давал 140–200 Гц). После MAX_RECLAIMS в окне — отказ до истечения окна.
    #[test]
    fn лимит_возвратов_защищает_от_петли() {
        // Окно начинается с первым вызовом: сбрасываем состояние теста.
        RECLAIM_START_MS.store(0, Ordering::Relaxed);
        RECLAIM_COUNT.store(0, Ordering::Relaxed);
        LIMIT_LOGGED.store(false, Ordering::Relaxed);
        for _ in 0..MAX_RECLAIMS {
            assert!(allow_reclaim(), "в пределах лимита возврат разрешён");
        }
        assert!(!allow_reclaim(), "сверх лимита — приостановка");
        assert!(!allow_reclaim(), "приостановка держится до конца окна");
    }
}
