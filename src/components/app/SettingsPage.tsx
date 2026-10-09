'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Settings, Bell, Palette, CheckCircle, CreditCard, Crown, AlertTriangle,
  RotateCcw, Send, Loader2, Check, Sparkles, Mail, Clock, Eye, Code2, Compass,
  ShieldCheck, SlidersHorizontal, Camera, BookOpen, ArrowUpRight, Globe, Copy,
  Plug, RefreshCw, MessageSquare, Gift, ChevronRight, Video,
} from 'lucide-react';
import { useConfirm } from './confirm';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { apiFetch, ApiError, errorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import type { Navigate, PageId } from './TopNav';
import { adminUrl, navigateTop, PENDING_PLAN_KEY } from '@/lib/admin-links';
import { Panel, PanelHeader, Tile, Pill, Meter, ActionButton, Skeleton, Stars, VerifiedMark, EmptyState } from './ui-kit';
import { BRAND, contrastRatio, pairedCardText, pairedCardBackground, FONT_FAMILY_PATTERN as FONT_FAMILY } from '@/lib/brand';
import { describeRequests } from './RequestPerformance';

// Mirrors src/lib/plans.ts. Prices and limits must match the server, which is what
// actually enforces them — this list is presentation only.
const plans = [
  {
    id: 'free', name: 'Free', price: 0, interval: 'month',
    features: [
      'Unlimited reviews',
      '100 review request emails a month',
      'Import from CSV, AliExpress & Etsy',
      'All 9 widget layouts',
      'Photo reviews',
      'Google rich snippets',
    ],
    color: '',
  },
  {
    id: 'growth', name: 'Growth', price: 12, interval: 'month',
    features: [
      '1,000 review request emails a month',
      'Everything in Free',
      'Video reviews',
      'Automatic reminders',
      'Review incentives',
      'Questions & answers',
      // "Shop app sync" is not sold here, and will not be until it can actually run.
      //
      // The syndication code in src/lib/syndication.ts is real and gated correctly, but
      // it needs write_product_reviews and read_metaobjects, which Shopify only grants
      // after approving the Standard Product Review Syndication Program. Until then the
      // scopes are deliberately unrequested (see DEFAULT_SCOPES), nothing sets the
      // syndication_enabled flag, and the feature cannot be switched on by anyone.
      //
      // Selling it in the meantime is a pricing-accuracy violation and, worse, a promise
      // to a paying merchant that nothing in the product can keep. It goes back on this
      // list the day the programme approval lands.
      'Google Shopping star ratings',
      'Marka Reviews branding removed',
    ],
    color: 'is-selected', popular: true,
  },
  {
    id: 'scale', name: 'Scale', price: 39, interval: 'month',
    features: [
      'Unlimited review request emails',
      'Everything in Growth',
      'Priority support',
    ],
    color: '',
  },
];

/** One segmented-control tab. The active state is a raised chip inside the trough. */
const tabTrigger = cn(
  'h-8 flex-1 gap-1.5 rounded-[10px] border-transparent px-3 text-[12.5px] font-semibold',
  'text-ink-500 transition-all dark:text-ink-400',
  'data-[state=active]:rounded-[10px] data-[state=active]:border-transparent data-[state=active]:bg-card',
  'data-[state=active]:text-ink-900 data-[state=active]:shadow-[var(--elev-1)]',
  'dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-card dark:data-[state=active]:text-white'
);

/** Plan order, for "is this an upgrade or a downgrade". Mirrors PLANS in src/lib/plans.ts. */
const PLAN_RANK: Record<string, number> = { free: 0, growth: 1, scale: 2 };
const rankOf = (planId: string) => PLAN_RANK[planId] ?? 0;
/** The plan's name as the merchant sees it, never the raw id ("Growth", not "growth"). */
const planLabel = (planId: string) => plans.find(p => p.id === planId)?.name ?? planId;

/** The Settings tabs a link may ask for by name (`?tab=`). */
const TAB_IDS = ['general', 'display', 'notifications', 'integrations', 'subscription'];

interface Usage {
  plan: string;
  planLabel: string;
  /** What the merchant pays: 0 on Free, and 0 on a complimentary plan. */
  price: number;
  /** True when the plan in force is one given free of charge by Marka. */
  complimentary?: boolean;
  /**
   * The plan Marka gave this store free, whether or not it is the one in force — a store
   * given Growth can still pay for Scale. Optional because the server may not send it yet;
   * without it the gift is only known while it is the plan in force (`complimentary`).
   */
  complimentaryPlan?: string | null;
  /** The meter: review request emails sent this calendar month. */
  requests: { used: number; limit: number | null; percentUsed: number; resetsAt: string };
  reviews: { used: number; limit: number | null; percentUsed: number };
  widgets: { used: number; limit: number | null; percentUsed: number };
  /** Mirrors PlanLimits' boolean flags. The server is what enforces them. */
  features?: Record<string, boolean>;
}

/**
 * The config shape returned by /api/storefront-config. Mirrors StorefrontConfig in
 * src/lib/storefront-config.ts — that file is the source of truth for what is valid; this
 * is the client's view of it.
 */
interface StorefrontConfig {
  colors: Record<string, string>;
  layout: Record<string, string | number | boolean>;
  text: Record<string, string>;
  behaviour: Record<string, string | number | boolean>;
  customCss: string;
}

interface NotificationSettings {
  newReview: boolean;
  negativeReview: boolean;
  weeklySummary: boolean;
  negativeThreshold: number;
  email: string;
}

/**
 * One line of a settings list: label and helper on the left, the control hard right.
 * Every row in this page is this shape, which is what makes a long form scannable.
 */
function SettingRow({
  title, description, htmlFor, children, className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  htmlFor?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('px-5 py-3.5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-[240px]">
          {htmlFor ? (
            <Label htmlFor={htmlFor} className="block text-[13px] font-semibold text-ink-900 dark:text-white">
              {title}
            </Label>
          ) : (
            <p className="text-[13px] font-semibold text-ink-900 dark:text-white">{title}</p>
          )}
          {description && (
            <p className="mt-0.5 text-[12.5px] leading-snug text-ink-500">{description}</p>
          )}
        </div>
        {children && <div className="shrink-0">{children}</div>}
      </div>
    </div>
  );
}

/** A labelled switch row. Repeated fifteen times otherwise. */
function ToggleRow({
  title, description, checked, onChange, disabled,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <SettingRow title={title} description={description}>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </SettingRow>
  );
}

/**
 * A colour picker that understands "not set".
 *
 * cardBg, cardText and border default to null, meaning the widget inherits the merchant's
 * theme. `<input type="color">` has no null state — it must be given a hex — so an
 * unset colour shows a neutral swatch and the row says it is following the theme. Touching
 * the picker is what opts into an explicit colour; Reset puts it back to inheriting.
 */
function ColorRow({
  label, value, onChange, inheritable = false,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  inheritable?: boolean;
}) {
  const isInherited = value === null;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-[12.5px] font-semibold text-ink-700 dark:text-ink-200">{label}</Label>
        {inheritable && !isInherited && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[11.5px] font-medium text-ink-400 hover:text-ink-600 dark:hover:text-ink-200"
          >
            Use theme colour
          </button>
        )}
      </div>
      <div className="mt-1.5 flex gap-2">
        <input
          type="color"
          value={value ?? '#FFFFFF'}
          onChange={e => onChange(e.target.value)}
          className="ring-focus size-10 shrink-0 cursor-pointer rounded-xl border border-border p-0"
          aria-label={label}
        />
        <Input
          className="h-10 flex-1 rounded-xl font-mono text-[13px]"
          value={value ?? ''}
          placeholder={inheritable ? 'Follows your theme' : ''}
          onChange={e => onChange(e.target.value || (inheritable ? null : ''))}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

/**
 * Contrast checks for the storefront colours, with a one-click fix for each.
 *
 * The brand guidelines ask for a "fixable contrast warning" wherever a merchant can restyle
 * a widget: customising must not leave text unreadable. Text pairs are held to WCAG's
 * 4.5:1. The labels on buttons are always white, so the accent is checked against white.
 */
function ContrastNotes({
  colors,
  onFix,
}: {
  colors: StorefrontConfig['colors'];
  onFix: (changes: Array<[string, string | null]>) => void;
}) {
  const issues: Array<{ what: string; ratio: number; fix: string; changes: Array<[string, string | null]> }> = [];
  const button = contrastRatio('#FFFFFF', colors.accent);
  if (button != null && button < 4.5) {
    issues.push({ what: 'White button labels on your accent colour', ratio: button, fix: 'Use Marka Navy', changes: [['accent', BRAND.navy]] });
  }
  const badge = contrastRatio(colors.verifiedText, colors.verifiedBg);
  if (badge != null && badge < 4.5) {
    issues.push({ what: 'The "Verified Purchase" label on its badge colour', ratio: badge, fix: 'Use Marka Navy', changes: [['verifiedBg', BRAND.navy]] });
  }
  if (colors.cardBg && colors.cardText) {
    const card = contrastRatio(colors.cardText, colors.cardBg);
    if (card != null && card < 4.5) {
      issues.push({ what: 'Review text on your card background', ratio: card, fix: 'Use theme colours', changes: [['cardBg', null], ['cardText', null]] });
    }
  }
  if (!issues.length) return null;
  return (
    <div role="status" className="mt-4 space-y-2">
      {issues.map((i) => (
        <div
          key={i.what}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-700/30 bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-800"
        >
          <span className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              <strong className="font-semibold">Hard to read:</strong> {i.what} measure{' '}
              <span className="tnum">{i.ratio.toFixed(1)}:1</span>; text needs 4.5:1.
            </span>
          </span>
          <button
            type="button"
            onClick={() => onFix(i.changes)}
            className="ring-focus cream-fill h-8 shrink-0 rounded-lg px-3 text-[12px] font-semibold"
          >
            {i.fix}
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * What a tab shows while its own data is still on the way, or after that load failed.
 *
 * Each tab waits only for what it needs. The page used to gate EVERY tab on one
 * Promise.all of storefront-config and notifications: if either request failed, the error
 * was toasted and the whole page sat on a skeleton with nothing to click — including the
 * Plan tab, which needs neither. A merchant hit by a blip on either endpoint could not
 * reach the payment screen until they reloaded the entire admin frame.
 */
function TabFallback({
  what, error, onRetry, note = 'Nothing has changed. The other tabs still work.', panels = 2,
}: {
  what: string;
  error: string | null;
  onRetry: () => void;
  /** Under the Retry button. A fallback for one panel of a tab says the rest of the tab works. */
  note?: string;
  /** Skeleton panels while loading: as many as the loaded content has, so nothing jumps. */
  panels?: number;
}) {
  if (error) {
    return (
      <Panel>
        <EmptyState
          icon={AlertTriangle}
          tone="amber"
          title={`Could not load ${what}`}
          description={error}
          action={
            <ActionButton variant="outline" icon={RotateCcw} onClick={onRetry}>
              Try again
            </ActionButton>
          }
          secondary={note}
        />
      </Panel>
    );
  }
  return (
    // Static, as the guidelines ask of loading states; the status line says what is happening.
    <div className="space-y-4" role="status" aria-busy="true">
      <span className="sr-only">Loading {what}…</span>
      {Array.from({ length: panels }, (_, i) => (
        <Panel key={i} className="p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-xl" />
            <div className="space-y-2">
              <Skeleton className="h-3.5 w-40" />
              <Skeleton className="h-2.5 w-64" />
            </div>
          </div>
          <div className="mt-5 space-y-4">
            {[0, 1, 2].map(r => (
              <div key={r} className="flex items-center justify-between gap-4">
                <div className="w-full space-y-2">
                  <Skeleton className="h-3 w-44" />
                  <Skeleton className="h-2.5 w-72" />
                </div>
                <Skeleton className="h-5 w-9 rounded-full" />
              </div>
            ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}

/** Usage against a plan limit. `null` limit means unlimited, so the bar stays empty. */
function UsageBar({
  label, used, limit, percent, tone,
}: {
  label: string;
  used: number;
  limit: number | null;
  percent: number;
  tone: 'brand' | 'amber' | 'rose' | 'indigo';
}) {
  return (
    <div className="rounded-xl border border-border bg-ink-50/70 p-3.5 dark:bg-white/[0.03]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-ink-700 dark:text-ink-200">{label}</span>
        <span className="tnum text-[12px] text-ink-500">{used} of {limit ?? 'unlimited'}</span>
      </div>
      <Meter value={limit == null ? 0 : percent} tone={tone} height={6} className="mt-2.5" />
    </div>
  );
}

/**
 * Field names as the merchant sees them, for reporting a clamped value back. Keyed by the
 * server's field name so the two cannot drift apart silently.
 */
const TIMING_LABELS: Record<string, string> = {
  delayDays: 'Days after fulfilment',
  reminders: 'Reminders',
  reminderGapDays: 'Days between sends',
};

/** /api/request-settings' settings, with the plan's answer on reminders folded in. */
interface RequestSettingsState {
  enabled: boolean;
  requireMarketingConsent: boolean;
  delayDays: number;
  reminders: number;
  reminderGapDays: number;
  /** False on a plan that sends no reminders; undefined if the server did not say. */
  remindersAllowed?: boolean;
}

/** What GET and PUT /api/request-settings answer, as far as this page reads it. */
interface RequestSettingsBody {
  settings: Omit<RequestSettingsState, 'remindersAllowed'>;
  remindersAllowed?: boolean;
}

const withPlan = (r: RequestSettingsBody): RequestSettingsState => {
  // A 200 without settings is not settings. Spreading it anyway produced a truthy state of
  // undefineds, which skipped the load-failure fallback and rendered controls with no values.
  if (typeof r?.settings?.delayDays !== 'number') throw new Error('Could not load your review request settings.');
  return { ...r.settings, remindersAllowed: r.remindersAllowed };
};

export default function SettingsPage({
  onNavigate,
  storeDomain,
  initialTab,
  usageVersion = 0,
  onPlanChangeStarted,
}: {
  onNavigate?: Navigate;
  storeDomain?: string;
  initialTab?: string;
  /** Bumped by the shell when it learns the plan changed (a payment settling), so the Plan tab fetches again. */
  usageVersion?: number;
  /**
   * Called before this page changes the plan. The shell may still be checking on a
   * previous return from Shopify; a check that finished after this change would announce
   * the old answer ("no change — still on Growth") over the new one.
   */
  onPlanChangeStarted?: () => void;
}) {
  const confirm = useConfirm();
  const [config, setConfig] = useState<StorefrontConfig | null>(null);
  const [notif, setNotif] = useState<NotificationSettings | null>(null);
  const [reqSettings, setReqSettings] = useState<RequestSettingsState | null>(null);
  const [dirtyReq, setDirtyReq] = useState<Record<string, string>>({});
  const [mailProvider, setMailProvider] = useState<string | null>(null);
  const [fallbackEmail, setFallbackEmail] = useState<string | null>(null);
  // One failure flag per load, so each tab can say what went wrong with ITS data and offer
  // a retry, instead of one toast and a page-wide skeleton. Null while loading or loaded.
  const [configError, setConfigError] = useState<string | null>(null);
  const [notifError, setNotifError] = useState<string | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [reqError, setReqError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Three states, not two. `undefined` means we have not been able to find out — still
  // loading, or the request failed. `null` means the server told us no token exists.
  // Collapsing those, as this did, is how a merchant with a live Merchant Center feed
  // gets shown "Not set up yet" during a deploy blip and rotates their working URL out
  // from under Google by clicking the obvious button.
  const [feedUrl, setFeedUrl] = useState<string | null | undefined>(undefined);
  const [feedLoadFailed, setFeedLoadFailed] = useState(false);
  const [feedBusy, setFeedBusy] = useState(false);
  const [feedCopied, setFeedCopied] = useState(false);
  const [testing, setTesting] = useState(false);
  const [usage, setUsage] = useState<Usage | null>(null);

  /**
   * Tabs are controlled rather than uncontrolled, for three reasons: the Plan tab links
   * straight to the features a plan unlocks; a merchant returning from Shopify's approval
   * screen is dropped on the Plan tab with `?upgraded=1` so the thing they just paid for
   * is the first thing they see; and a link elsewhere in the app that promises
   * "Settings → Notifications" arrives with `?tab=notifications` and lands there.
   */
  const [tab, setTab] = useState<string>(() => {
    if (typeof window === 'undefined') return initialTab ?? 'general';
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgraded') === '1') return 'subscription';
    const asked = params.get('tab');
    if (asked && TAB_IDS.includes(asked)) return asked;
    return initialTab ?? 'general';
  });
  const [justUpgraded, setJustUpgraded] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('upgraded') === '1';
  });

  // Clear the markers from the URL once they have been read, so a reload or a shared link
  // does not keep announcing an upgrade that happened days ago, or keep forcing the tab a
  // link once asked for over the one the merchant has since chosen.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('upgraded') && !params.has('tab')) return;
    params.delete('upgraded');
    params.delete('tab');
    const rest = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
  }, []);
  const [upgrading, setUpgrading] = useState<string | null>(null);

  // Only what the merchant actually changed is sent. Sending the whole config on every
  // save would write ~70 rows per click and, worse, would persist every default as an
  // explicit override — so a later change to a default would never reach existing stores.
  const [dirty, setDirty] = useState<Record<string, string>>({});
  const [dirtyNotif, setDirtyNotif] = useState<Record<string, string>>({});

  // What the server last returned for each group: set by every successful load and save,
  // read only by Discard. The setters below write each edit into config / notif /
  // reqSettings, which is what the controls show, as well as into the dirty maps — so
  // clearing the maps alone left the edited values on screen while the server still had
  // the old ones.
  const savedConfig = useRef<StorefrontConfig | null>(null);
  const savedNotif = useRef<NotificationSettings | null>(null);
  const savedReq = useRef<RequestSettingsState | null>(null);

  // Four loads, each on its own. Nothing here sets state synchronously: these run from an
  // effect body, and a synchronous setState there is a cascading render — which is what
  // react-hooks/set-state-in-effect flags. The Retry buttons clear their error flag
  // themselves before calling back in, which is what puts the skeleton back.
  const loadConfig = useCallback(
    () =>
      apiFetch<{ config: StorefrontConfig }>('/api/storefront-config')
        .then(c => {
          savedConfig.current = c.config;
          setConfig(c.config);
          setConfigError(null);
          setDirty({});
        })
        .catch(err => setConfigError(errorMessage(err, 'Could not load your storefront settings.'))),
    []
  );
  const loadNotif = useCallback(
    () =>
      apiFetch<{
        settings: NotificationSettings;
        provider: string | null;
        fallbackEmail: string | null;
      }>('/api/notifications')
        .then(n => {
          savedNotif.current = n.settings;
          setNotif(n.settings);
          setMailProvider(n.provider);
          setFallbackEmail(n.fallbackEmail);
          setNotifError(null);
          setDirtyNotif({});
        })
        .catch(err => setNotifError(errorMessage(err, 'Could not load your notification settings.'))),
    []
  );
  const loadUsage = useCallback(
    () =>
      apiFetch<Usage>('/api/usage')
        .then(u => {
          setUsage(u);
          setUsageError(null);
        })
        .catch(err => {
          setUsage(null);
          setUsageError(errorMessage(err, 'Could not load your plan.'));
        }),
    []
  );
  // A failure here gets its own error and Retry like the others. It used to be swallowed,
  // and the timing controls then showed the defaults (ON, 14 days, 1 reminder) as if they
  // were the store's — editable, so a save could write values the merchant never saw.
  const loadRequestSettings = useCallback(
    () =>
      apiFetch<RequestSettingsBody>('/api/request-settings')
        .then(r => {
          const settings = withPlan(r);
          savedReq.current = settings;
          setReqSettings(settings);
          setReqError(null);
          setDirtyReq({});
        })
        .catch(err => setReqError(errorMessage(err, 'Could not load your review request settings.'))),
    []
  );

  const load = useCallback(() => {
    loadConfig();
    loadNotif();
    loadUsage();
    loadRequestSettings();
  }, [loadConfig, loadNotif, loadUsage, loadRequestSettings]);

  useEffect(load, [load]);

  // The shell saw the plan change (a payment that took a moment to settle): read the
  // plan again so the header and the cards agree with the chip above them, and announce
  // the unlock the way a normal return from Shopify would.
  //
  // Only a change while this page is open counts. The shell keeps usageVersion for the
  // whole session and this page mounts afresh on every visit, so reacting to the value it
  // mounted with announced "You just unlocked these" on every visit after the first.
  // Whether reminders are allowed is a plan fact, read with the request settings. When the
  // plan changes under a mounted page — an upgrade that settles, a switch from this page —
  // fold the new answer in, or the reminder controls stay locked after paying for them.
  const applyPlanToRequests = useCallback((u: Usage) => {
    const allowed = u.features?.reminderEmails;
    if (typeof allowed !== 'boolean') return;
    setReqSettings(s => (s ? { ...s, remindersAllowed: allowed } : s));
    if (savedReq.current) savedReq.current = { ...savedReq.current, remindersAllowed: allowed };
  }, []);

  // The plan on screen, readable from the effect below without making it a dependency.
  const planShownRef = useRef(usage?.plan ?? 'free');
  useEffect(() => {
    planShownRef.current = usage?.plan ?? 'free';
  }, [usage?.plan]);
  const seenUsageVersion = useRef(usageVersion);
  useEffect(() => {
    if (usageVersion === seenUsageVersion.current) return;
    seenUsageVersion.current = usageVersion;
    apiFetch<Usage>('/api/usage')
      .then(u => {
        // "You just unlocked these" only for a move UP from what this page was showing. A
        // settled move down (Scale -> Growth) is a change too, and is not an unlock.
        const before = planShownRef.current;
        setUsage(u);
        setUsageError(null);
        applyPlanToRequests(u);
        if (rankOf(u.plan) > rankOf(before)) setJustUpgraded(true);
      })
      .catch(() => undefined);
  }, [usageVersion, applyPlanToRequests]);

  const currentPlan = usage?.plan ?? 'free';
  const complimentary = usage?.complimentary === true;
  /**
   * The plan Marka gave this store free, if any. Taken from the API when it says; failing
   * that, known only while it is the plan in force. A store given Growth that pays for
   * Scale is therefore only recognised as gifted when the server exposes the field — see
   * the Usage type.
   */
  const giftPlan: string | null = usage?.complimentaryPlan ?? (complimentary ? currentPlan : null);
  /**
   * Plans the gift already covers and that the merchant is not paying above: nothing to
   * do on those cards. Never the current plan itself (that card says "Current plan"), and
   * never while the store pays for a plan above the gift — then the cards at or below
   * the gift are the way to stop paying, and must stay clickable.
   */
  const includedFree = (planId: string) =>
    giftPlan !== null &&
    planId !== currentPlan &&
    rankOf(planId) <= rankOf(giftPlan) &&
    rankOf(currentPlan) <= rankOf(giftPlan);

  /**
   * Entitled features that have somewhere to go, in the order a merchant meets them.
   *
   * Driven by `usage.features` — the same flags the server gates on — rather than a
   * hardcoded per-plan list, so this cannot drift from what the merchant actually has.
   * Anything without a destination (unlimited reviews, a bigger send quota) is left out:
   * a row that goes nowhere teaches people the rows are not worth clicking.
   */
  const unlocked = (
    [
      { key: 'googleFeed', label: 'Google Shopping star ratings', where: 'Settings → Integrations', icon: Globe, tone: 'cyan' as const, go: () => setTab('integrations') },
      { key: 'questionsAndAnswers', label: 'Questions & answers', where: 'The Questions screen', icon: MessageSquare, tone: 'indigo' as const, go: () => onNavigate?.('questions') },
      { key: 'incentives', label: 'Review incentives', where: 'The Incentives screen', icon: Gift, tone: 'amber' as const, go: () => onNavigate?.('incentives') },
      { key: 'videoReviews', label: 'Video reviews', where: 'Settings → General → What shoppers can attach', icon: Video, tone: 'violet' as const, go: () => setTab('general') },
      { key: 'reminderEmails', label: 'Automatic reminders', where: 'Settings → Notifications → Review request timing', icon: Clock, tone: 'brand' as const, go: () => setTab('notifications') },
    ] as const
  ).filter(f => usage?.features?.[f.key]);

  // ── Config editing ────────────────────────────────────────────────────────────────
  const setBehaviour = (field: string, value: string | number | boolean) => {
    setConfig(c => (c ? { ...c, behaviour: { ...c.behaviour, [field]: value } } : c));
    setDirty(d => ({ ...d, [`sf.behaviour.${field}`]: String(value) }));
  };
  /**
   * `null` means "inherit from the merchant's theme" and is a real, savable value for
   * cardBg / cardText / border. It is persisted as an empty string, which is what
   * getStorefrontConfig reads back as null.
   */
  const setColor = (field: string, value: string | null) => {
    setConfig(c => (c ? ({ ...c, colors: { ...c.colors, [field]: value } } as StorefrontConfig) : c));
    setDirty(d => ({ ...d, [`sf.color.${field}`]: value ?? '' }));
  };
  const setLayout = (field: string, value: string | number | boolean) => {
    setConfig(c => (c ? { ...c, layout: { ...c.layout, [field]: value } } : c));
    setDirty(d => ({ ...d, [`sf.layout.${field}`]: String(value) }));
  };
  const setCss = (value: string) => {
    setConfig(c => (c ? { ...c, customCss: value } : c));
    setDirty(d => ({ ...d, 'sf.customCss': value }));
  };
  const setNotifField = (field: keyof NotificationSettings, value: string | number | boolean) => {
    setNotif(n => (n ? { ...n, [field]: value } : n));
    setDirtyNotif(d => ({ ...d, [`notify.${field}`]: String(value) }));
  };

  const setReqFlag = (field: 'enabled' | 'requireMarketingConsent', value: boolean) => {
    setReqSettings(s => (s ? { ...s, [field]: value } : s));
    setDirtyReq(d => ({ ...d, [`requests.${field}`]: value ? '1' : '0' }));
  };
  const setReqField = (field: 'delayDays' | 'reminders' | 'reminderGapDays', value: number) => {
    setReqSettings(r => (r ? { ...r, [field]: value } : r));
    setDirtyReq(d => ({ ...d, [`requests.${field}`]: String(value) }));
  };

  const bool = (v: unknown) => v === true || v === 'true';
  const b = (field: string) => bool(config?.behaviour[field]);
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  // The storefront's star shape, badge icon and font: the Marka look unless changed.
  const starStyle: 'tick' | 'classic' = String(config?.layout.starStyle ?? 'tick') === 'classic' ? 'classic' : 'tick';
  const badgeIcon: 'tick' | 'none' = String(config?.layout.badgeIcon ?? 'tick') === 'none' ? 'none' : 'tick';
  const fontFamily = String(config?.layout.fontFamily ?? '');
  const fontInvalid = fontFamily.trim() !== '' && !FONT_FAMILY.test(fontFamily.trim());

  const hasChanges =
    Object.keys(dirty).length > 0 ||
    Object.keys(dirtyNotif).length > 0 ||
    Object.keys(dirtyReq).length > 0;

  /**
   * Throw away every pending edit and go back to what is saved.
   *
   * The edits live in the displayed state as well as in the dirty maps, so both go back:
   * the displayed state to what the server last returned, the maps to empty. Nothing is
   * re-fetched, so Discard cannot fail, and a group whose save just succeeded goes back to
   * that save rather than to the first load.
   */
  const discard = () => {
    setConfig(savedConfig.current);
    setNotif(savedNotif.current);
    setReqSettings(savedReq.current);
    setDirty({});
    setDirtyNotif({});
    setDirtyReq({});
  };

  /**
   * Warn before a reload or a tab close drops unsaved edits.
   *
   * Only covers leaving the page: in-app navigation is a React state change that no browser
   * event can intercept, so the Discard button above is what makes the state recoverable
   * there. This catches the case merchants actually hit — reloading the embedded app, or
   * closing the admin tab, after changing a setting and not pressing Save.
   */
  useEffect(() => {
    if (!hasChanges) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [hasChanges]);

  const save = async () => {
    if (!hasChanges) {
      toast.info('Nothing to save');
      return;
    }
    setSaving(true);
    try {
      if (Object.keys(dirty).length) {
        const res = await apiFetch<{ rejected: string[]; config: StorefrontConfig }>(
          '/api/storefront-config',
          { method: 'PUT', body: JSON.stringify({ updates: dirty }) }
        );
        savedConfig.current = res.config;
        setConfig(res.config);
        // Rejected keys are surfaced, not swallowed. A merchant who typed "emerald" into a
        // colour field deserves to know that field did not save, rather than discover it
        // by looking at their storefront.
        if (res.rejected?.length) {
          toast.warning(`${res.rejected.length} setting(s) were not valid and were not saved`, {
            description: res.rejected.map(k => k.split('.').pop()).join(', '),
          });
        }
        setDirty({});
      }

      if (Object.keys(dirtyReq).length) {
        // The response is used, not discarded. `reminderGapDays` has a floor of one day,
        // so typing 0 stores 1 — and the old code threw the response away, left the 0 on
        // screen and said "Saved", which is the app telling the merchant something untrue.
        const res = await apiFetch<RequestSettingsBody & {
          adjusted?: Array<{ field: string; requested: number; applied: number; min: number; max: number }>;
        }>('/api/request-settings', {
          method: 'PUT',
          body: JSON.stringify({ updates: dirtyReq }),
        });
        const settings = withPlan(res);
        savedReq.current = settings;
        setReqSettings(settings);
        setDirtyReq({});
        for (const a of res.adjusted ?? []) {
          toast.warning(`${TIMING_LABELS[a.field] ?? a.field} saved as ${a.applied}, not ${a.requested}`, {
            description: `Allowed range is ${a.min} to ${a.max}.`,
          });
        }
      }

      if (Object.keys(dirtyNotif).length) {
        const res = await apiFetch<{ settings: NotificationSettings; rejected: string[] }>(
          '/api/notifications',
          { method: 'PUT', body: JSON.stringify({ updates: dirtyNotif }) }
        );
        savedNotif.current = res.settings;
        setNotif(res.settings);
        if (res.rejected?.length) {
          toast.warning('Some notification settings were not valid');
        }
        setDirtyNotif({});
      }

      toast.success('Saved. Your storefront updates within about five minutes.');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not save settings'));
    } finally {
      setSaving(false);
    }
  };

  /**
   * Google Merchant Center feed.
   *
   * The endpoints for this have existed since the feature was built; nothing in the app
   * ever called them. So "Google Shopping" was sold on the Growth plan and there was no
   * way for a merchant to reach it — the URL they need was reachable only by someone who
   * knew to POST to an undocumented route.
   */
  const loadFeedUrl = useCallback(() => {
    apiFetch<{ url: string | null }>('/api/feeds/token')
      .then((d) => {
        setFeedUrl(d.url);
        setFeedLoadFailed(false);
      })
      .catch(() => {
        setFeedUrl(undefined);
        setFeedLoadFailed(true);
      });
  }, []);

  useEffect(loadFeedUrl, [loadFeedUrl]);

  const issueFeedUrl = async (rotating: boolean) => {
    setFeedBusy(true);
    try {
      const d = await apiFetch<{ url: string }>('/api/feeds/token', { method: 'POST' });
      setFeedUrl(d.url);
      setFeedLoadFailed(false);
      toast.success(rotating ? 'New feed URL created. The old one no longer works.' : 'Feed URL created.');
    } catch (err) {
      if (err instanceof ApiError && err.isPlanLimit) {
        toast.error(err.userMessage, { description: 'Google Shopping ratings need the Growth plan or above.' });
      } else {
        toast.error(errorMessage(err, 'Could not create the feed URL'));
      }
    } finally {
      setFeedBusy(false);
    }
  };

  /**
   * Bring the setup guide back.
   *
   * Also the only way to see the first-install experience without creating a fresh store —
   * useful for a merchant who skipped it early and now wants the walkthrough, and the way
   * we check the flow ourselves.
   */
  const replaySetup = async () => {
    try {
      await apiFetch('/api/onboarding', {
        method: 'POST',
        body: JSON.stringify({ dismissed: false }),
      });
      // Take them there rather than telling them where to go. A toast that reads
      // "open the Dashboard to see it" is the app asking the merchant to finish a job
      // it could have finished itself.
      onNavigate?.('dashboard');
    } catch (err) {
      toast.error(errorMessage(err, 'Could not restore the setup guide'));
    }
  };

  const resetAll = async () => {
    const ok = await confirm({
      title: 'Reset every display setting?',
      body: 'Colours, layout, wording and your custom CSS all go back to the defaults. Anything you have tuned for your storefront is lost, and there is no undo.',
      confirmLabel: 'Reset everything',
    });
    if (!ok) return;
    setSaving(true);
    try {
      await apiFetch('/api/storefront-config', { method: 'DELETE' });
      toast.success('Reset to defaults');
      load();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not reset'));
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const res = await apiFetch<{ to: string }>('/api/notifications', { method: 'POST' });
      toast.success(`Test notification sent to ${res.to}`);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not send the test'));
    } finally {
      setTesting(false);
    }
  };

  const handleUpgrade = async (planId: string) => {
    if (planId === currentPlan) return;

    // Moving down actually cancels the Shopify subscription, so it is a money decision
    // and gets asked about. Upgrading does not: Shopify's own approval screen is the
    // confirmation, and asking twice is friction in front of a purchase.
    //
    // The wording follows the outcome. A store given Growth free that pays for Scale and
    // picks Free (or Growth) does not lose its paid features and land on Free — the server
    // cancels Scale and settles them on the gift — so the old "your paid features stop"
    // dialog contradicted what then happened, for exactly the merchants the gift was
    // built for.
    const landsOnGift = giftPlan !== null && rankOf(giftPlan) < rankOf(currentPlan) && rankOf(planId) <= rankOf(giftPlan);
    if (planId === 'free' || landsOnGift) {
      const ok = await confirm(
        landsOnGift && giftPlan
          ? {
              title: `Stop paying for ${planLabel(currentPlan)}?`,
              body: `You keep ${planLabel(giftPlan)} free of charge from Marka. Shopify stops billing you for ${planLabel(currentPlan)} straight away, and your reviews, widgets and settings are all kept.`,
              confirmLabel: `Stop paying for ${planLabel(currentPlan)}`,
            }
          : {
              title: 'Cancel your subscription?',
              body: 'Your paid features stop straight away and Shopify stops billing you. Your reviews, widgets and settings are all kept — you can resubscribe whenever you like.',
              confirmLabel: 'Cancel subscription',
            }
      );
      if (!ok) return;
    }

    onPlanChangeStarted?.();
    setUpgrading(planId);
    try {
      const data = await apiFetch<{ confirmationUrl?: string; activated?: boolean; plan?: string }>('/api/billing', {
        method: 'POST',
        body: JSON.stringify({ plan: planId }),
      });
      // Shopify hosts the approval screen and refuses to be framed, so the admin as a
      // whole has to go there. That hand-off is App Bridge's job — see navigateTop for why assigning
      // window.top.location after an await was the reason merchants "could not pay".
      //
      // `upgrading` is deliberately left set: the page is leaving. Clearing it in a
      // finally block put the button back to "Upgrade" while the navigation was still in
      // flight, and a second click created a second pending subscription at Shopify.
      const approvalUrl = data.confirmationUrl;
      if (approvalUrl) {
        // What the merchant is buying, read back by the shell if Shopify's answer is slow
        // to arrive, so it waits for THIS plan rather than for any paid one. Best effort:
        // storage can be unavailable in an embedded frame, and the shell copes without it.
        try {
          sessionStorage.setItem(PENDING_PLAN_KEY, JSON.stringify({ from: currentPlan, to: planId }));
        } catch {
          /* no storage — the shell falls back to "any change of plan" */
        }
        navigateTop(approvalUrl);
        return;
      }
      if (data.activated) {
        // The plan the server settled on: choosing Free on top of a complimentary plan
        // lands on the complimentary plan, not on Free.
        toast.success(`Switched to the ${planLabel(data.plan ?? planId)} plan.`);
        const u = await apiFetch<Usage>('/api/usage');
        setUsage(u);
        applyPlanToRequests(u);
      }
      setUpgrading(null);
    } catch (err) {
      // The server's text says why — Shopify refused the charge for this store, say —
      // and is written for the merchant, so it is shown as is rather than replaced with
      // a generic line. Long enough to read: it is the one thing they need from this screen.
      toast.error(errorMessage(err, 'Could not start the plan change. Please try again.'), { duration: 8000 });
      setUpgrading(null);
    }
  };

  const SaveBar = (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="animate-rise surface-float pointer-events-auto flex items-center gap-4 rounded-2xl py-2.5 pl-4 pr-2.5">
        {/* A still dot: the sentence beside it carries the meaning, so it does not pulse. */}
        <span className="inline-flex size-2 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold leading-tight text-ink-900 dark:text-white">
            You have unsaved changes
          </p>
          <p className="tnum mt-0.5 text-[11.5px] leading-tight text-ink-500">
            {Object.keys(dirty).length + Object.keys(dirtyNotif).length + Object.keys(dirtyReq).length} unsaved change(s)
          </p>
        </div>
        {/* Discard. The bar announced unsaved changes and offered exactly one way out —
            saving them. A merchant who had toggled something to see what it was had no way
            to back out except reloading the page and hoping. */}
        <button
          type="button"
          onClick={discard}
          disabled={saving || !hasChanges}
          className="h-8 shrink-0 rounded-lg px-3 text-[12.5px] font-medium text-ink-500 hover:bg-ink-50 disabled:opacity-40 dark:hover:bg-white/5"
        >
          Discard
        </button>
        <ActionButton onClick={save} disabled={saving || !hasChanges} size="sm">
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle className="size-3.5" />}
          {hasChanges ? 'Save changes' : 'Saved'}
        </ActionButton>
      </div>
    </div>
  );

  return (
    <div className={cn('space-y-6', hasChanges && 'pb-24')}>
      {/* No page title here. The app shell (src/app/page.tsx) already renders
          "Settings" with its breadcrumb and description above this component, and
          repeating it put the same word on screen three times in the first 300px. */}
      <div className="flex flex-wrap justify-end gap-2">
        <ActionButton variant="ghost" size="sm" icon={Compass} onClick={replaySetup}>
          Show setup guide
        </ActionButton>
        <ActionButton variant="outline" size="sm" icon={RotateCcw} onClick={resetAll} disabled={saving}>
          Reset to defaults
        </ActionButton>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="gap-5">
        <TabsList className="no-scrollbar h-auto w-full justify-start gap-0.5 overflow-x-auto rounded-xl bg-ink-100 p-0.5 dark:bg-white/5">
          <TabsTrigger value="general" className={tabTrigger}><Settings className="size-3.5" />General</TabsTrigger>
          <TabsTrigger value="display" className={tabTrigger}><Palette className="size-3.5" />Display</TabsTrigger>
          <TabsTrigger value="notifications" className={tabTrigger}><Bell className="size-3.5" />Notifications</TabsTrigger>
          <TabsTrigger value="integrations" className={tabTrigger}><Plug className="size-3.5" />Integrations</TabsTrigger>
          <TabsTrigger value="subscription" className={tabTrigger}><CreditCard className="size-3.5" />Plan</TabsTrigger>
        </TabsList>

        {/* ── General ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="general">
          {!config ? (
            <TabFallback what="your settings" error={configError} onRetry={() => { setConfigError(null); loadConfig(); }} />
          ) : (
          <div className="space-y-4">
            <Panel>
              <PanelHeader
                icon={ShieldCheck}
                tone="brand"
                title="Moderation"
                description="What happens when a shopper submits a review"
              />
              <div className="divide-y divide-border border-t border-border">
                {/*
                  One control, not two. "Auto-publish" and "Require approval" were separate
                  switches that could both be on, and the storefront can only do one of
                  them — so whichever the code happened to check silently won.
                */}
                <div className="px-5 py-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1 basis-[240px]">
                      <p className="text-[13px] font-semibold text-ink-900 dark:text-white">New reviews are</p>
                    </div>
                    <Select
                      value={b('autoPublish') ? 'auto' : 'moderated'}
                      onValueChange={v => setBehaviour('autoPublish', v === 'auto')}
                    >
                      <SelectTrigger className="h-10 w-auto min-w-[268px] max-w-full rounded-xl text-[13px]" aria-label="New reviews are"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="moderated">Held for your approval (recommended)</SelectItem>
                        <SelectItem value="auto">Published immediately</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {b('autoPublish') && (
                    <div className="mt-3 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12.5px] leading-relaxed text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      <span>
                        Anything submitted through the public form goes live with no review.
                        Reviews still never show a &ldquo;Verified Purchase&rdquo; badge unless
                        we can match a real order.
                      </span>
                    </div>
                  )}
                </div>

                <ToggleRow
                  title="Allow anonymous reviews"
                  description="Let shoppers submit without giving a name. They appear as “Anonymous”."
                  checked={b('allowAnonymous')}
                  onChange={v => setBehaviour('allowAnonymous', v)}
                />
                <ToggleRow
                  title="Require an email address"
                  description="Used to spot duplicate submissions and to verify purchases. Never published."
                  checked={b('requireEmail')}
                  onChange={v => setBehaviour('requireEmail', v)}
                />
                <SettingRow
                  htmlFor="minReviewLength"
                  title="Minimum review length"
                  description="Characters required in the review body. 0 means no minimum."
                >
                  <Input
                    id="minReviewLength"
                    type="number" min={0} max={1000}
                    className="h-9 w-[120px] rounded-xl text-[13px]"
                    value={num(config.behaviour.minReviewLength, 5)}
                    onChange={e => setBehaviour('minReviewLength', Number(e.target.value))}
                  />
                </SettingRow>
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                icon={Camera}
                tone="violet"
                title="What shoppers can attach"
                description="Media shoppers can add to a review from the public form"
              />
              <div className="divide-y divide-border border-t border-border">
                <ToggleRow
                  title="Photo uploads"
                  description="Up to 5 images per review, 10MB each. Stored in your Shopify Files."
                  checked={b('allowPhotos')}
                  onChange={v => setBehaviour('allowPhotos', v)}
                />
                {/* On a plan without video the server ignores this switch, so it shows off
                    and locked, and says why, rather than "on" with no effect. */}
                <ToggleRow
                  title="Video uploads"
                  description={
                    usage?.features?.videoReviews === false
                      ? 'One video per review, up to 50MB. Comes with the Growth plan; upgrade under Plan to turn it on.'
                      : 'One video per review, up to 50MB. Growth plan and above.'
                  }
                  checked={usage?.features?.videoReviews === false ? false : b('allowVideo')}
                  onChange={v => setBehaviour('allowVideo', v)}
                  disabled={usage?.features?.videoReviews === false}
                />
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                icon={BookOpen}
                tone="indigo"
                title="Reading experience"
                description="How the review list behaves on your product pages"
              />
              <div className="divide-y divide-border border-t border-border">
                <SettingRow htmlFor="perPage" title="Reviews per page">
                  <Input
                    id="perPage"
                    type="number" min={1} max={50}
                    className="h-9 w-[120px] rounded-xl text-[13px]"
                    value={num(config.behaviour.perPage, 5)}
                    onChange={e => setBehaviour('perPage', Number(e.target.value))}
                  />
                </SettingRow>
                <SettingRow title="Default sort">
                  <Select
                    value={String(config.behaviour.defaultSort || 'recent')}
                    onValueChange={v => setBehaviour('defaultSort', v)}
                  >
                    <SelectTrigger className="h-9 w-[180px] rounded-xl text-[13px]" aria-label="Default sort"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="recent">Most recent</SelectItem>
                      <SelectItem value="highest">Highest rating</SelectItem>
                      <SelectItem value="lowest">Lowest rating</SelectItem>
                      <SelectItem value="helpful">Most helpful</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <ToggleRow title="Show the rating breakdown" description="The 5-to-1 star histogram above the list" checked={b('showHistogram')} onChange={v => setBehaviour('showHistogram', v)} />
                <ToggleRow title="Show sort and filter controls" description="Lets shoppers sort and filter to photos only" checked={b('showFilters')} onChange={v => setBehaviour('showFilters', v)} />
                <ToggleRow title="Show the “Write a review” button" description="Turn off if you only collect reviews by email" checked={b('showWriteButton')} onChange={v => setBehaviour('showWriteButton', v)} />
              </div>
            </Panel>
          </div>
          )}
        </TabsContent>

        {/* ── Display ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="display">
          {!config ? (
            <TabFallback what="your display settings" error={configError} onRetry={() => { setConfigError(null); loadConfig(); }} />
          ) : (
          <div className="space-y-4">
            <Panel>
              <PanelHeader
                icon={Palette}
                tone="violet"
                title="Colours"
                description="Applied to every widget. A colour set in the theme editor on a specific block wins over these."
              />
              <div className="border-t border-border p-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <ColorRow label="Accent" value={config.colors.accent} onChange={v => setColor('accent', v)} />
                  <ColorRow label="Stars" value={config.colors.star} onChange={v => setColor('star', v)} />
                  <ColorRow label="Card background" value={config.colors.cardBg} onChange={v => setColor('cardBg', v)} inheritable />
                  <ColorRow label="Card text" value={config.colors.cardText} onChange={v => setColor('cardText', v)} inheritable />
                  <ColorRow label="Borders" value={config.colors.border} onChange={v => setColor('border', v)} inheritable />
                  <ColorRow label="Verified badge" value={config.colors.verifiedBg} onChange={v => setColor('verifiedBg', v)} />
                </div>

                <ContrastNotes
                  colors={config.colors}
                  onFix={changes => changes.forEach(([field, value]) => setColor(field, value))}
                />

                {/* A preview beats a hex code. This is the actual card, with the actual values. */}
                <div className="mt-5 rounded-xl border border-border bg-ink-50 p-4 dark:bg-white/[0.03]">
                  <p className="mb-2.5 text-[11.5px] font-medium uppercase tracking-wider text-ink-400">Preview</p>
                  <div
                    className="border p-3.5"
                    style={{
                      // `?? undefined` so an inherited colour falls through to the preview
                      // surface rather than being pinned to a literal.
                      // A text chosen with no background is given a surface by the
                      // storefront (dark for light text, white for dark) — except under
                      // Minimal on the page, which draws no card at all. The preview shows
                      // exactly that, so a white-on-white Minimal choice looks white on white.
                      background:
                        config.colors.cardBg ??
                        (config.layout.theme === 'minimal' && !['floating', 'popup', 'sidebar'].includes(String(config.layout.type))
                          ? undefined
                          : pairedCardBackground(config.colors.cardText)) ??
                        undefined,
                      // Card text left to the theme on a background the merchant chose is
                      // paired by the storefront with whichever of dark or white reads on
                      // it; the preview pairs it the same way. For display only: the field
                      // keeps saying "Follows your theme", and nothing writes this back.
                      color: config.colors.cardText ?? pairedCardText(config.colors.cardBg) ?? undefined,
                      borderColor: config.colors.border,
                      borderRadius: `${num(config.layout.borderRadius, 8)}px`,
                      // Only a valid family reaches the preview, as on the storefront.
                      fontFamily: fontFamily.trim() && !fontInvalid ? fontFamily.trim() : undefined,
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Stars rating={5} size={15} color={config.colors.star} variant={starStyle} />
                      <span className="text-[12.5px] font-semibold">Sarah M.</span>
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold"
                        style={{ background: config.colors.verifiedBg, color: config.colors.verifiedText }}
                      >
                        {badgeIcon === 'tick' && <VerifiedMark size={11} color={config.colors.star} />}
                        Verified Purchase
                      </span>
                    </div>
                    <p className="mt-2 text-[12.5px] leading-relaxed">Exceeded my expectations — the quality is outstanding.</p>
                    <button
                      className="mt-2.5 rounded-md px-2.5 py-1 text-[11.5px] font-semibold"
                      style={{ background: config.colors.accent, color: '#fff' }}
                      type="button"
                    >
                      Write a review
                    </button>
                  </div>
                </div>
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                icon={SlidersHorizontal}
                tone="cyan"
                title="Style"
                description="Stars, badge icon, font and shape. Each starts on the Marka look; change any of them."
              />
              <div className="divide-y divide-border border-t border-border">
                {/* The second sentence is there because it is not true that this reaches
                    every star. The widget publishes the choice to the page when it loads,
                    and the Liquid-only "Review stars" block inherits it — so on a page
                    without the review widget (collections, home) that block falls back to
                    its own setting, which defaults to the Marka tick-star. Until the block
                    can read this on its own, the merchant has to be told to set it twice. */}
                <SettingRow
                  title="Star style"
                  description="Used for every rating on your storefront. The ‘Review stars’ theme block has its own Star shape setting in the theme editor — set it there too for collection and home pages."
                >
                  <div role="radiogroup" aria-label="Star style" className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-ink-50 p-1 dark:bg-white/[0.04]">
                    {([['tick', 'Marka tick-star'], ['classic', 'Classic star']] as const).map(([value, label]) => {
                      const on = starStyle === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={on}
                          onClick={() => setLayout('starStyle', value)}
                          className={cn(
                            'ring-focus flex min-h-11 items-center gap-2 rounded-[10px] px-3 text-[12.5px] font-semibold transition-colors',
                            on ? 'bg-card text-ink-900 shadow-[var(--elev-1)] dark:text-white' : 'text-ink-500 hover:text-ink-800 dark:hover:text-ink-200'
                          )}
                        >
                          <Stars rating={5} size={13} color={config.colors.star} variant={value} />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </SettingRow>
                <SettingRow title="Verified badge icon" description="The mark before “Verified Purchase”. The words stay either way.">
                  <Select value={badgeIcon} onValueChange={v => setLayout('badgeIcon', v)}>
                    <SelectTrigger className="h-10 w-[220px] rounded-xl text-[13px]" aria-label="Verified badge icon"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tick">Marka tick-star</SelectItem>
                      <SelectItem value="none">No icon</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow
                  htmlFor="fontFamily"
                  title="Font"
                  description="Leave empty to use your theme’s font. To use another, type the name of a font your theme already loads."
                >
                  <div className="grid gap-1.5">
                    <Input
                      id="fontFamily"
                      className="h-10 w-[240px] rounded-xl text-[13px]"
                      placeholder="Your theme’s font"
                      maxLength={80}
                      value={fontFamily}
                      aria-invalid={fontInvalid}
                      aria-describedby={fontInvalid ? 'fontFamily-error' : undefined}
                      onChange={e => setLayout('fontFamily', e.target.value)}
                    />
                    {fontInvalid && (
                      <p id="fontFamily-error" className="max-w-[240px] text-[11.5px] leading-snug text-error">
                        Use letters, numbers, spaces, commas and hyphens, starting with a letter.
                      </p>
                    )}
                  </div>
                </SettingRow>
                <SettingRow title="Widget theme">
                  <Select value={String(config.layout.theme || 'modern')} onValueChange={v => setLayout('theme', v)}>
                    <SelectTrigger className="h-10 w-auto min-w-[268px] max-w-full rounded-xl text-[13px]" aria-label="Widget theme"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="modern">Modern — rounded cards, soft borders</SelectItem>
                      <SelectItem value="classic">Classic — serif titles, square edges</SelectItem>
                      <SelectItem value="minimal">Minimal — no cards, no histogram</SelectItem>
                      <SelectItem value="bold">Bold — heavy borders, large type</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow htmlFor="borderRadius" title="Corner radius" description="In pixels. 0 gives square edges.">
                  <Input
                    id="borderRadius"
                    type="number" min={0} max={40}
                    className="h-9 w-[120px] rounded-xl text-[13px]"
                    value={num(config.layout.borderRadius, 8)}
                    onChange={e => setLayout('borderRadius', Number(e.target.value))}
                  />
                </SettingRow>
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                icon={Eye}
                tone="indigo"
                title="What each review shows"
                description="Turn off anything you would rather not display"
              />
              <div className="divide-y divide-border border-t border-border">
                <ToggleRow title="Verified Purchase badge" description="Only ever shown when we matched a real order to the reviewer" checked={b('showVerifiedBadge')} onChange={v => setBehaviour('showVerifiedBadge', v)} />
                <ToggleRow title="Source badge" description="Shows where an imported review came from, e.g. Judge.me" checked={b('showSourceBadge')} onChange={v => setBehaviour('showSourceBadge', v)} />
                <ToggleRow title="Photos and video" description="Attached media, opened full size in a lightbox" checked={b('showMedia')} onChange={v => setBehaviour('showMedia', v)} />
                <ToggleRow title="Your replies" description="Store responses, shown under the review they answer" checked={b('showReply')} onChange={v => setBehaviour('showReply', v)} />
                <ToggleRow title="“Helpful” button" description="Lets shoppers upvote reviews, and enables sorting by most helpful" checked={b('showHelpful')} onChange={v => setBehaviour('showHelpful', v)} />
                <ToggleRow title="Review date" description="" checked={b('showDates')} onChange={v => setBehaviour('showDates', v)} />
                <ToggleRow title="Reviewer location" description="Only shown where we have it" checked={b('showReviewerLocation')} onChange={v => setBehaviour('showReviewerLocation', v)} />
              </div>
            </Panel>

            <Panel>
              <PanelHeader
                icon={Code2}
                tone="ink"
                title="Custom CSS"
                description={
                  <>
                    Injected on your storefront. Widget classes are prefixed{' '}
                    <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[11.5px] dark:bg-white/10">rm-</code> — e.g.{' '}
                    <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[11.5px] dark:bg-white/10">.rm-review</code>,{' '}
                    <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[11.5px] dark:bg-white/10">.rm-btn--primary</code>.
                  </>
                }
              />
              <div className="border-t border-border p-5">
                <textarea
                  className="ring-focus h-36 w-full rounded-xl border border-border bg-ink-50 p-3.5 font-mono text-[12.5px] leading-relaxed text-ink-900 outline-none dark:bg-white/[0.03] dark:text-ink-100"
                  placeholder=".rm-review { box-shadow: 0 1px 3px rgba(0,0,0,.08); }"
                  value={config.customCss}
                  onChange={e => setCss(e.target.value)}
                  spellCheck={false}
                  aria-label="Custom CSS"
                />
                <p className="mt-2.5 text-[12px] leading-relaxed text-ink-500">
                  <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[11.5px] dark:bg-white/10">@import</code>, angle brackets and non-HTTPS{' '}
                  <code className="rounded bg-ink-100 px-1 py-0.5 font-mono text-[11.5px] dark:bg-white/10">url()</code> are stripped when saved —
                  they are script-execution paths on your storefront.
                </p>
              </div>
            </Panel>

            {/* Google Shopping used to sit here, under Custom CSS. It is not a display
                setting — it is a place your reviews get published to — and a merchant who
                had just upgraded for it went looking on the Plan tab and found nothing.
                It now lives on its own Integrations tab. */}
          </div>
          )}
        </TabsContent>

        {/* ── Integrations ──────────────────────────────────────────────────────────── */}
        <TabsContent value="integrations">
          <div className="space-y-4">
            <Panel>
              <PanelHeader
                icon={Globe}
                tone="cyan"
                title="Google Shopping star ratings"
                description="Put your star ratings on Google Shopping listings. Paste this URL into Google Merchant Center once; it refreshes on its own after that."
                action={<Pill tone="brand">Growth and above</Pill>}
              />
              <div className="border-t border-border p-5">
                {feedUrl ? (
                  <>
                    <Label className="text-[12.5px] font-semibold">Your feed URL</Label>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {/* `break-all`, not `truncate`. A URL the merchant has to paste
                          into Merchant Center is worth showing in full, and truncation
                          only hid the overflow rather than preventing it: an unbroken
                          80-character string still sets a large min-content width, which
                          is what pushed the Copy button off the right edge. Allowing it
                          to break makes that width one character. */}
                      <code className="min-w-0 flex-1 rounded-xl border border-border bg-ink-50 px-3 py-2.5 font-mono text-[12px] leading-relaxed break-all text-ink-700 dark:bg-white/5 dark:text-ink-200">
                        {feedUrl}
                      </code>
                      <ActionButton
                        size="sm"
                        variant={feedCopied ? 'soft' : 'outline'}
                        icon={feedCopied ? Check : Copy}
                        onClick={() => {
                          navigator.clipboard?.writeText(feedUrl).then(
                            () => {
                              setFeedCopied(true);
                              setTimeout(() => setFeedCopied(false), 2000);
                            },
                            () => toast.error('Could not copy — select the URL and copy it manually.')
                          );
                        }}
                      >
                        {feedCopied ? 'Copied' : 'Copy'}
                      </ActionButton>
                    </div>

                    <div className="mt-4 rounded-xl bg-ink-50 p-3.5 dark:bg-white/[0.03]">
                      <p className="text-[12px] font-semibold text-ink-700 dark:text-ink-200">
                        In Google Merchant Center
                      </p>
                      <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-[12px] leading-relaxed text-ink-500">
                        <li>Go to Products → Feeds → add a supplemental feed</li>
                        <li>Choose <strong>Scheduled fetch</strong> and paste the URL above</li>
                        <li>Set it to fetch daily</li>
                      </ol>
                      <p className="mt-2 text-[11.5px] text-ink-400">
                        Google requires <strong>every</strong> review to be submitted, including
                        low ratings — filtering them is a policy violation and gets the whole feed
                        rejected. This feed sends all published reviews and never filters by star.
                      </p>
                    </div>

                    {/*
                      Rotation was a bare text link under everything else, which read as
                      a footnote rather than a control — and this is the only way to
                      revoke a URL that has leaked into a screenshot, a support ticket or
                      a shared spreadsheet. It needs to be findable at the moment someone
                      realises they need it. Still not a primary button: it destroys a
                      working feed, so it sits behind its own divider and states the
                      consequence before the click, not after.
                    */}
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-ink-50/70 p-3.5 dark:bg-white/[0.03]">
                      <div className="min-w-0">
                        <p className="text-[12px] font-semibold text-ink-700 dark:text-ink-200">
                          Replace this URL
                        </p>
                        <p className="mt-0.5 max-w-md text-[11.5px] leading-snug text-ink-500">
                          Use this if the URL has been shared somewhere it should not have
                          been. The current one stops working immediately, so you will need
                          to paste the new one into Merchant Center.
                        </p>
                      </div>
                      <ActionButton
                        size="sm"
                        variant="outline"
                        icon={RefreshCw}
                        onClick={() => issueFeedUrl(true)}
                        disabled={feedBusy}
                        className="border-rose-300 text-rose-700 hover:bg-rose-50 dark:border-rose-400/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
                      >
                        {feedBusy ? 'Working…' : 'Generate a new URL'}
                      </ActionButton>
                    </div>
                  </>
                ) : feedLoadFailed ? (
                  // Deliberately no "Create feed URL" here. We do not know whether one
                  // exists, and issuing one replaces whatever is there — so offering the
                  // button on a failed read is offering to destroy a working feed.
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="max-w-md text-[12.5px] leading-relaxed text-ink-500">
                      Couldn&apos;t check whether a feed URL exists. Nothing has changed — try again
                      in a moment.
                    </p>
                    <ActionButton
                      variant="outline"
                      icon={RotateCcw}
                      onClick={() => {
                        // Clearing the flag first puts the panel back in the "Checking…"
                        // state, which is both honest and what stops a second click
                        // firing a concurrent request.
                        setFeedLoadFailed(false);
                        loadFeedUrl();
                      }}
                    >
                      Try again
                    </ActionButton>
                  </div>
                ) : feedUrl === undefined ? (
                  <div className="flex items-center gap-2 text-[12.5px] text-ink-400">
                    <Loader2 className="size-3.5 animate-spin" />
                    Checking…
                  </div>
                ) : usage?.features?.googleFeed === false ? (
                  // Say the plan up front, rather than offering a button that fails.
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="max-w-md text-[12.5px] leading-relaxed text-ink-500">
                      The Google Shopping review feed comes with the Growth plan ($12/month).
                      Upgrade under Plan, then create the URL here.
                    </p>
                    <Pill tone="cream">Growth plan</Pill>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="max-w-md text-[12.5px] leading-relaxed text-ink-500">
                      Not set up yet. Creating a URL takes a second — you paste it into Merchant
                      Center and Google fetches your reviews on a schedule from then on.
                    </p>
                    <ActionButton icon={Globe} onClick={() => issueFeedUrl(false)} disabled={feedBusy}>
                      {feedBusy ? 'Creating…' : 'Create feed URL'}
                    </ActionButton>
                  </div>
                )}
              </div>
            </Panel>

            {/*
              The other two places reviews leave this app. Neither is configured here, so
              these are signposts rather than controls — but "what is Marka Reviews
              connected to" is a question a merchant asks in Settings, and answering it
              with silence sends them hunting through every screen.
            */}
            <Panel>
              <PanelHeader
                icon={Plug}
                tone="ink"
                title="Set up elsewhere"
                description="Two more connections, each configured on its own screen."
              />
              <div className="divide-y divide-border border-t border-border">
                {([
                  {
                    page: 'bulk-upload' as PageId,
                    title: 'Etsy',
                    body: 'Pull your Etsy reviews in and keep them in sync weekly. Connected from the Import screen.',
                  },
                  {
                    page: 'widgets' as PageId,
                    title: 'Your storefront',
                    body: 'The theme block that puts reviews on your product pages, and the one-click link that installs it.',
                  },
                ]).map(row => (
                  <button
                    key={row.page}
                    type="button"
                    onClick={() => onNavigate?.(row.page)}
                    className="ring-focus flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-ink-50 dark:hover:bg-white/[0.03]"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-semibold text-ink-800 dark:text-white">{row.title}</span>
                      <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-500">{row.body}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-ink-400" strokeWidth={2.4} />
                  </button>
                ))}
              </div>
            </Panel>
          </div>
        </TabsContent>

        {/* ── Notifications ─────────────────────────────────────────────────────────── */}
        <TabsContent value="notifications">
          {!notif ? (
            <TabFallback what="your notification settings" error={notifError} onRetry={() => { setNotifError(null); loadNotif(); }} />
          ) : (
          <div className="space-y-4">
            {!mailProvider && (
              <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-[var(--elev-1)] dark:border-amber-400/20 dark:bg-amber-500/10">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
                <div className="text-[12.5px] leading-relaxed text-amber-800 dark:text-amber-200">
                  <p className="font-semibold text-amber-900 dark:text-amber-100">No email provider is configured yet.</p>
                  <p className="mt-0.5">
                    These preferences will save, but nothing will send until an email provider is set up on the server.
                  </p>
                </div>
              </div>
            )}

            <Panel>
              <PanelHeader
                icon={Mail}
                tone="brand"
                title="Where to send"
                description="One address receives every alert below"
                action={
                  <ActionButton
                    variant="outline"
                    size="sm"
                    icon={testing ? undefined : Send}
                    onClick={sendTest}
                    disabled={testing || !mailProvider || hasChanges}
                    title={hasChanges ? 'Save your changes first' : undefined}
                  >
                    {testing && <Loader2 className="size-3.5 animate-spin" />}
                    Send a test
                  </ActionButton>
                }
              />
              <div className="border-t border-border p-5">
                <Label htmlFor="notifEmail" className="text-[12.5px] font-semibold text-ink-700 dark:text-ink-200">
                  Notification email
                </Label>
                <Input
                  id="notifEmail"
                  type="email"
                  className="mt-1.5 h-10 max-w-md rounded-xl text-[13px]"
                  placeholder={fallbackEmail || 'you@yourstore.com'}
                  value={notif.email}
                  onChange={e => setNotifField('email', e.target.value)}
                />
                <p className="mt-2 text-[12.5px] text-ink-500">
                  {fallbackEmail
                    ? <>Leave blank to use your store address, <strong className="font-semibold text-ink-700 dark:text-ink-200">{fallbackEmail}</strong>.</>
                    : 'We have no address on file for your store, so this one is required.'}
                </p>
              </div>
            </Panel>

            {/* Its own fallback, not the defaults. These controls decide what is emailed
                to customers; showing ON / 14 / 1 / 7 when the store's values did not load
                presented made-up numbers as the merchant's, and let a save write them. */}
            {!reqSettings ? (
              <TabFallback
                what="your review request settings"
                error={reqError}
                onRetry={() => { setReqError(null); loadRequestSettings(); }}
                note="Nothing has changed. The rest of this tab still works."
                panels={1}
              />
            ) : (
            <Panel>
              <PanelHeader
                icon={Clock}
                tone="amber"
                title="Review request timing"
                description="The review invitation is sent this many days after an order is fulfilled — give the parcel time to arrive. Reminders only go to customers who haven’t reviewed yet, and an unsubscribe stops everything."
              />
              <div className="divide-y divide-border border-t border-border">
                {/* Where things stand, in one sentence, before the controls. Requests are
                    on from the moment of install — every fulfilled order schedules an
                    email — and nothing on this page said so: a merchant read the fields
                    below as "nothing happens until I fill these in". Reads the live values,
                    so an unsaved edit shows here too. */}
                <div
                  role="status"
                  className={cn(
                    'px-5 py-3 text-[12.5px] leading-snug',
                    reqSettings.enabled
                      ? 'bg-brand-50/70 text-brand-900 dark:bg-brand-500/10 dark:text-brand-100'
                      : 'bg-ink-50/70 text-ink-700 dark:bg-white/[0.03] dark:text-ink-200'
                  )}
                >
                  <strong className="font-semibold">Review requests are {reqSettings.enabled ? 'ON' : 'OFF'}</strong>
                  {' — '}
                  {describeRequests(reqSettings)}
                  {reqSettings.enabled ? ' Change the numbers below, or switch them off.' : ' Switch them on below to start asking.'}
                </div>
                {/* The off switch. Until this existed every fulfilled order emailed its
                    customer from the day the app was installed, and the only way to stop
                    it was to uninstall. */}
                <ToggleRow
                  title="Send review requests"
                  description="Off stops new invitations and cancels any already waiting to go out. Reviews already collected stay."
                  checked={reqSettings.enabled}
                  onChange={v => setReqFlag('enabled', v)}
                />
                <ToggleRow
                  title="Only ask customers who accepted marketing"
                  description="Skips anyone who left the marketing box unticked at checkout. Turn this on if your region treats review invitations as marketing email."
                  checked={reqSettings.requireMarketingConsent}
                  onChange={v => setReqFlag('requireMarketingConsent', v)}
                  disabled={!reqSettings.enabled}
                />
                <SettingRow htmlFor="delayDays" title="Days after fulfilment (0–60)">
                  <Input id="delayDays" type="number" min={0} max={60} className="h-9 w-[120px] rounded-xl text-[13px]"
                    value={reqSettings.delayDays}
                    onChange={e => setReqField('delayDays', Number(e.target.value))} />
                </SettingRow>
                {/* On a plan without reminders the sender sends none, whatever these say,
                    so they are shown as stored but not editable, with the reason. The
                    stored count stays: it is what resumes on an upgrade. */}
                <SettingRow
                  htmlFor="reminders"
                  title="Reminders (0–2)"
                  description={reqSettings.remindersAllowed === false ? (
                    <>
                      Your plan sends the first email only. Reminders, and the days between them, come with the Growth plan.{' '}
                      <button
                        type="button"
                        onClick={() => setTab('subscription')}
                        className="ring-focus rounded font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
                      >
                        See plans
                      </button>
                    </>
                  ) : undefined}
                >
                  <Input id="reminders" type="number" min={0} max={2} className="h-9 w-[120px] rounded-xl text-[13px]"
                    value={reqSettings.reminders}
                    disabled={reqSettings.remindersAllowed === false}
                    onChange={e => setReqField('reminders', Number(e.target.value))} />
                </SettingRow>
                <SettingRow htmlFor="reminderGapDays" title="Days between sends (1–14)">
                  <Input id="reminderGapDays" type="number" min={1} max={14} className="h-9 w-[120px] rounded-xl text-[13px]"
                    value={reqSettings.reminderGapDays}
                    disabled={reqSettings.remindersAllowed === false}
                    onChange={e => setReqField('reminderGapDays', Number(e.target.value))} />
                </SettingRow>
              </div>
            </Panel>
            )}

            <Panel>
              <PanelHeader
                icon={Bell}
                tone="rose"
                title="What to send"
                description="Pick the moments worth an email"
              />
              <div className="divide-y divide-border border-t border-border">
                <ToggleRow
                  title="Every new review"
                  description="One email per submission. Off by default — a busy store would get dozens a day."
                  checked={notif.newReview}
                  onChange={v => setNotifField('newReview', v)}
                />
                <ToggleRow
                  title="Negative review alerts"
                  description="Sent straight away. A public reply within a few hours is what turns these around."
                  checked={notif.negativeReview}
                  onChange={v => setNotifField('negativeReview', v)}
                />
                {notif.negativeReview && (
                  <SettingRow
                    className="bg-ink-50/60 dark:bg-white/[0.02]"
                    title={
                      <span className="flex items-center gap-2">
                        <span className="h-4 w-0.5 rounded-full bg-brand-500" />
                        Alert me at or below
                      </span>
                    }
                  >
                    <Select
                      value={String(notif.negativeThreshold)}
                      onValueChange={v => setNotifField('negativeThreshold', Number(v))}
                    >
                      <SelectTrigger className="h-9 w-[180px] rounded-xl text-[13px]" aria-label="Alert me at or below"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 star</SelectItem>
                        <SelectItem value="2">2 stars</SelectItem>
                        <SelectItem value="3">3 stars</SelectItem>
                      </SelectContent>
                    </Select>
                  </SettingRow>
                )}
                <ToggleRow
                  title="Weekly summary"
                  description="Review count, average rating and how many are waiting for approval. Skipped in a week with no activity."
                  checked={notif.weeklySummary}
                  onChange={v => setNotifField('weeklySummary', v)}
                />
              </div>
            </Panel>
          </div>
          )}
        </TabsContent>

        {/* ── Plan ──────────────────────────────────────────────────────────────────── */}
        <TabsContent value="subscription">
          <div className="space-y-5">
            <Panel elevation="hero" className="relative overflow-hidden p-5">
              <div className="grid-lines pointer-events-none absolute inset-0" />
              <div className="relative flex flex-wrap items-start gap-4">
                <Tile icon={Crown} tone="brand" size="xl" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px] font-medium uppercase tracking-wider text-ink-400">Current plan</p>
                  <h3 className="display mt-1 text-[26px] font-bold text-ink-900 dark:text-white">
                    {usage?.planLabel ?? 'Free'}
                  </h3>
                  <p className="tnum mt-1 text-[12.5px] text-ink-500">
                    {usage
                      ? complimentary
                        ? 'Free of charge, from Marka. There is nothing to pay or renew.'
                        : usage.price === 0
                          ? 'No charge on this plan'
                          : `$${usage.price.toFixed(2)}/month • billed through Shopify`
                      : usageError
                        ? usageError
                        : 'Loading plan details…'}
                  </p>
                  {/* The one load this tab depends on, with its own way back. */}
                  {usageError && !usage && (
                    <ActionButton
                      variant="outline"
                      size="sm"
                      icon={RotateCcw}
                      className="mt-3"
                      onClick={() => { setUsageError(null); loadUsage(); }}
                    >
                      Try again
                    </ActionButton>
                  )}
                </div>
                <ActionButton
                  variant="outline"
                  size="sm"
                  trailingIcon={ArrowUpRight}
                  onClick={() => {
                    // Subscriptions live in the merchant's Shopify admin, not in our app.
                    const url = adminUrl(storeDomain, '/settings/billing/subscriptions');
                    if (!url) {
                      toast.error('Could not work out your store address.');
                      return;
                    }
                    navigateTop(url);
                  }}
                >
                  Manage Billing
                </ActionButton>
              </div>

              {usage && (
                <div className="relative mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {/* Requests are the meter; reviews are unlimited on every tier and shown
                      only so the number is visible somewhere. */}
                  <UsageBar
                    label="Review requests this month"
                    used={usage.requests.used}
                    limit={usage.requests.limit}
                    percent={usage.requests.percentUsed}
                    tone={usage.requests.percentUsed >= 90 ? 'rose' : usage.requests.percentUsed >= 70 ? 'amber' : 'brand'}
                  />
                  <UsageBar
                    label="Reviews collected"
                    used={usage.reviews.used}
                    limit={usage.reviews.limit}
                    percent={usage.reviews.percentUsed}
                    tone="indigo"
                  />
                </div>
              )}
            </Panel>

            {/*
              Where the thing you just paid for actually lives.

              A merchant upgrades for one named feature, lands back on this tab, and every
              route to that feature is somewhere else in the app — Google Shopping was two
              tabs away under Custom CSS. Paying and then not finding it is how a
              subscription gets cancelled in week one. Only entitled features are listed:
              this is a map, not a second pricing table.
            */}
            {unlocked.length > 0 && (
              <Panel className={cn(justUpgraded && 'is-selected-strong')}>
                <PanelHeader
                  icon={Sparkles}
                  tone="brand"
                  title={justUpgraded ? 'You just unlocked these' : `Included in ${usage?.planLabel ?? 'your plan'}`}
                  description="Everything your plan adds, and where to find it."
                />
                <div className="divide-y divide-border border-t border-border">
                  {unlocked.map(f => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={f.go}
                      className="ring-focus flex w-full items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-ink-50 dark:hover:bg-white/[0.03]"
                    >
                      <Tile icon={f.icon} tone={f.tone} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] font-semibold text-ink-800 dark:text-white">{f.label}</span>
                        <span className="mt-0.5 block text-[11.5px] leading-snug text-ink-500">{f.where}</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-ink-400" strokeWidth={2.4} />
                    </button>
                  ))}
                </div>
              </Panel>
            )}

            {/* The cards wait for the plan. Rendering them against a default of Free
                would mark the Free card "Current plan" for a paying merchant while the
                request was in flight — a claim, not a loading state. */}
            {!usage ? (
              usageError ? null : (
                <div className="grid grid-cols-1 gap-4 pt-3 md:grid-cols-2 xl:grid-cols-3" role="status" aria-busy="true">
                  <span className="sr-only">Loading plans…</span>
                  {plans.map(plan => (
                    <Panel key={plan.id} className="p-5">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="mt-3 h-8 w-24" />
                      <div className="mt-5 space-y-2.5">
                        {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-3 w-full" />)}
                      </div>
                      <Skeleton className="mt-6 h-8 w-full rounded-lg" />
                    </Panel>
                  ))}
                </div>
              )
            ) : (
            <div className="grid grid-cols-1 gap-4 pt-3 md:grid-cols-2 xl:grid-cols-3">
              {plans.map(plan => (
                <Panel
                  key={plan.id}
                  elevation={plan.popular ? 'float' : 'raised'}
                  className={cn(
                    'relative flex flex-col p-5',
                    plan.color,
                    plan.id === currentPlan && 'is-selected-strong'
                  )}
                >
                  {plan.popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="brand-fill inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wider">
                        <Sparkles className="size-3" strokeWidth={2.6} />
                        Most popular
                      </span>
                    </div>
                  )}

                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[15px] font-semibold text-ink-900 dark:text-white">{plan.name}</h3>
                    {plan.id === currentPlan && (
                      <Pill tone="brand" icon={Check}>{complimentary ? 'Yours, free' : 'Current'}</Pill>
                    )}
                  </div>

                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="display tnum text-[30px] font-bold text-ink-900 dark:text-white">${plan.price}</span>
                    <span className="text-[12.5px] text-ink-400">/{plan.interval}</span>
                  </div>

                  <ul className="mt-4 flex-1 space-y-2">
                    {plan.features.map(f => (
                      <li key={f} className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-600 dark:text-ink-300">
                        <span
                          className={cn(
                            'mt-px inline-flex size-4 shrink-0 items-center justify-center rounded-full',
                            plan.id === currentPlan || plan.popular
                              ? 'bg-brand-100 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                              : 'bg-ink-100 text-ink-500 dark:bg-white/10 dark:text-ink-300'
                          )}
                        >
                          <Check className="size-2.5" strokeWidth={3.2} />
                        </span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>

                  <ActionButton
                    className="mt-5 w-full"
                    size="sm"
                    variant={plan.id === currentPlan ? 'soft' : plan.popular ? 'primary' : 'outline'}
                    disabled={plan.id === currentPlan || includedFree(plan.id) || upgrading !== null}
                    onClick={() => handleUpgrade(plan.id)}
                  >
                    {upgrading === plan.id && <Loader2 className="size-3.5 animate-spin" />}
                    {/* The current plan is tested first: on a gifted Scale store the Scale
                        card used to read "Included free" instead of "Current plan". And
                        up or down is a question of rank, not of price — a merchant on
                        Scale saw "Upgrade" on the cheaper Growth card. */}
                    {plan.id === currentPlan
                      ? 'Current plan'
                      : includedFree(plan.id)
                        ? 'Included free'
                        : upgrading === plan.id
                          ? 'Redirecting…'
                          : rankOf(plan.id) < rankOf(currentPlan)
                            ? 'Downgrade'
                            : 'Upgrade'}
                  </ActionButton>
                </Panel>
              ))}
            </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {hasChanges && SaveBar}
    </div>
  );
}
