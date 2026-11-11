/**
 * `pnpm live-stack status`: состояние контура и режима (dev / preview /
 * dev+mock / +local) и LAN-адреса web (#675). Вынесено из live-stack.mjs (I5):
 * список портов и пробы передаются вызывающим, модуль ничего не знает о
 * старте процессов.
 */
import { collectLanAddresses, formatLanUrls } from './lib/lan-urls.mjs';

export async function printStatus({
  pids,
  pidAlive,
  portBusy,
  ports,
  mode,
  lan = collectLanAddresses(),
}) {
  if (mode) console.log(`mode     ${mode}`);
  for (const [name, port] of Object.entries(ports)) {
    const pid = pids[name];
    const busy = await portBusy(port);
    const state = pidAlive(pid)
      ? `running (pid ${pid})`
      : busy
        ? 'port taken by FOREIGN process (orphan?)'
        : 'free';
    console.log(`${name.padEnd(8)} :${port}  ${state}`);
  }
  // LAN-адреса — только у поднятого стека: у выключенной песочницы их нет.
  if (mode?.includes('+local')) {
    console.log('LAN      выключен (--local): доступ только с этого ПК');
  } else if (mode) {
    if (lan.length === 0) {
      console.log('LAN      нет приватных IPv4 — доступ только с этого ПК');
    } else {
      for (const url of formatLanUrls(ports.web, lan)) console.log(`LAN      ${url}`);
    }
  }
  // Контур владельца (чужой процесс — только проба порта): сюда отсылают на
  // приёмку, а он может быть выключен — видимость вместо предположения.
  const devUp = await portBusy(5173);
  console.log(`dev-owner :5173  ${devUp ? 'up (владельца)' : 'down — приёмку отдавать на :4173'}`);
}
