'use client';

import { useEffect, useState, use, useRef } from 'react';

/**
 * Public review submission page.
 *
 * Reached by the buyer from the email sent after their order was fulfilled. No login:
 * the single-use token in the URL is the authorisation.
 *
 * Photo/video upload lives here as well as on the storefront widget — this flow produces
 * the app's verified-buyer reviews, which are exactly the ones a photo is worth the most
 * on (and the ones the merchant's photo/video incentive tiers are meant to reward).
 * Whether the controls appear at all is the merchant's storefront setting, served by the
 * GET endpoint; the server re-checks on submit regardless.
 */

interface Item { productId: string | null; title: string; image: string | null }
interface RequestData {
  storeName: string;
  customerName: string | null;
  orderNumber: string | null;
  items: Item[];
  allowPhotos?: boolean;
  allowVideo?: boolean;
}

interface Attachment { file: File; url: string; isVideo: boolean }
interface ItemForm { rating: number; title: string; body: string; media: Attachment[] }

// Mirrors the server's caps in src/lib/media.ts. The server is the rule; these exist so
// a buyer hears "that video is too large" the moment they pick it, not after uploading.
const MAX_IMAGES = 5;
const MAX_VIDEOS = 1;
const MAX_IMAGE_MB = 10;
const MAX_VIDEO_MB = 50;

export default function ReviewRequestPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);

  const [data, setData] = useState<RequestData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [forms, setForms] = useState<Record<string, ItemForm>>({});

  useEffect(() => {
    fetch(`/api/review-request/${token}`)
      .then(async r => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'This link is not valid.');
        return j as RequestData;
      })
      .then(d => {
        setData(d);
        const initial: Record<string, ItemForm> = {};
        d.items.forEach((it, i) => {
          initial[it.productId ?? `item-${i}`] = { rating: 5, title: '', body: '', media: [] };
        });
        setForms(initial);
      })
      .catch(e => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async () => {
    setSubmitting(true);
    try {
      const entries = Object.entries(forms).filter(([, f]) => f.body.trim());

      if (entries.length === 0) {
        setLoadError('Please write a short review before submitting.');
        setSubmitting(false);
        return;
      }

      // Multipart rather than JSON so the files ride along in the same request. The
      // `key` ties each review to its `media:<key>` parts on the server.
      const fd = new FormData();
      fd.append(
        'reviews',
        JSON.stringify(
          entries.map(([key, f]) => ({
            key,
            productId: key.startsWith('item-') ? null : key,
            rating: f.rating,
            title: f.title,
            body: f.body,
          }))
        )
      );
      for (const [key, f] of entries) {
        for (const m of f.media) fd.append(`media:${key}`, m.file);
      }

      const res = await fetch(`/api/review-request/${token}`, { method: 'POST', body: fd });
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

  const allowPhotos = data.allowPhotos !== false;
  const allowVideo = data.allowVideo !== false;
  const allowMedia = allowPhotos || allowVideo;

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
          const f = forms[key] ?? { rating: 5, title: '', body: '', media: [] };
          const set = (patch: Partial<ItemForm>) =>
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

              {allowMedia && (
                <MediaPicker
                  media={f.media}
                  allowPhotos={allowPhotos}
                  allowVideo={allowVideo}
                  onChange={media => set({ media })}
                  onError={msg => setLoadError(msg)}
                />
              )}
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

function MediaPicker({
  media,
  allowPhotos,
  allowVideo,
  onChange,
  onError,
}: {
  media: Attachment[];
  allowPhotos: boolean;
  allowVideo: boolean;
  onChange: (media: Attachment[]) => void;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const accept = [
    allowPhotos ? 'image/jpeg,image/png,image/gif,image/webp' : '',
    allowVideo ? 'video/mp4,video/quicktime,video/webm' : '',
  ].filter(Boolean).join(',');

  const label =
    allowPhotos && allowVideo ? 'Add photos or a video'
    : allowPhotos ? 'Add photos'
    : 'Add a video';

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const next = [...media];

    for (const file of Array.from(files)) {
      const isVideo = file.type.startsWith('video/');

      // Local pre-checks mirroring the server's caps, so bad picks fail instantly.
      if (isVideo && next.filter(m => m.isVideo).length >= MAX_VIDEOS) {
        onError(`You can attach at most ${MAX_VIDEOS} video.`);
        continue;
      }
      if (!isVideo && next.filter(m => !m.isVideo).length >= MAX_IMAGES) {
        onError(`You can attach at most ${MAX_IMAGES} photos.`);
        continue;
      }
      const limitMb = isVideo ? MAX_VIDEO_MB : MAX_IMAGE_MB;
      if (file.size > limitMb * 1024 * 1024) {
        onError(`"${file.name}" is too large. The limit is ${limitMb}MB.`);
        continue;
      }
      next.push({ file, url: URL.createObjectURL(file), isVideo });
    }
    onChange(next);
    if (inputRef.current) inputRef.current.value = '';
  };

  const remove = (idx: number) => {
    URL.revokeObjectURL(media[idx].url);
    onChange(media.filter((_, i) => i !== idx));
  };

  return (
    <div className="mt-3">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        className="hidden"
        onChange={e => addFiles(e.target.files)}
      />
      <div className="flex flex-wrap items-center gap-2">
        {media.map((m, idx) => (
          <div key={m.url} className="relative h-16 w-16">
            {m.isVideo ? (
              <video src={m.url} className="h-16 w-16 rounded-md border border-gray-200 object-cover" muted />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={m.url} alt="" className="h-16 w-16 rounded-md border border-gray-200 object-cover" />
            )}
            <button
              type="button"
              aria-label="Remove attachment"
              onClick={() => remove(idx)}
              className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-gray-900 text-[10px] leading-none text-white"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex h-16 w-16 flex-col items-center justify-center gap-0.5 rounded-md border border-dashed border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-700"
        >
          <span className="text-lg leading-none">📷</span>
          <span className="text-[9px]">Add</span>
        </button>
        {media.length === 0 && (
          <span className="text-xs text-gray-500">{label} (optional)</span>
        )}
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="mx-auto max-w-lg rounded-xl bg-white p-6 shadow-sm">{children}</div>
    </main>
  );
}
