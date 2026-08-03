import { db } from './db';

/**
 * Review-request scheduling settings, per store.
 *
 * Why a delay exists at all: the app used to email the moment `orders/fulfilled` arrived,
 * which is the moment the parcel leaves the warehouse — days before the customer holds
 * the product. Asking for a review of something not yet received reads as spam and
 * converts accordingly. The market default (Loox) is 14 days after fulfilment; Judge.me
 * lets merchants tune 0–365 days. We default to 14 and allow 0–60.
 *
 * Reminders are the cheapest review-volume multiplier there is, and also the fastest way
 * to feel spammy, so they are capped at 2 and every send still passes the global
 * suppression list. A submitted review cancels everything outstanding.
 */

const PREFIX = 'requests.';

export interface RequestSettings {
  /** Days after fulfilment before the first email. 0 = same day (next sweep). */
  delayDays: number;
  /** Reminder emails after the first. 0–2. */
  reminders: number;
  /** Days between sends. */
  reminderGapDays: number;
}

export const DEFAULT_REQUEST_SETTINGS: RequestSettings = {
  delayDays: 14,
  reminders: 1,
  reminderGapDays: 7,
};

const LIMITS: Record<keyof RequestSettings, [number, number]> = {
  delayDays: [0, 60],
  reminders: [0, 2],
  reminderGapDays: [1, 14],
};

export const REQUEST_SETTING_KEYS = new Set(
  Object.keys(DEFAULT_REQUEST_SETTINGS).map((k) => `${PREFIX}${k}`)
);

function clamp(field: keyof RequestSettings, raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const [lo, hi] = LIMITS[field];
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

export async function getRequestSettings(storeId: string): Promise<RequestSettings> {
  const rows = await db.storeSetting.findMany({
    where: { storeId, key: { startsWith: PREFIX } },
    select: { key: true, value: true },
  });

  const out: RequestSettings = { ...DEFAULT_REQUEST_SETTINGS };
  for (const row of rows) {
    const field = row.key.slice(PREFIX.length) as keyof RequestSettings;
    if (!(field in out)) continue;
    const v = clamp(field, row.value);
    if (v !== null) out[field] = v;
  }
  return out;
}

export async function saveRequestSettings(
  storeId: string,
  updates: Record<string, string>
): Promise<{ saved: number; rejected: string[] }> {
  const rejected: string[] = [];
  let saved = 0;

  for (const [key, rawValue] of Object.entries(updates)) {
    if (!REQUEST_SETTING_KEYS.has(key)) {
      rejected.push(key);
      continue;
    }
    const field = key.slice(PREFIX.length) as keyof RequestSettings;
    const v = clamp(field, String(rawValue));
    if (v === null) {
      rejected.push(key);
      continue;
    }
    await db.storeSetting.upsert({
      where: { storeId_key: { storeId, key } },
      create: { storeId, key, value: String(v) },
      update: { value: String(v) },
    });
    saved++;
  }
  return { saved, rejected };
}
