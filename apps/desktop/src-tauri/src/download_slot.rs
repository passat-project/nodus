//! Верхний слот системных карточек — «Файл скачан» / «Не удалось скачать»
//! (эпик #1038, раздел 4): ОДИН слот над панелью главного окна, не часть
//! личного стека попапов. Серия схлопывается в счётчик: 5 файлов подряд —
//! одна карточка «Скачано: 5» с именем и путём ПОСЛЕДНЕГО файла; таймер
//! автоскрытия (8 с) перезапускается на каждом новом файле серии; неуспех
//! показывает короткую ошибку и начинает новую серию.
//!
//! Видимость (#1038, решение владельца 25.11): карточка живёт только пока
//! окно Nodus активно — пользователь в Word ничего не видит, карточка ждёт
//! и показывается при возврате фокуса (показанное окно на паузе угасания).
//! Личные попапы не затронуты: живут всегда, «Скрыть все» гасит только их,
//! слот не участвует в MAX_STACK и не вытесняется.
//!
//! Размещение: карточка прилипает к нижней кромке панели безрамочного окна
//! (ADR-0055) с минимальным зазором, правый край выровнен с ЛЕВОЙ кромкой
//! правой группы кнопок панели; слот следует за окном (Moved/Resized
//! главного окна — tao отдаёт их, в отличие от смены топологии дисплеев,
//! поэтому reanchor-тикер тут не нужен). Максимизировано окно — якорь тот
//! же от окна.

use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetWindowThreadProcessId, SetWindowPos, SWP_ASYNCWINDOWPOS,
    SWP_NOACTIVATE, SWP_NOZORDER,
};

use crate::activity;
use crate::bridge;
use crate::popups::{
    build_popup_window, show_without_activation, POPUP_H, POPUP_MAX_H, POPUP_MIN_H, POPUP_W,
    READY_FALLBACK_MS,
};

/// Метка окна слота скачивания. Начинается с `popup-` — мини-UI рендерит его
/// тем же `PopupView` (карточка с `download` в payload).
pub(crate) const SLOT_LABEL: &str = "popup-download";

/// Высота строки панели безрамочного окна (логические px) — зеркало контракта
/// `SHELL_PANEL_HEIGHT` (packages/contracts/src/desktop/desktop-bridge.schema.ts,
/// ADR-0055): слот прилипает к НИЖНЕЙ кромке панели.
pub(crate) const SHELL_PANEL_HEIGHT: f64 = 40.0;

/// Ширина правой группы кнопок окна в панели (логические px): свернуть/
/// развернуть/закрыть = 3 × 46 (web-панель фазы B2, shell-panel.tsx). Правый
/// край карточки выровнен с ЛЕВОЙ кромкой группы — «по линии интерфейса», не
/// с краём монитора (#1038).
pub(crate) const PANEL_BUTTONS_W: f64 = 138.0;

/// Минимальный зазор между панелью и карточкой (#1038).
pub(crate) const PANEL_GAP: f64 = 6.0;

/// Автоскрытие карточки скачивания (#647): перезапускается на каждом новом
/// файле серии (#1038). Уходит в payload (`autoHideMs`) — константа одна на
/// оба конца (как `fadeMs` у угасания, #998).
pub(crate) const DOWNLOAD_AUTO_HIDE_MS: u64 = 8000;

/// Серия загрузок одного показа карточки: подряд успешные суммируются,
/// неуспех и успех после неуспеха начинают новую серию с 1.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DownloadSeries {
    /// Подряд успешных загрузок (для «Скачано: N»).
    pub(crate) count: u32,
    /// Результат последней загрузки: false — карточка короткой ошибки.
    pub(crate) success: bool,
    /// Имя ПОСЛЕДНЕГО файла серии (превью карточки).
    pub(crate) file_name: String,
    /// Абсолютный путь ПОСЛЕДНЕГО файла — только в Rust (#647): мини-UI его
    /// не получает, `popup_reveal_download` берёт путь отсюда.
    pub(crate) path: Option<String>,
    /// Монотонное время последнего шага серии: якорь автоскрытия — мини-UI
    /// перезапускает свои 8 с от каждого нового файла (payload меняется,
    /// чистая логика — юнит-тест).
    pub(crate) updated_at_ms: u64,
}

/// Шаг серии (#1038): подряд успешные суммируются (счётчик + имя/путь
/// последнего); неуспех показывает короткую ошибку и начинает новую серию —
/// успех после неуспеха тоже стартует с 1. Чистая функция — юнит-тесты.
pub(crate) fn series_step(
    prev: Option<&DownloadSeries>,
    file_name: String,
    path: Option<String>,
    success: bool,
    now_ms: u64,
) -> DownloadSeries {
    let count = match prev {
        Some(s) if s.success && success => s.count.saturating_add(1),
        _ => 1,
    };
    DownloadSeries {
        count,
        success,
        file_name,
        path,
        updated_at_ms: now_ms,
    }
}

/// Хотим ли показывать слот прямо сейчас (#1038): системная карточка видна
/// ТОЛЬКО при активном окне Nodus — иначе скрыта и ждёт возврата фокуса.
/// Чистая функция — юнит-тесты.
pub(crate) fn want_visible(has_series: bool, webview_ready: bool, nodus_active: bool) -> bool {
    has_series && webview_ready && nodus_active
}

/// Физические координаты левого верхнего угла карточки от геометрии main:
/// верх — панель + зазор, правый край — левая кромка группы кнопок.
/// Чистая функция — юнит-тесты (в т.ч. максимизированное окно с рамкой −8).
pub(crate) fn slot_origin(win_x: i32, win_y: i32, win_w: i32, scale: f64) -> (i32, i32) {
    let px = |v: f64| (v * scale).round() as i32;
    let right = win_x + win_w - px(PANEL_BUTTONS_W);
    (
        right - px(POPUP_W),
        win_y + px(SHELL_PANEL_HEIGHT) + px(PANEL_GAP),
    )
}

/// Живое состояние слота. Мьютекс-статика (как reanchor): команды и события
/// приходят с разных потоков, лок не держится через вызовы окон.
struct SlotState {
    series: Option<DownloadSeries>,
    /// Окно слота существует (скрыто или показано).
    window_live: bool,
    /// `popup_ready` пришёл (или fallback): показывать можно.
    ready: bool,
    /// Окно сейчас видимо.
    shown: bool,
    /// Фактическая высота карточки от мини-UI (#406).
    height: f64,
    /// HWND слота — гварду клавиатурного фокуса (#709).
    hwnd: isize,
    /// Последняя применённая геометрия (физические px): Moved приходит
    /// сериями с той же геометрией — без дедупа дёргаем SetWindowPos зря.
    placed: Option<(i32, i32, i32, i32)>,
}

const fn fresh_state() -> SlotState {
    SlotState {
        series: None,
        window_live: false,
        ready: false,
        shown: false,
        height: POPUP_H,
        hwnd: 0,
        placed: None,
    }
}

static SLOT: Mutex<SlotState> = Mutex::new(fresh_state());

fn state() -> std::sync::MutexGuard<'static, SlotState> {
    SLOT.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Метка — окно слота скачивания (маршрутизация команд в popups.rs).
pub(crate) fn is_slot(label: &str) -> bool {
    label == SLOT_LABEL
}

/// Nodus активен: foreground-окно принадлежит нашему процессу — главное окно
/// или попап в режиме ответа (человек всё ещё «в Nodus», карточку показываем).
/// Истина — живой Win32-запрос; события фокуса лишь повод пересчитать.
fn nodus_active() -> bool {
    let foreground = unsafe { GetForegroundWindow() };
    if foreground.0.is_null() {
        return false;
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(foreground, Some(&mut pid)) };
    pid == std::process::id()
}

/// Payload слота для pull-модели мини-UI (`popup_get_data`): тема прикладывается
/// здесь же (#305), счётчик серии — в `download.count`; путь не уходит (#647).
pub(crate) fn payload() -> Option<serde_json::Value> {
    state().series.as_ref().map(series_payload)
}

fn series_payload(series: &DownloadSeries) -> serde_json::Value {
    serde_json::json!({
        "id": "download-series",
        "download": {
            "fileName": series.file_name,
            "success": series.success,
            "count": series.count,
        },
        "autoHideMs": DOWNLOAD_AUTO_HIDE_MS,
        "theme": bridge::ui_theme(),
    })
}

/// Путь последнего файла серии — для `popup_reveal_download` (только Rust).
pub(crate) fn last_path() -> Option<String> {
    state()
        .series
        .as_ref()
        .and_then(|series| series.path.clone())
}

/// HWND слота — гвард фокуса (#709): webview-ребёнок слота тоже может украсть
/// клавиатуру, гвард обязан узнавать окно как своё.
pub(crate) fn slot_hwnd() -> Option<isize> {
    let st = state();
    (st.window_live && st.hwnd != 0).then_some(st.hwnd)
}

/// Завершилась загрузка (#647, #1038): шаг серии, обновление живой карточки,
/// создание окна первой серии. Вызывать ТОЛЬКО из async-контекста — билдер
/// окна в синхронном обработчике дедлокит WebView2 (gotcha «Десктоп»).
pub(crate) fn on_finished(app: &AppHandle, file_name: &str, path: Option<String>, success: bool) {
    let now = activity::monotonic_ms();
    let need_window = {
        let mut st = state();
        let series = series_step(
            st.series.as_ref(),
            file_name.to_string(),
            path,
            success,
            now,
        );
        log::info!(
            "download-slot: серия count={} success={}",
            series.count,
            series.success
        );
        st.series = Some(series);
        !st.window_live
    };
    if need_window {
        create_window(app);
    }
    // Живая карточка перечитывает данные (pull): счётчик/имя/перезапуск 8 с.
    // Вебвью ещё не поднялся — eval тихо теряется: первую порцию данных
    // карточка заберёт сама после загрузки.
    if let Some(win) = app.get_webview_window(SLOT_LABEL) {
        let _ = win.eval("window.__popupRefresh&&window.__popupRefresh()");
    }
    reposition(app);
    sync_visibility(app, "новая загрузка");
}

/// Создать скрытое окно слота — сразу на своём месте (не на системном
/// каскаде), показ — только по готовности и фокусу (см. ready/sync).
fn create_window(app: &AppHandle) {
    let position = main_geometry(app).map(|(x, y, w, scale)| {
        let (px_x, px_y) = slot_origin(x, y, w, scale);
        (f64::from(px_x) / scale, f64::from(px_y) / scale)
    });
    let height = state().height;
    match build_popup_window(app, SLOT_LABEL, height, position) {
        Some(win) => {
            {
                let mut st = state();
                st.window_live = true;
                if let Ok(handle) = win.hwnd() {
                    st.hwnd = handle.0 as isize;
                }
            }
            log::info!("download-slot: окно создано (показ по готовности и фокусу)");
            // Страховка ready-gate (#305): вебвью не поднялся — считать
            // готовым принудительно, уведомление важнее кадра.
            let app = app.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(READY_FALLBACK_MS));
                if state().window_live {
                    ready(&app);
                }
            });
        }
        None => {
            // Серия остаётся: следующая загрузка повторит попытку создания.
            log::error!("download-slot: окно НЕ создано — карточка не показана");
        }
    }
}

/// Мини-UI слота прогрет (тема применена, первый кадр, #305): показать можно —
/// но только при активном окне Nodus (гейтинг #1038).
pub(crate) fn ready(app: &AppHandle) {
    {
        let mut st = state();
        if st.ready {
            return; // повторный ready (fallback после живого) — no-op
        }
        st.ready = true;
    }
    sync_visibility(app, "popup_ready");
}

/// Фактическая высота карточки от мини-UI (#406): слот растёт ВНИЗ от панели,
/// верх фиксирован — меняется только размер окна.
pub(crate) fn set_height(app: &AppHandle, height: f64) {
    {
        let mut st = state();
        st.height = height.clamp(POPUP_MIN_H, POPUP_MAX_H);
    }
    reposition(app);
}

/// Геометрия главного окна (физические px + масштаб) — якорь слота.
fn main_geometry(app: &AppHandle) -> Option<(i32, i32, i32, f64)> {
    let main = app.get_webview_window("main")?;
    let position = main.outer_position().ok()?;
    let size = main.outer_size().ok()?;
    let scale = main.scale_factor().ok()?;
    Some((position.x, position.y, size.width as i32, scale))
}

/// Переставить слот по текущей геометрии главного окна — «колонка следует за
/// окном» (#1038): Moved/Resized главного окна, рост карточки. Позиция и
/// размер — одним `SetWindowPos`, без активации (как раскладчик личного стека).
pub(crate) fn reposition(app: &AppHandle) {
    let Some((win_x, win_y, win_w, scale)) = main_geometry(app) else {
        return;
    };
    let height = {
        let st = state();
        if !st.window_live {
            return;
        }
        st.height
    };
    let (x, y) = slot_origin(win_x, win_y, win_w, scale);
    let width = (POPUP_W * scale).round() as i32;
    let height = (height.clamp(POPUP_MIN_H, POPUP_MAX_H) * scale).round() as i32;
    {
        let mut st = state();
        if st.placed == Some((x, y, width, height)) {
            return;
        }
        st.placed = Some((x, y, width, height));
    }
    if let Some(win) = app.get_webview_window(SLOT_LABEL) {
        set_window_pos(&win, x, y, width, height);
    }
}

/// Атомарная перестановка окна (та же семантика, что у раскладчика стека):
/// `SWP_ASYNCWINDOWPOS` — вызов возможен не с потока окна; без смены z-порядка
/// и без активации.
fn set_window_pos(win: &tauri::WebviewWindow, x: i32, y: i32, width: i32, height: i32) {
    let Ok(hwnd) = win.hwnd() else {
        return;
    };
    unsafe {
        let _ = SetWindowPos(
            HWND(hwnd.0),
            None,
            x,
            y,
            width,
            height,
            SWP_ASYNCWINDOWPOS | SWP_NOZORDER | SWP_NOACTIVATE,
        );
    }
}

/// Решить показ/скрытие слота (#1038): показывается только при активном окне
/// Nodus, при уходе — скрывается на паузу (карточка «ждёт», не сгорает).
/// Триггеры — события главного окна и завершение загрузки; решение — живой
/// Win32-запрос foreground (`nodus_active`), событиям не верим на слово.
pub(crate) fn sync_visibility(app: &AppHandle, reason: &'static str) {
    let show = {
        let st = state();
        match want_visible(st.series.is_some(), st.ready, nodus_active()) {
            true if !st.shown => Some(true),
            false if st.shown => Some(false),
            _ => None,
        }
    };
    let Some(show) = show else { return };
    let Some(win) = app.get_webview_window(SLOT_LABEL) else {
        return;
    };
    state().shown = show;
    if show {
        show_without_activation(&win, SLOT_LABEL);
        // Карточка продолжает автоскрытие с остатка своих 8 с.
        let _ = win.eval("window.__popupAwake&&window.__popupAwake(true)");
        log::info!("download-slot: показан ({reason})");
    } else {
        let _ = win.hide();
        // Пауза автоскрытия: скрытая карточка ждёт возврата фокуса.
        let _ = win.eval("window.__popupAwake&&window.__popupAwake(false)");
        log::info!("download-slot: скрыт — окно Nodus неактивно, ждёт фокуса ({reason})");
    }
}

/// Окно слота закрылось (автоскрытие 8 с / крестик / «Показать в папке»):
/// серия заканчивается — следующая загрузка начнёт счёт с 1 (#1038).
pub(crate) fn on_destroyed(app: &AppHandle) {
    *state() = fresh_state();
    // Уничтожение окна с webview-ребёнком часто оставляет очередь ввода без
    // фокуса (winit #4345, #709) — возвращаем клавиатуру в портал.
    crate::focus::reclaim(app, "закрытие слота скачивания");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn step(prev: Option<&DownloadSeries>, name: &str, success: bool, now: u64) -> DownloadSeries {
        series_step(prev, name.into(), None, success, now)
    }

    /// Подряд успешные суммируются; имя и путь — ПОСЛЕДНЕГО файла серии.
    #[test]
    fn серия_успехов_суммируется_и_помнит_последний_файл() {
        let mut s = series_step(None, "a.pdf".into(), Some(r"C:\D\a.pdf".into()), true, 0);
        assert_eq!((s.count, s.success), (1, true));
        s = series_step(
            Some(&s),
            "b.pdf".into(),
            Some(r"C:\D\b.pdf".into()),
            true,
            1000,
        );
        assert_eq!(s.count, 2);
        assert_eq!(s.file_name, "b.pdf");
        assert_eq!(s.path.as_deref(), Some(r"C:\D\b.pdf"));
        s = step(Some(&s), "c.pdf", true, 2000);
        assert_eq!(s.count, 3);
    }

    /// Неуспех показывает короткую ошибку и начинает новую серию: успех после
    /// неуспеха — снова 1; неуспехи подряд не копятся.
    #[test]
    fn неуспех_начинает_новую_серию() {
        let mut s = step(None, "a.pdf", true, 0);
        s = step(Some(&s), "b.pdf", true, 1);
        assert_eq!(s.count, 2);
        s = step(Some(&s), "c.pdf", false, 2);
        assert_eq!((s.count, s.success), (1, false));
        s = step(Some(&s), "d.pdf", true, 3);
        assert_eq!((s.count, s.success), (1, true));
        s = step(Some(&s), "e.pdf", false, 4);
        s = step(Some(&s), "f.pdf", false, 5);
        assert_eq!((s.count, s.success), (1, false));
    }

    /// Автоскрытие перезапускается на каждом новом файле серии (#1038):
    /// якорь отсчёта — время ПОСЛЕДНЕГО шага (мини-UI начинает свои 8 с
    /// заново по самому факту обновлённого payload).
    #[test]
    fn таймер_автоскрытия_перезапускается_на_каждом_файле() {
        let a = step(None, "a.pdf", true, 1_000);
        assert_eq!(a.updated_at_ms, 1_000);
        let b = step(Some(&a), "b.pdf", true, 5_000);
        assert_eq!(
            b.updated_at_ms, 5_000,
            "отсчёт пошёл заново от нового файла"
        );
    }

    /// Фокус-гейтинг (#1038): без фокуса Nodus карточка не показывается и
    /// ждёт; без серии/непрогретым вебвью не показывается вовсе.
    #[test]
    fn фокус_гейтинг_карточка_ждёт_возврата_фокуса() {
        assert!(
            !want_visible(true, true, false),
            "пользователь в Word — ждём"
        );
        assert!(want_visible(true, true, true), "фокус вернулся — показ");
        assert!(!want_visible(false, true, true), "нечего показывать");
        assert!(!want_visible(true, false, true), "вебвью не прогрет");
    }

    /// Слот прилипает к панели и правой группе кнопок (#1038): верх = панель
    /// 40 + зазор 6; правый край = левая кромка группы 138.
    #[test]
    fn якорь_слота_прилипает_к_панели_и_кнопкам() {
        let (x, y) = slot_origin(100, 50, 1000, 1.0);
        assert_eq!((x, y), (100 + 1000 - 138 - 360, 50 + 40 + 6));
        assert_eq!((x, y), (602, 96));
    }

    /// Масштаб считается по физическим px; максимизированное окно уходит за
    /// экран на рамку (−8) — якорь от окна остаётся в видимой области.
    #[test]
    fn якорь_учитывает_масштаб_и_максимизированное_окно() {
        // 1.25: кнопки 172.5→173, карточка 450, панель 50, зазор 7.5→8.
        let (x, y) = slot_origin(0, 0, 2400, 1.25);
        assert_eq!(x, 2400 - 173 - 450);
        assert_eq!(y, 50 + 8);
        let (x, y) = slot_origin(-8, -8, 1936, 1.0);
        assert_eq!(y, -8 + 40 + 6);
        assert!(y >= 0, "верх карточки в видимой области");
        assert_eq!(x, -8 + 1936 - 138 - 360);
    }

    /// Payload мини-UI: счётчик и факт успеха есть, путь — никогда (#647).
    #[test]
    fn payload_слота_несёт_счётчик_но_не_путь() {
        let s = series_step(
            None,
            "Смета.xlsx".into(),
            Some(r"C:\Users\u\Downloads\Смета.xlsx".into()),
            true,
            0,
        );
        let json = series_payload(&s);
        assert_eq!(json["download"]["fileName"], "Смета.xlsx");
        assert_eq!(json["download"]["count"], 1);
        assert_eq!(json["download"]["success"], true);
        assert_eq!(json["autoHideMs"], serde_json::json!(DOWNLOAD_AUTO_HIDE_MS));
        assert!(
            json["download"].get("path").is_none(),
            "путь не уходит в мини-UI"
        );
    }
}
