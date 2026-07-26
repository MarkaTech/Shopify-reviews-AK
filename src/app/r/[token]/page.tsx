'use client';

import { useEffect, useState, use } from 'react';

/**
 * Public review submission page.
 *
 * Reached by the buyer from the email sent after their order was fulfilled. No login:
 * the single-use token in the URL is the authorisation.
 */

interface Item { productId: string | null; title: string; image: string | null }
interface RequestData { storeName: string; customerName: string | null; orderNumber: string | null; items: Item[] }

export default function ReviewRequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [data, setData] = useState<RequestData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [forms, setForms] = useState<Record<string, { rating: number; title: string; body: string }>>({});

  useEffect(() => {
    fetch(`/api/review-request/${token}`)
      .then(async r => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'This link is not valid.');
        return j as RequestData;
      })
      .then(d => {
        setData(d);
        const initial: Record<string, { rating: number; title: string; body: string }> = {};
        d.items.forEach((it, i) => {
          initial[it.productId ?? `item-${i}`] = { rating: 5, title: '', body: '' };
        });
        setForms(initial);
      })
      .catch(e => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async () => {
    setSubmitting(true);
    try {
      const reviews = Object.entries(forms)
        .filter(([, f]) => f.body.trim())
        .map(([key, f]) => ({
          productId: key.startsWith('item-') ? null : key,
          rating: f.rating,
          title: f.title,
          body: f.body,
        }));

      if (reviews.length === 0) {
        setLoadError('Please write a short review before submitting.');
        setSubmitting(false);
        return;
      }

      const res = await fetch(`/api/review-request/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviews }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not submit your review.');
      setDone(true);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not submit your review.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <Shell><p className="text-sm text-gray-500">Loading…</p></Shell>;
  }

  if (done) {
    return (
      <Shell>
        <div className="text-center py-6">
          <div className="text-4xl mb-3">★</div>
          <h1 className="text-xl font-bold text-gray-900">Thank you</h1>
          <p className="mt-2 text-sm text-gray-600">
            Your review has been sent to {data?.storeName ?? 'the store'}. It will appear once they have reviewed it.
          </p>
        </div>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <div className="text-center py-6">
          <h1 className="text-lg font-semibold text-gray-900">This link is not available</h1>
          <p className="mt-2 text-sm text-gray-600">{loadError}</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-xl font-bold text-gray-900">
        How was your order{data.orderNumber ? ` #${data.orderNumber}` : ''}?
      </h1>
      <p className="mt-1 text-sm text-gray-600">
        {data.customerName ? `Thanks ${data.customerName}. ` : ''}
        {data.storeName} would love to hear what you thought.
      </p>

      {loadError && (
        <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>
      )}

      <div className="mt-6 space-y-6">
        {data.items.map((item, i) => {
          const key = item.productId ?? `item-${i}`;
          const f = forms[key] ?? { rating: 5, title: '', body: '' };
          const set = (patch: Partial<typeof f>) =>
            setForms(prev => ({ ...prev, [key]: { ...f, ...patch } }));

          return (
            <div key={key} className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-center gap-3">
                {item.image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image} alt="" className="h-12 w-12 rounded object-cover" />
                )}
                <p className="text-sm font-medium text-gray-900">{item.title}</p>
              </div>

              <div className="mt-3 flex items-center gap-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    type="button"
                    aria-label={`${n} star${n === 1 ? '' : 's'}`}
                    onClick={() => set({ rating: n })}
                    className="text-2xl leading-none"
                    style={{ color: n <= f.rating ? '#f59e0b' : '#d1d5db' }}
                  >
                    ★
                  </button>
                ))}
              </div>

              <input
                value={f.title}
                onChange={e => set({ title: e.target.value })}
                placeholder="Add a title (optional)"
                className="mt-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <textarea
                value={f.body}
                onChange={e => set({ body: e.target.value })}
                placeholder="What did you think of it?"
                rows={4}
                className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          );
        })}
      </div>

      <button
        onClick={submit}
        disabled={submitting}
        className="mt-6 w-full rounded-md bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
      >
        {submitting ? 'Sending…' : 'Submit review'}
      </button>

      <p className="mt-4 text-center text-[11px] text-gray-400">
        You are reviewing a purchase you made from {data.storeName}.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-lg rounded-xl bg-white p-6 shadow-sm">{children}</div>
    </main>
  );
}
