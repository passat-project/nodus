/// <reference types="vite/client" />

/** Версия ЭТОЙ сборки портала (#1038): вшита vite-плагином
 *  `vite-portal-version.ts` (env VITE_PORTAL_VERSION → максимум из
 *  whats-new/releases → '0.0.0'); читается фичой `features/portal-update`. */
declare const __PORTAL_VERSION__: string;
