import { redis } from '@devvit/web/server';
import type { EndlessTier } from '../../shared/api';
import type { ClientTelemetryEvent } from '../../shared/telemetry';
import { previousDate, todayUtc } from '../../shared/date';
import { keys } from './keys';

const COUNTER_TTL_SECONDS = 60 * 60 * 24 * 400;
const ACTIVE_TTL_SECONDS = 60 * 60 * 24 * 32;
const CLIENT_RATE_TTL_SECONDS = 60 * 60 * 48;
const CLIENT_EVENT_DAILY_LIMIT = 500;

// HINCRBY and HSETNX are atomic already. Keep best-effort telemetry off
// WATCH/MULTI: Devvit 0.12.24 drops boolean transaction replies from exec(),
// and a date-wide WATCH also creates avoidable contention on gameplay routes.
const incrementWithExpiry = async (
  key: string,
  field: string,
  ttlSeconds: number
): Promise<number> => {
  const count = await redis.hIncrBy(key, field, 1);
  await redis.expire(key, ttlSeconds);
  return count;
};

const setNxWithExpiry = async (
  key: string,
  field: string,
  ttlSeconds: number
): Promise<boolean> => {
  const added: unknown = await redis.hSetNX(key, field, '1');
  await redis.expire(key, ttlSeconds);
  return typeof added === 'number' ? added > 0 : added === true;
};

/** Increment one bounded aggregate field for the current UTC day. */
export const trackTelemetry = async (field: string): Promise<void> => {
  try {
    await incrementWithExpiry(keys.telemetryDay(todayUtc()), field, COUNTER_TTL_SECONDS);
  } catch (error) {
    console.error(`Telemetry failed for ${field}: ${error}`);
  }
};

export const trackClientTelemetry = async (
  event: ClientTelemetryEvent,
  actor: string
): Promise<boolean> => {
  try {
    const date = todayUtc();
    const requests = await incrementWithExpiry(
      keys.telemetryRate(date),
      actor,
      CLIENT_RATE_TTL_SECONDS
    );
    if (requests > CLIENT_EVENT_DAILY_LIMIT) return false;
    await trackTelemetry(`client:${event}`);
    return true;
  } catch (error) {
    console.error(`Client telemetry rate limit failed: ${error}`);
    return false;
  }
};

/** Aggregate signed daily actives and next-day returners without exposing a report of users. */
export const trackDailyActive = async (user: string): Promise<void> => {
  if (user === 'anon') {
    await trackTelemetry('active:guest_session');
    return;
  }
  try {
    const today = todayUtc();
    const activeKey = keys.telemetryActive(today);
    const firstToday = await setNxWithExpiry(activeKey, user, ACTIVE_TTL_SECONDS);
    if (!firstToday) return;
    await trackTelemetry('active:signed_unique');
    const returned = await redis.hGet(keys.telemetryActive(previousDate(today)), user);
    if (returned) await trackTelemetry('active:signed_next_day_return');
  } catch (error) {
    console.error(`Active telemetry failed: ${error}`);
  }
};

export const trackEndlessIssued = async (tier: EndlessTier): Promise<void> =>
  trackTelemetry(`endless:issued:${tier}`);

export const trackEndlessCompleted = async (
  tier: EndlessTier,
  atPar: boolean
): Promise<void> => {
  await trackTelemetry(`endless:completed:${tier}`);
  if (atPar) await trackTelemetry(`endless:at_par:${tier}`);
};
