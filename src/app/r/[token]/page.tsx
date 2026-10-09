'use client';

import { useEffect, useState, use, useRef } from 'react';
import { RatingStar } from '@/components/app/ui-kit';
import { BRAND_ASSETS, type StarStyle } from '@/lib/brand';

/**
 * Public review submission page.
 *
 * Reached by the buyer from the email sent after their order was fulfilled. No login:
 * the single-use token in the URL is the authorisation.
 *
 * This page is the merchant's brand in front of their customer, on a domain the customer
 * does not recognise, minutes after they were asked for a favour. It has to look like it
 * belongs to a real business or the review does not get written — so it gets the same
 * design treatment as the admin, not a bare form.
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
  /** The store's star shape and colour, so this page matches its storefront widget. */
  starStyle?: string;
  starColor?: string;
  /**
   * The store's active review incentive, with its disclosure, when its plan includes one.
   * Shown before the buyer writes, as the storefront widget shows it: FTC 16 CFR 465 wants
   * the offer disclosed where it is made, and the thank-you code otherwise arrived
   * unannounced. Older responses have no such key; nothing is shown then.
   */
  offer?: { offer: string; disclosure: string; requiresMedia: boolean } | null;
  /** False on a white-label plan, where the same badge is left out of the email too. */
  showBadge?: boolean;
}

interface Attachment { file: File; url: string; isVideo: boolean }
interface ItemForm { rating: number; title: string; body: string; media: Attachment[] }

// Mirrors the server's caps in src/lib/media.ts. The server is the rule; these exist so
// a buyer hears "that video is too large" the moment they pick it, not after uploading.
const MAX_IMAGES = 5;
const MAX_VIDEOS = 1;
const MAX_IMAGE_MB = 10;
const MAX_VIDEO_MB = 50;

const RATING_WORDS = ['', 'Not for me', 'Could be better', 'It’s fine', 'Really good', 'Love it'];

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
    setLoadError(null);
    try {
      const entries = Object.entries(forms).filter(([, f]) => f.body.trim());

      if (entries.length === 0) {
        setLoadError('Please write a few words before submitting.');
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
    return (
      <Shell>
        {/* A static skeleton with a status line (Marka guidelines: no looping motion). */}
        <div className="space-y-4" role="status" aria-busy="true">
          <span className="sr-only">Loading your order…</span>
          <div className="h-6 w-2/3 rounded-lg bg-slate-100" />
          <div className="h-4 w-1/2 rounded-lg bg-slate-100" />
          <div className="h-40 rounded-2xl bg-slate-100" />
        </div>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell showBadge={data?.showBadge !== false}>
        <div className="py-8 text-center">
          <div className="mx-auto mb-5 w-fit">
            {/* Success: the guideline green, with the tick and the heading below saying it too. */}
            <div className="flex size-16 items-center justify-center rounded-2xl bg-[#19734B] text-white">
              <svg viewBox="0 0 24 24" className="size-8" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
          </div>
          <h1 className="text-[22px] font-bold tracking-tight text-slate-900">Thank you</h1>
          <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-slate-500">
            Your review has been sent to {data?.storeName ?? 'the store'}. It will appear on
            their store once they have read it.
          </p>
        </div>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <div className="py-8 text-center">
          <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
            <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4M12 16h.01" />
            </svg>
          </div>
          <h1 className="text-[18px] font-semibold text-slate-900">This link is not available</h1>
          <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-slate-500">{loadError}</p>
        </div>
      </Shell>
    );
  }

  const allowPhotos = data.allowPhotos !== false;
  const allowVideo = data.allowVideo !== false;
  const allowMedia = allowPhotos || allowVideo;
  const ready = Object.values(forms).some(f => f.body.trim());
  const starVariant: StarStyle = data.starStyle === 'classic' ? 'classic' : 'tick';

  return (
    <Shell showBadge={data.showBadge !== false}>
      <div className="text-center">
        {/* The store's star, as on its storefront: its shape AND its colour. The rating
            buttons below already used both; this mark was a fixed amber classic star or the
            raw tick-star PNG, so a store with red stars saw an amber one at the top. */}
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-[#1B3358]">
          <RatingStar size={26} color={data.starColor} variant={starVariant} />
        </div>
        <h1 className="text-[24px] font-bold leading-tight tracking-tight text-slate-900">
          How was your order?
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-[14px] leading-relaxed text-slate-500">
          {data.customerName ? `Thanks ${data.customerName} — ` : ''}
          <strong className="font-semibold text-slate-700">{data.storeName}</strong> would love
          to hear what you thought
          {data.orderNumber ? ` of order #${data.orderNumber}` : ''}.
        </p>
      </div>

      {loadError && (
        <p className="mt-5 rounded-xl bg-rose-50 px-3.5 py-2.5 text-[13px] font-medium text-rose-700 ring-1 ring-inset ring-rose-600/15">
          {loadError}
        </p>
      )}

      {/* The store's review incentive, before the buyer writes — as the storefront widget
          shows it (.rm-offer), and for the same reason: the offer is disclosed where it is
          made (FTC 16 CFR 465), and the reviews written from this email are the ones it
          rewards, so a buyer who was never told about it got the thank-you code unannounced. */}
      {data.offer?.offer && (
        <div
          role="note"
          className="mt-6 rounded-xl border border-dashed border-[#1B3358] bg-[#FDF1DE]/40 px-4 py-3"
        >
          <p className="text-[14px] font-semibold text-slate-900">{data.offer.offer}</p>
          {data.offer.disclosure && (
            <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">{data.offer.disclosure}</p>
          )}
        </div>
      )}

      <div className="mt-7 space-y-4">
        {data.items.map((item, i) => {
          const key = item.productId ?? `item-${i}`;
          const f = forms[key] ?? { rating: 5, title: '', body: '', media: [] };
          const set = (patch: Partial<ItemForm>) =>
            setForms(prev => ({ ...prev, [key]: { ...f, ...patch } }));

          return (
            <div
              key={key}
              className="rounded-2xl border border-slate-200 bg-white p-5"
              style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,.9), 0 1px 2px -1px rgba(11,18,32,.08), 0 4px 12px -3px rgba(11,18,32,.07)' }}
            >
              <div className="flex items-center gap-3">
                {item.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image}
                    alt=""
                    className="size-14 rounded-xl object-cover ring-1 ring-inset ring-black/[0.06]"
                  />
                ) : (
                  <div className="flex size-14 items-center justify-center rounded-xl bg-slate-100 text-slate-300">
                    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.8}>
                      <path d="M3 3h18v18H3zM3 15l5-5 4 4 3-3 6 6" />
                    </svg>
                  </div>
                )}
                <p className="min-w-0 flex-1 text-[14.5px] font-semibold leading-snug text-slate-900">
                  {item.title}
                </p>
              </div>

              {/* ── Rating ── */}
              <div className="mt-4">
                <div className="flex flex-wrap items-center gap-1">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      type="button"
                      aria-label={`${n} star${n === 1 ? '' : 's'}`}
                      aria-pressed={n === f.rating}
                      onClick={() => set({ rating: n })}
                      className="ring-focus rounded-md p-1.5"
                    >
                      <RatingStar size={32} fill={n <= f.rating ? 1 : 0} variant={starVariant} color={data.starColor} />
                    </button>
                  ))}
                  {/* Kept on one line; on a narrow phone it moves under the stars instead of
                      breaking mid-phrase. Announced, since the stars change it. */}
                  <span aria-live="polite" className="ml-2 whitespace-nowrap text-[13px] font-medium text-slate-600">
                    {RATING_WORDS[f.rating]}
                  </span>
                </div>
              </div>

              <input
                value={f.title}
                onChange={e => set({ title: e.target.value })}
                placeholder="Sum it up in a few words (optional)"
                maxLength={200}
                className="mt-4 h-11 w-full rounded-xl border border-slate-400 px-3.5 text-[14px] text-slate-900 placeholder:text-slate-500 focus:border-[#1B3358] focus:outline-none focus:ring-2 focus:ring-[#FFC24B]"
              />
              <textarea
                value={f.body}
                onChange={e => set({ body: e.target.value })}
                placeholder="What did you think? What would you tell a friend who was considering it?"
                rows={4}
                maxLength={5000}
                className="mt-2.5 w-full resize-y rounded-xl border border-slate-400 px-3.5 py-3 text-[14px] leading-relaxed text-slate-900 placeholder:text-slate-500 focus:border-[#1B3358] focus:outline-none focus:ring-2 focus:ring-[#FFC24B]"
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
        disabled={submitting || !ready}
        className="brand-fill ring-focus mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[15px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
      >
        {submitting ? (
          <>
            <svg viewBox="0 0 24 24" className="size-4 animate-spin" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            Sending…
          </>
        ) : (
          'Submit review'
        )}
      </button>

      <p className="mt-4 text-center text-[11.5px] leading-relaxed text-slate-400">
        You are reviewing a purchase you made from {data.storeName}.
        <br />
        This link is personal to your order — please don&apos;t forward it.
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
        onError(`“${file.name}” is too large. The limit is ${limitMb}MB.`);
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
    <div className="mt-4">
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
          <div key={m.url} className="relative size-[68px]">
            {m.isVideo ? (
              <video
                src={m.url}
                className="size-[68px] rounded-xl object-cover ring-1 ring-inset ring-black/[0.06]"
                muted
                playsInline
                preload="metadata"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={m.url}
                alt=""
                className="size-[68px] rounded-xl object-cover ring-1 ring-inset ring-black/[0.06]"
              />
            )}
            <button
              type="button"
              aria-label="Remove attachment"
              onClick={() => remove(idx)}
              className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-slate-900 text-[11px] leading-none text-white shadow-md transition-transform hover:scale-110"
            >
              ✕
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex size-[68px] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 transition-colors hover:border-[#1B3358] hover:bg-[#FDF1DE] hover:text-[#1B3358] ring-focus"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round">
            <rect x="3" y="6" width="18" height="14" rx="2" />
            <circle cx="12" cy="13" r="3" />
            <path d="M8 6l1.5-2h5L16 6" />
          </svg>
          <span className="text-[9.5px] font-medium">Add</span>
        </button>
      </div>

      <p className="mt-2 text-[11.5px] text-slate-400">
        {media.length === 0
          ? `${label} — optional, but reviews with photos are far more useful to other shoppers.`
          : `${media.length} attached`}
      </p>
    </div>
  );
}

/**
 * `showBadge` is false on a white-label plan. The email that brought the buyer here leaves
 * the badge out for those plans, and a Marka-branded page right after a branding-free email
 * is what white label is paid to avoid. On by default, for the loading and error states,
 * where the plan is not known yet.
 */
function Shell({ children, showBadge = true }: { children: React.ReactNode; showBadge?: boolean }) {
  return (
    <main className="relative min-h-screen bg-slate-50 px-4 py-10 sm:py-14">
      {/* The same ambient wash as the admin, so a merchant who sees both recognises them
          as one product. Fixed and behind everything; costs nothing to paint. */}
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            'radial-gradient(50rem 32rem at 15% -5%, rgba(255,194,75,0.12), transparent 60%), radial-gradient(44rem 30rem at 100% 5%, rgba(27,51,88,0.06), transparent 60%)',
        }}
      />
      <div
        className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-6 sm:p-8"
        style={{
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,.9), 0 4px 8px -4px rgba(11,18,32,.1), 0 16px 32px -10px rgba(11,18,32,.14), 0 40px 72px -28px rgba(11,18,32,.2)',
        }}
      >
        {children}
      </div>
      {/* The brand badge. Reviews written here come from a real order, which is exactly
          what it stands for. */}
      {showBadge && (
        <img
          src={BRAND_ASSETS.badge}
          alt="Verified by Marka"
          width={96}
          height={32}
          className="mx-auto mt-6 block h-8 w-auto rounded-md opacity-90"
        />
      )}
    </main>
  );
}
