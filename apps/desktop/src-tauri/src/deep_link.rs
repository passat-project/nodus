use tauri::AppHandle;
use tauri_plugin_deep_link::DeepLinkExt;

/// Схема deep link из конфига Tauri (`plugins.deep-link.desktop.schemes`):
/// один источник правды. Продуктовая сборка регистрирует `nodus`, бета
/// (`tauri.beta.conf.json`) — свою `nodus-beta` и НЕ перехватывает `nodus://`
/// у установленной оболочки. Конфига нет — канонический `nodus`.
fn scheme_from_config(plugin: Option<&serde_json::Value>) -> String {
    plugin
        .and_then(|value| value.get("desktop"))
        .and_then(|value| value.get("schemes"))
        .and_then(|value| value.as_array())
        .and_then(|schemes| schemes.first())
        .and_then(|scheme| scheme.as_str())
        .unwrap_or("nodus")
        .to_string()
}

fn configured_scheme(app: &AppHandle) -> String {
    scheme_from_config(app.config().plugins.0.get("deep-link"))
}

/// Схема deep link (плагин deep-link): холодный старт + регистрация схемы
/// в реестре (ремень+подтяжки для portable/dev-запусков; установщик тоже
/// регистрирует). Разбор и доставка — bridge::route_deep_link.
pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let scheme = configured_scheme(app);
    if let Err(e) = app.deep_link().register(&scheme) {
        log::warn!("схема {scheme}:// не зарегистрирована: {e}");
    }
    if let Ok(Some(urls)) = app.deep_link().get_current() {
        for url in urls {
            crate::bridge::route_deep_link(app, url.as_str());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::scheme_from_config;
    use serde_json::json;

    /// Схема берётся из конфига плагина: продуктовая — `nodus`, бета — своя
    /// (иначе бета перехватила бы `nodus://` у установленного приложения).
    /// Нет секции/схем — канонический фолбэк.
    #[test]
    fn схема_читается_из_конфига_плагина() {
        assert_eq!(
            scheme_from_config(Some(&json!({"desktop": {"schemes": ["nodus-beta"]}}))),
            "nodus-beta"
        );
        assert_eq!(
            scheme_from_config(Some(&json!({"desktop": {"schemes": ["nodus"]}}))),
            "nodus"
        );
        // Нет секции, нет desktop, нет схем, пустой массив, мусор — `nodus`.
        for broken in [
            None,
            Some(json!({})),
            Some(json!({"desktop": {}})),
            Some(json!({"desktop": {"schemes": []}})),
            Some(json!({"desktop": {"schemes": [42]}})),
        ] {
            assert_eq!(scheme_from_config(broken.as_ref()), "nodus");
        }
    }
}
