import type { ClientTelemetryEvent, TelemetryEventRequest } from '../shared/telemetry';

/** Best-effort aggregate event; telemetry must never interrupt play. */
export const trackClientEvent = (event: ClientTelemetryEvent): void => {
  const body: TelemetryEventRequest = { event };
  void fetch('/api/telemetry', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => undefined);
};
