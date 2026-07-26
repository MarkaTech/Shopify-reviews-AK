/**
 * Shared client-side API helper.
 *
 * Every page previously did `const data = await res.json()` with no status check, so
 * failures were rendered as successes — a plan-limit rejection produced
 * "Imported undefined reviews", and genuine errors vanished silently.
 *
 * apiFetch throws ApiError on any non-2xx, carrying the plan-limit details the server
 * sends with a 402 so callers can show a real upgrade prompt.
 */

export class ApiError extends Error {
  status: number;
  code?: string;
  currentPlan?: string;
  suggestedPlan?: string | null;
  usage?: { used: number; limit: number };

  constructor(message: string, status: number, payload?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = payload?.code as string | undefined;
    this.currentPlan = payload?.currentPlan as string | undefined;
    this.suggestedPlan = (payload?.suggestedPlan as string | null) ?? null;
    this.usage = payload?.usage as { used: number; limit: number } | undefined;
  }

  /** True when this failed because the store's plan does not allow it. */
  get isPlanLimit(): boolean {
    return this.status === 402;
  }

  /** True when the session is missing or expired. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** A message suitable for showing directly to a merchant. */
  get userMessage(): string {
    if (this.isPlanLimit && this.suggestedPlan) {
      const plan = this.suggestedPlan.charAt(0).toUpperCase() + this.suggestedPlan.slice(1);
      return `${this.message} Upgrade to ${plan} to continue.`;
    }
    if (this.isUnauthorized) {
      return 'Your session has expired. Please reload the page.';
    }
    return this.message;
  }
}

export async function apiFetch<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'include',
      ...init,
      headers: {
        ...(init?.body && typeof init.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }

  const text = await res.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      if (!res.ok) throw new ApiError(`Request failed (${res.status})`, res.status);
    }
  }

  if (!res.ok) {
    const message = (payload.error as string) || (payload.message as string) || `Request failed (${res.status})`;
    throw new ApiError(message, res.status, payload);
  }

  return payload as T;
}

/** Convenience for toast handlers: turn any thrown value into a merchant-safe string. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) return err.userMessage;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
