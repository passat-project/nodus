/** Полезная нагрузка проверки живости `GET /health` WS-gateway. */
export interface GatewayHealthPayload {
  /** ok — доставка событий жива; unavailable — чтение потока не удаётся
   *  (HTTP 503: healthcheck docker-compose увидит сбой). */
  status: 'ok' | 'unavailable';
  timestamp: string;
}

export function buildHealthPayload(healthy = true, now = new Date()): GatewayHealthPayload {
  return { status: healthy ? 'ok' : 'unavailable', timestamp: now.toISOString() };
}
