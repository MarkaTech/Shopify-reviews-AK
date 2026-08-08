'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings, Bell, Palette, CheckCircle, CreditCard, Crown, AlertTriangle,
  RotateCcw, Send, Loader2, Check, Sparkles, Mail, Clock, Eye, Code2, Compass,
  ShieldCheck, SlidersHorizontal, Camera, BookOpen, ArrowUpRight, Globe, Copy,
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
import type { PageId } from './TopNav';
import { adminUrl, navigateTop } from '@/lib/admin-links';
import { Panel, PanelHeader, Tile, Pill, Meter, ActionButton, Skeleton } from './ui-kit';

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
      'Shop app sync + Google Shopping',
      'ReviewMaster branding removed',
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

interface Usage {
  plan: string;
  planLabel: string;
  price: number;
  /** The meter: review request emails sent this calendar month. */
  requests: { used: number; limit: number | null; percentUsed: number; resetsAt: string };
  reviews: { used: number; limit: number | null; percentUsed: number };
  widgets: { used: number; limit: number | null; percentUsed: number };
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

function ColorRow({
  label, value, onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label className="text-[12.5px] font-semibold text-ink-700 dark:text-ink-200">{label}</Label>
      <div className="mt-1.5 flex gap-2">
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="ring-focus size-10 shrink-0 cursor-pointer rounded-xl border border-border p-0"
          aria-label={label}
        />
        <Input
          className="h-10 flex-1 rounded-xl font-mono text-[13px]"
          value={value}
          onChange={e => onChange(e.target.value)}
          spellCheck={false}
        />
      </div>
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

export default function SettingsPage({ onNavigate, storeDomain }: { onNavigate?: (page: PageId) => void; storeDomain?: string }) {
  const confirm = useConfirm();
  const [config, setConfig] = useState<StorefrontConfig | null>(null);
  const [notif, setNotif] = useState<NotificationSettings | null>(null);
  const [reqSettings, setReqSettings] = useState<{ delayDays: number; reminders: number; reminderGapDays: number } | null>(null);
  const [dirtyReq, setDirtyReq] = useState<Record<string, string>>({});
  const [mailProvider, setMailProvider] = useState<string | null>(null);
  const [fallbackEmail, setFallbackEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
  const [upgrading, setUpgrading] = useState<string | null>(null);

  // Only what the merchant actually changed is sent. Sending the whole config on every
  // save would write ~70 rows per click and, worse, would persist every default as an
  // explicit override — so a later change to a default would never reach existing stores.
  const [dirty, setDirty] = useState<Record<string, string>>({});
  const [dirtyNotif, setDirtyNotif] = useState<Record<string, string>>({});

  // No setLoading(true) here on purpose. `loading` starts true, and calling setState
  // synchronously from an effect body triggers a cascading render — which is what
  // react-hooks/set-state-in-effect flags. The reset handler has its own `saving` state,
  // so nothing needs the skeleton to reappear on a refetch.
  const load = useCallback(() => {
    Promise.all([
      apiFetch<{ config: StorefrontConfig }>('/api/storefront-config'),
      apiFetch<{
        settings: NotificationSettings;
        provider: string | null;
        fallbackEmail: string | null;
      }>('/api/notifications'),
    ])
      .then(([c, n]) => {
        setConfig(c.config);
        setNotif(n.settings);
        setMailProvider(n.provider);
        setFallbackEmail(n.fallbackEmail);
        setDirty({});
        setDirtyNotif({});
      })
      .catch(err => toast.error(errorMessage(err, 'Could not load settings')))
      .finally(() => setLoading(false));

    apiFetch<Usage>('/api/usage').then(setUsage).catch(() => setUsage(null));

    apiFetch<{ settings: { delayDays: number; reminders: number; reminderGapDays: number } }>('/api/request-settings')
      .then(r => { setReqSettings(r.settings); setDirtyReq({}); })
      .catch(() => setReqSettings(null));
  }, []);

  useEffect(load, [load]);

  const currentPlan = usage?.plan ?? 'free';

  // ── Config editing ────────────────────────────────────────────────────────────────
  const setBehaviour = (field: string, value: string | number | boolean) => {
    setConfig(c => (c ? { ...c, behaviour: { ...c.behaviour, [field]: value } } : c));
    setDirty(d => ({ ...d, [`sf.behaviour.${field}`]: String(value) }));
  };
  const setColor = (field: string, value: string) => {
    setConfig(c => (c ? { ...c, colors: { ...c.colors, [field]: value } } : c));
    setDirty(d => ({ ...d, [`sf.color.${field}`]: value }));
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

  const hasChanges =
    Object.keys(dirty).length > 0 ||
    Object.keys(dirtyNotif).length > 0 ||
    Object.keys(dirtyReq).length > 0;

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
        await apiFetch('/api/request-settings', {
          method: 'PUT',
          body: JSON.stringify({ updates: dirtyReq }),
        });
        setDirtyReq({});
      }

      if (Object.keys(dirtyNotif).length) {
        const res = await apiFetch<{ settings: NotificationSettings; rejected: string[] }>(
          '/api/notifications',
          { method: 'PUT', body: JSON.stringify({ updates: dirtyNotif }) }
        );
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
    setUpgrading(planId);
    try {
      const data = await apiFetch<{ confirmationUrl?: string; activated?: boolean }>('/api/billing', {
        method: 'POST',
        body: JSON.stringify({ plan: planId }),
      });
      if (data.confirmationUrl) {
        // Shopify hosts the approval screen and refuses to be framed, so this has to break
        // out of the embedded admin iframe. `window.top.location` is the only way to do
        // that; the lint rule below is about React state, and a navigation is neither
        // React state nor something an effect can express.
        // eslint-disable-next-line react-hooks/immutability
        if (window.top) window.top.location.href = data.confirmationUrl;
        // eslint-disable-next-line react-hooks/immutability
        else window.location.href = data.confirmationUrl;
        return;
      }
      if (data.activated) {
        toast.success(`Switched to the ${planId} plan.`);
        setUsage(await apiFetch<Usage>('/api/usage'));
      }
    } catch (err) {
      toast.error(errorMessage(err, 'Could not start the plan change'));
    } finally {
      setUpgrading(null);
    }
  };

  if (loading || !config || !notif) {
    return (
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-3 w-72" />
          </div>
          <Skeleton className="h-8 w-36 rounded-xl" />
        </div>
        <Skeleton className="h-9 w-full rounded-xl" />
        {[0, 1].map(i => (
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

  const SaveBar = (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="animate-rise surface-float pointer-events-auto flex items-center gap-4 rounded-2xl py-2.5 pl-4 pr-2.5">
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-amber-500" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-semibold leading-tight text-ink-900 dark:text-white">
            You have unsaved changes
          </p>
          <p className="tnum mt-0.5 text-[11.5px] leading-tight text-ink-500">
            {Object.keys(dirty).length + Object.keys(dirtyNotif).length + Object.keys(dirtyReq).length} unsaved change(s)
          </p>
        </div>
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

      <Tabs defaultValue="general" className="gap-5">
        <TabsList className="no-scrollbar h-auto w-full justify-start gap-0.5 overflow-x-auto rounded-xl bg-ink-100 p-0.5 dark:bg-white/5">
          <TabsTrigger value="general" className={tabTrigger}><Settings className="size-3.5" />General</TabsTrigger>
          <TabsTrigger value="display" className={tabTrigger}><Palette className="size-3.5" />Display</TabsTrigger>
          <TabsTrigger value="notifications" className={tabTrigger}><Bell className="size-3.5" />Notifications</TabsTrigger>
          <TabsTrigger value="subscription" className={tabTrigger}><CreditCard className="size-3.5" />Plan</TabsTrigger>
        </TabsList>

        {/* ── General ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="general">
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
                      <SelectTrigger className="h-9 w-[268px] rounded-xl text-[13px]" aria-label="New reviews are"><SelectValue /></SelectTrigger>
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
                <ToggleRow
                  title="Video uploads"
                  description="One video per review, up to 50MB. Growth plan and above."
                  checked={b('allowVideo')}
                  onChange={v => setBehaviour('allowVideo', v)}
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
        </TabsContent>

        {/* ── Display ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="display">
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
                  <ColorRow label="Card background" value={config.colors.cardBg} onChange={v => setColor('cardBg', v)} />
                  <ColorRow label="Card text" value={config.colors.cardText} onChange={v => setColor('cardText', v)} />
                  <ColorRow label="Borders" value={config.colors.border} onChange={v => setColor('border', v)} />
                  <ColorRow label="Verified badge" value={config.colors.verifiedBg} onChange={v => setColor('verifiedBg', v)} />
                </div>

                {/* A preview beats a hex code. This is the actual card, with the actual values. */}
                <div className="mt-5 rounded-xl border border-border bg-ink-50 p-4 dark:bg-white/[0.03]">
                  <p className="mb-2.5 text-[11.5px] font-medium uppercase tracking-wider text-ink-400">Preview</p>
                  <div
                    className="border p-3.5"
                    style={{
                      background: config.colors.cardBg,
                      color: config.colors.cardText,
                      borderColor: config.colors.border,
                      borderRadius: `${num(config.layout.borderRadius, 8)}px`,
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span style={{ color: config.colors.star, letterSpacing: '1px' }}>★★★★★</span>
                      <span className="text-[12.5px] font-semibold">Sarah M.</span>
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold"
                        style={{ background: config.colors.verifiedBg, color: config.colors.verifiedText }}
                      >
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
                description="The shape and character of every widget"
              />
              <div className="divide-y divide-border border-t border-border">
                <SettingRow title="Widget theme">
                  <Select value={String(config.layout.theme || 'modern')} onValueChange={v => setLayout('theme', v)}>
                    <SelectTrigger className="h-9 w-[268px] rounded-xl text-[13px]" aria-label="Widget theme"><SelectValue /></SelectTrigger>
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

            {/* ── Google Shopping ── */}
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

                    <button
                      onClick={() => issueFeedUrl(true)}
                      disabled={feedBusy}
                      className="ring-focus mt-3 rounded text-[12px] font-semibold text-ink-500 transition-colors hover:text-rose-600 disabled:opacity-50"
                    >
                      {feedBusy ? 'Working…' : 'Generate a new URL (the current one stops working)'}
                    </button>
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
          </div>
        </TabsContent>

        {/* ── Notifications ─────────────────────────────────────────────────────────── */}
        <TabsContent value="notifications">
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

            <Panel>
              <PanelHeader
                icon={Clock}
                tone="amber"
                title="Review request timing"
                description="The review invitation is sent this many days after an order is fulfilled — give the parcel time to arrive. Reminders only go to customers who haven’t reviewed yet, and an unsubscribe stops everything."
              />
              <div className="divide-y divide-border border-t border-border">
                <SettingRow htmlFor="delayDays" title="Days after fulfilment">
                  <Input id="delayDays" type="number" min={0} max={60} className="h-9 w-[120px] rounded-xl text-[13px]"
                    value={reqSettings?.delayDays ?? 14}
                    onChange={e => setReqField('delayDays', Number(e.target.value))} />
                </SettingRow>
                <SettingRow htmlFor="reminders" title="Reminders (0–2)">
                  <Input id="reminders" type="number" min={0} max={2} className="h-9 w-[120px] rounded-xl text-[13px]"
                    value={reqSettings?.reminders ?? 1}
                    onChange={e => setReqField('reminders', Number(e.target.value))} />
                </SettingRow>
                <SettingRow htmlFor="reminderGapDays" title="Days between sends">
                  <Input id="reminderGapDays" type="number" min={1} max={14} className="h-9 w-[120px] rounded-xl text-[13px]"
                    value={reqSettings?.reminderGapDays ?? 7}
                    onChange={e => setReqField('reminderGapDays', Number(e.target.value))} />
                </SettingRow>
              </div>
            </Panel>

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
                      ? usage.price === 0
                        ? 'No charge on this plan'
                        : `$${usage.price.toFixed(2)}/month • billed through Shopify`
                      : 'Loading plan details…'}
                  </p>
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

            <div className="grid grid-cols-1 gap-4 pt-3 md:grid-cols-2 xl:grid-cols-4">
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
                    {plan.id === currentPlan && <Pill tone="brand" icon={Check}>Current</Pill>}
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
                    disabled={plan.id === currentPlan || upgrading !== null}
                    onClick={() => handleUpgrade(plan.id)}
                  >
                    {upgrading === plan.id && <Loader2 className="size-3.5 animate-spin" />}
                    {plan.id === currentPlan
                      ? 'Current Plan'
                      : upgrading === plan.id
                        ? 'Redirecting…'
                        : plan.price === 0
                          ? 'Downgrade'
                          : 'Upgrade'}
                  </ActionButton>
                </Panel>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {hasChanges && SaveBar}
    </div>
  );
}
