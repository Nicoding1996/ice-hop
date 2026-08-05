export type ClientTelemetryEvent =
  | 'daily_started'
  | 'endless_started'
  | 'community_started'
  | 'daily_to_endless'
  | 'daily_to_community'
  | 'endless_next'
  | 'endless_change_level'
  | 'community_next'
  | 'creator_test_started'
  | 'creator_test_solved';

export type TelemetryEventRequest = { readonly event: ClientTelemetryEvent };

const CLIENT_EVENTS: readonly ClientTelemetryEvent[] = [
  'daily_started',
  'endless_started',
  'community_started',
  'daily_to_endless',
  'daily_to_community',
  'endless_next',
  'endless_change_level',
  'community_next',
  'creator_test_started',
  'creator_test_solved',
];

export const isClientTelemetryEvent = (value: unknown): value is ClientTelemetryEvent =>
  typeof value === 'string' && CLIENT_EVENTS.some((event) => event === value);
