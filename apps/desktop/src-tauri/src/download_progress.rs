//! Прогресс скачиваний WebView2 для карточки «Скачивается» (#1069).
//!
//! wry отдаёт только `Requested`/`Finished`; процент есть только у
//! `ICoreWebView2DownloadOperation` (`DownloadStarting` → `BytesReceived` /
//! `TotalBytesToReceive`). Поэтому на главный вебвью параллельно ставится
//! свой `DownloadStarting`-обработчик: wry-обработчик (ставится при создании
//! окна) уже выставил `Handled(true)` и путь — наш только читает операцию и
//! подписывается на байты. Старт карточки делает синхронный `on_download`
//! (`downloads::notify_started`), сюда приходит только прогресс; совпадение
//! с текущей загрузкой по URL проверяет слот (`download_slot::on_progress`).

use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;

use tauri::{AppHandle, Manager};
use webview2_com::{
    BytesReceivedChangedEventHandler, CoTaskMemPWSTR, DownloadStartingEventHandler,
    Microsoft::Web::WebView2::Win32::{ICoreWebView2DownloadOperation, ICoreWebView2_4},
};
use windows_core::{Interface, PWSTR};

use crate::download_slot;

/// Повесить на главное окно обработчик прогресса. Ошибка (нет главного окна,
/// WebView2 не отдал `ICoreWebView2_4`) — лог без падения: карточка просто
/// остаётся с бегущей полоской без процентов.
pub(crate) fn install(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else {
        log::warn!("download-progress: главного окна нет — прогресс без процентов");
        return;
    };
    let app = app.clone();
    let _ = win.with_webview(move |webview| {
        let result = unsafe { attach(&app, &webview) };
        if let Err(error) = result {
            log::warn!("download-progress: обработчик не установлен: {error}");
        }
    });
}

/// Приватная часть установки (WebView2 COM, вызывается на потоке окна).
unsafe fn attach(
    app: &AppHandle,
    webview: &tauri::webview::PlatformWebview,
) -> windows_core::Result<()> {
    let core = webview.controller().CoreWebView2()?;
    let core4: ICoreWebView2_4 = core.cast()?;
    let app = app.clone();
    let handler = DownloadStartingEventHandler::create(Box::new(move |_sender, args| {
        let Some(args) = args else {
            return Ok(());
        };
        let operation = args.DownloadOperation()?;
        let mut raw = PWSTR::null();
        if operation.Uri(&mut raw).is_err() {
            return Ok(());
        }
        let url = CoTaskMemPWSTR::from(raw).to_string();
        subscribe_progress(app.clone(), operation, url);
        Ok(())
    }));
    let mut token = 0i64;
    core4.add_DownloadStarting(&handler, &mut token)?;
    Ok(())
}

/// Подписка на байты одной загрузки: процент считается из
/// `BytesReceived`/`TotalBytesToReceive`, шлётся только при смене целого
/// процента (для больших файлов — ≤ 100 eval'ов на загрузку).
fn subscribe_progress(app: AppHandle, operation: ICoreWebView2DownloadOperation, url: String) {
    let last = Arc::new(AtomicU8::new(u8::MAX));
    let handler = BytesReceivedChangedEventHandler::create(Box::new(move |operation, _| {
        if let Some(operation) = operation {
            let mut total = 0i64;
            let mut received = 0i64;
            unsafe {
                let _ = operation.TotalBytesToReceive(&mut total);
                let _ = operation.BytesReceived(&mut received);
            }
            if total > 0 && received >= 0 {
                let percent = ((received as u64 * 100) / total as u64).min(100) as u8;
                if last.swap(percent, Ordering::Relaxed) != percent {
                    download_slot::on_progress(&app, &url, percent);
                }
            }
        }
        Ok(())
    }));
    let mut token = 0i64;
    unsafe {
        let _ = operation.add_BytesReceivedChanged(&handler, &mut token);
    }
}
