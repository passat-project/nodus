//! Политика угасания одного попапа (#998): чистая машина состояний без
//! Tauri — пауза от первого ввода после появления, затем таяние; hover и
//! открытое поле ответа сбрасывают отсчёт. Времена — монотонные мс от старта
//! процесса (`activity::monotonic_ms`), единая база с `last_input_ms`.
//!
//! Вынесено из `fade.rs` (I5): там тикер и конфиг, здесь — только правило,
//! проверяемое unit-тестами без окна и WebView2.

/// Решение одного тика.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FadeStep {
    /// Держать как есть (пауза идёт или ввода ещё нет).
    Hold,
    /// Начать таяние (CSS-переход полной длительности).
    Start,
    /// Вернуть полную яркость (hover/поле ответа, ввод до появления).
    Reset,
    /// Таяние завершено — окно закрыть.
    Close,
}

/// Политика угасания одного попапа.
#[derive(Debug)]
pub(crate) struct FadePolicy {
    /// Момент появления попапа: ввод раньше него активностью не считается.
    created_ms: u64,
    /// Когда начинать таяние (пауза от первого нажатия после появления).
    wait_due_ms: Option<u64>,
    /// Момент, когда отсчёт паузы стартовал (для журнала фактической паузы).
    wait_started_ms: Option<u64>,
    /// Начало таяния.
    fading_since_ms: Option<u64>,
}

impl FadePolicy {
    pub(crate) fn new(created_ms: u64) -> Self {
        Self {
            created_ms,
            wait_due_ms: None,
            wait_started_ms: None,
            fading_since_ms: None,
        }
    }

    /// Сбросить паузу/таяние (наведение, поле ответа). После ухода — свежий
    /// отсчёт: «навёл — прочитал», а не «пауза продолжается с прошлого раза».
    pub(crate) fn reset(&mut self) {
        self.wait_due_ms = None;
        self.wait_started_ms = None;
        self.fading_since_ms = None;
    }

    /// Начало текущей паузы (для журнала фактического времени ожидания).
    pub(crate) fn wait_started_ms(&self) -> Option<u64> {
        self.wait_started_ms
    }

    /// Один тик. `paused` — курсор на попапе или открыто поле ответа.
    /// Повторные нажатия паузу НЕ продлевают (вердикт владельца 23.11.2026):
    /// `wait_due_ms` ставится один раз и живёт до hover/сброса.
    pub(crate) fn step(
        &mut self,
        now: u64,
        last_input: u64,
        delay_ms: u64,
        fade_ms: u64,
        paused: bool,
    ) -> FadeStep {
        if paused || last_input < self.created_ms {
            return self.pause();
        }
        let due = match self.wait_due_ms {
            Some(due) => due,
            None => {
                let due = now.saturating_add(delay_ms);
                self.wait_due_ms = Some(due);
                self.wait_started_ms = Some(now);
                due
            }
        };
        if now < due {
            if self.fading_since_ms.take().is_some() {
                return FadeStep::Reset;
            }
            return FadeStep::Hold;
        }
        match self.fading_since_ms {
            None => {
                self.fading_since_ms = Some(now);
                FadeStep::Start
            }
            Some(started) if now.saturating_sub(started) >= fade_ms => FadeStep::Close,
            Some(_) => FadeStep::Hold,
        }
    }

    fn pause(&mut self) -> FadeStep {
        let was_fading = self.fading_since_ms.take().is_some();
        self.wait_due_ms = None;
        self.wait_started_ms = None;
        if was_fading {
            FadeStep::Reset
        } else {
            FadeStep::Hold
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DELAY: u64 = 2_000;
    const FADE: u64 = 3_000;

    fn policy() -> FadePolicy {
        FadePolicy::new(1_000)
    }

    #[test]
    fn без_ввода_после_появления_не_гаснет() {
        let mut p = policy();
        for now in (1_000..=60_000).step_by(500) {
            assert_eq!(p.step(now, 0, DELAY, FADE, false), FadeStep::Hold);
        }
    }

    #[test]
    fn после_первого_ввода_пауза_потом_таяние() {
        let mut p = policy();
        // Ввод в 2000: тик в 2120 замечает его и ставит паузу до 4120.
        assert_eq!(p.step(2_120, 2_000, DELAY, FADE, false), FadeStep::Hold);
        assert_eq!(p.step(4_000, 2_000, DELAY, FADE, false), FadeStep::Hold);
        assert_eq!(p.step(4_119, 2_000, DELAY, FADE, false), FadeStep::Hold);
        assert_eq!(p.step(4_120, 2_000, DELAY, FADE, false), FadeStep::Start);
        assert_eq!(p.step(7_119, 2_000, DELAY, FADE, false), FadeStep::Hold);
        assert_eq!(p.step(7_120, 2_000, DELAY, FADE, false), FadeStep::Close);
    }

    #[test]
    fn повторные_нажатия_не_продлевают_паузу() {
        let mut p = policy();
        assert_eq!(p.step(2_120, 2_000, DELAY, FADE, false), FadeStep::Hold);
        assert_eq!(p.step(3_000, 2_900, DELAY, FADE, false), FadeStep::Hold);
        // Пауза считается от первого ввода: таяние в 4120, а не в 5000.
        assert_eq!(p.step(4_120, 4_100, DELAY, FADE, false), FadeStep::Start);
    }

    #[test]
    fn hover_ставит_паузу_и_даёт_свежий_отсчёт() {
        let mut p = policy();
        assert_eq!(p.step(2_120, 2_000, DELAY, FADE, false), FadeStep::Hold);
        assert_eq!(p.step(3_000, 2_000, DELAY, FADE, true), FadeStep::Hold);
        // Ушли курсором в 5000 — новый отсчёт до 7000, а не остаток старого.
        assert_eq!(p.step(5_000, 2_000, DELAY, FADE, false), FadeStep::Hold);
        assert_eq!(p.step(6_999, 2_000, DELAY, FADE, false), FadeStep::Hold);
        assert_eq!(p.step(7_000, 2_000, DELAY, FADE, false), FadeStep::Start);
    }

    #[test]
    fn hover_во_время_таяния_возвращает_яркость() {
        let mut p = policy();
        assert_eq!(p.step(2_120, 2_000, DELAY, FADE, false), FadeStep::Hold);
        assert_eq!(p.step(4_120, 2_000, DELAY, FADE, false), FadeStep::Start);
        assert_eq!(p.step(4_200, 2_000, DELAY, FADE, true), FadeStep::Reset);
        assert_eq!(p.step(5_000, 2_000, DELAY, FADE, false), FadeStep::Hold);
        assert_eq!(p.step(7_000, 2_000, DELAY, FADE, false), FadeStep::Start);
    }

    #[test]
    fn нулевая_пауза_начинает_сразу() {
        let mut p = policy();
        assert_eq!(p.step(2_000, 2_000, 0, FADE, false), FadeStep::Start);
    }
}
