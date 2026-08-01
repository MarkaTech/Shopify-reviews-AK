'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings, Bell, Palette, CheckCircle, CreditCard, Crown, AlertTriangle,
  RotateCcw, Send, Loader2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { apiFetch, errorMessage } from '@/lib/api-client';

// Mirrors src/lib/plans.ts. Prices and limits must match the server, which is what
// actually enforces them — this list is presentation only.
const plans = [
  {
    id: 'free', name: 'Free', price: 0, interval: 'month',
    features: ['50 reviews', 'Photo reviews', 'Star rating + review widget', 'CSV import & migration', 'Google rich snippets'],
    color: 'border-gray-200',
  },
  {
    id: 'starter', name: 'Starter', price: 19.99, interval: 'month',
    features: ['500 reviews', 'All widget types', 'Video reviews', 'Questions & answers', 'Review incentives', 'Email review requests'],
    color: 'border-gray-200',
  },
  {
    id: 'growth', name: 'Growth', price: 29.99, interval: 'month',
    features: ['1,000 reviews', 'Unlimited widgets', 'Google Shopping star ratings', 'Shop app syndication', 'Advanced analytics', 'Everything in Starter'],
    color: 'border-emerald-500 ring-2 ring-emerald-200', popular: true,
  },
  {
    id: 'pro', name: 'Pro', price: 49.99, interval: 'month',
    features: ['Unlimited reviews', 'Everything in Growth', 'API access', 'White-label widgets', 'Remove ReviewMaster branding', 'Priority support'],
    color: 'border-gray-200',
  },
];

interface Usage {
  plan: string;
  planLabel: string;
  price: number;
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
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-medium">{title}</p>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
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
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2 mt-1.5">
        <input
          type="color"
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-9 h-9 rounded-lg border cursor-pointer p-0"
          aria-label={label}
        />
        <Input
          className="h-9 text-xs flex-1 font-mono"
          value={value}
          onChange={e => onChange(e.target.value)}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [config, setConfig] = useState<StorefrontConfig | null>(null);
  const [notif, setNotif] = useState<NotificationSettings | null>(null);
  const [mailProvider, setMailProvider] = useState<string | null>(null);
  const [fallbackEmail, setFallbackEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  const bool = (v: unknown) => v === true || v === 'true';
  const b = (field: string) => bool(config?.behaviour[field]);
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const hasChanges = Object.keys(dirty).length > 0 || Object.keys(dirtyNotif).length > 0;

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

  const resetAll = async () => {
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
    return <div className="space-y-4 animate-pulse"><div className="h-96 bg-gray-100 rounded-xl" /></div>;
  }

  const SaveBar = (
    <div className="flex items-center gap-2">
      <Button onClick={save} disabled={saving || !hasChanges} className="bg-emerald-600 hover:bg-emerald-700 text-xs gap-1.5">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
        {hasChanges ? 'Save changes' : 'Saved'}
      </Button>
      {hasChanges && (
        <span className="text-[11px] text-amber-600">
          {Object.keys(dirty).length + Object.keys(dirtyNotif).length} unsaved change(s)
        </span>
      )}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">Settings</h2>
          <p className="text-xs text-muted-foreground">
            These apply to every ReviewMaster widget on your storefront.
          </p>
        </div>
        <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={resetAll} disabled={saving}>
          <RotateCcw className="w-3.5 h-3.5" /> Reset to defaults
        </Button>
      </div>

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList className="bg-gray-100 p-0.5 h-9">
          <TabsTrigger value="general" className="text-xs h-8 gap-1.5"><Settings className="w-3.5 h-3.5" />General</TabsTrigger>
          <TabsTrigger value="display" className="text-xs h-8 gap-1.5"><Palette className="w-3.5 h-3.5" />Display</TabsTrigger>
          <TabsTrigger value="notifications" className="text-xs h-8 gap-1.5"><Bell className="w-3.5 h-3.5" />Notifications</TabsTrigger>
          <TabsTrigger value="subscription" className="text-xs h-8 gap-1.5"><CreditCard className="w-3.5 h-3.5" />Plan</TabsTrigger>
        </TabsList>

        {/* ── General ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="general">
          <div className="space-y-4">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Moderation</CardTitle>
                <CardDescription className="text-xs">What happens when a shopper submits a review</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/*
                  One control, not two. "Auto-publish" and "Require approval" were separate
                  switches that could both be on, and the storefront can only do one of
                  them — so whichever the code happened to check silently won.
                */}
                <div>
                  <Label className="text-xs">New reviews are</Label>
                  <Select
                    value={b('autoPublish') ? 'auto' : 'moderated'}
                    onValueChange={v => setBehaviour('autoPublish', v === 'auto')}
                  >
                    <SelectTrigger className="h-8 text-xs mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="moderated">Held for your approval (recommended)</SelectItem>
                      <SelectItem value="auto">Published immediately</SelectItem>
                    </SelectContent>
                  </Select>
                  {b('autoPublish') && (
                    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2 mt-2 flex gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                      <span>
                        Anything submitted through the public form goes live with no review.
                        Reviews still never show a &ldquo;Verified Purchase&rdquo; badge unless
                        we can match a real order.
                      </span>
                    </p>
                  )}
                </div>

                <Separator />

                <ToggleRow
                  title="Allow anonymous reviews"
                  description="Let shoppers submit without giving a name. They appear as “Anonymous”."
                  checked={b('allowAnonymous')}
                  onChange={v => setBehaviour('allowAnonymous', v)}
                />
                <Separator />
                <ToggleRow
                  title="Require an email address"
                  description="Used to spot duplicate submissions and to verify purchases. Never published."
                  checked={b('requireEmail')}
                  onChange={v => setBehaviour('requireEmail', v)}
                />
                <Separator />
                <div>
                  <p className="text-xs font-medium">Minimum review length</p>
                  <p className="text-[11px] text-muted-foreground mb-1.5">
                    Characters required in the review body. 0 means no minimum.
                  </p>
                  <Input
                    type="number" min={0} max={1000}
                    className="h-8 text-xs max-w-[120px]"
                    value={num(config.behaviour.minReviewLength, 5)}
                    onChange={e => setBehaviour('minReviewLength', Number(e.target.value))}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">What shoppers can attach</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ToggleRow
                  title="Photo uploads"
                  description="Up to 5 images per review, 10MB each. Stored in your Shopify Files."
                  checked={b('allowPhotos')}
                  onChange={v => setBehaviour('allowPhotos', v)}
                />
                <Separator />
                <ToggleRow
                  title="Video uploads"
                  description="One video per review, up to 50MB. Starter plan and above."
                  checked={b('allowVideo')}
                  onChange={v => setBehaviour('allowVideo', v)}
                />
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Reading experience</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Reviews per page</Label>
                    <Input
                      type="number" min={1} max={50}
                      className="h-8 text-xs mt-1.5"
                      value={num(config.behaviour.perPage, 5)}
                      onChange={e => setBehaviour('perPage', Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Default sort</Label>
                    <Select
                      value={String(config.behaviour.defaultSort || 'recent')}
                      onValueChange={v => setBehaviour('defaultSort', v)}
                    >
                      <SelectTrigger className="h-8 text-xs mt-1.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="recent">Most recent</SelectItem>
                        <SelectItem value="highest">Highest rating</SelectItem>
                        <SelectItem value="lowest">Lowest rating</SelectItem>
                        <SelectItem value="helpful">Most helpful</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <Separator />
                <ToggleRow title="Show the rating breakdown" description="The 5-to-1 star histogram above the list" checked={b('showHistogram')} onChange={v => setBehaviour('showHistogram', v)} />
                <Separator />
                <ToggleRow title="Show sort and filter controls" description="Lets shoppers sort and filter to photos only" checked={b('showFilters')} onChange={v => setBehaviour('showFilters', v)} />
                <Separator />
                <ToggleRow title="Show the “Write a review” button" description="Turn off if you only collect reviews by email" checked={b('showWriteButton')} onChange={v => setBehaviour('showWriteButton', v)} />
              </CardContent>
            </Card>

            {SaveBar}
          </div>
        </TabsContent>

        {/* ── Display ───────────────────────────────────────────────────────────────── */}
        <TabsContent value="display">
          <div className="space-y-4">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Colours</CardTitle>
                <CardDescription className="text-xs">
                  Applied to every widget. A colour set in the theme editor on a specific block wins over these.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <ColorRow label="Accent" value={config.colors.accent} onChange={v => setColor('accent', v)} />
                  <ColorRow label="Stars" value={config.colors.star} onChange={v => setColor('star', v)} />
                  <ColorRow label="Card background" value={config.colors.cardBg} onChange={v => setColor('cardBg', v)} />
                  <ColorRow label="Card text" value={config.colors.cardText} onChange={v => setColor('cardText', v)} />
                  <ColorRow label="Borders" value={config.colors.border} onChange={v => setColor('border', v)} />
                  <ColorRow label="Verified badge" value={config.colors.verifiedBg} onChange={v => setColor('verifiedBg', v)} />
                </div>

                {/* A preview beats a hex code. This is the actual card, with the actual values. */}
                <div className="rounded-lg border p-3" style={{ background: '#fafafa' }}>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2">Preview</p>
                  <div
                    className="p-3 border"
                    style={{
                      background: config.colors.cardBg,
                      color: config.colors.cardText,
                      borderColor: config.colors.border,
                      borderRadius: `${num(config.layout.borderRadius, 8)}px`,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span style={{ color: config.colors.star, letterSpacing: '1px' }}>★★★★★</span>
                      <span className="text-xs font-semibold">Sarah M.</span>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{ background: config.colors.verifiedBg, color: config.colors.verifiedText }}
                      >
                        Verified Purchase
                      </span>
                    </div>
                    <p className="text-xs mt-1.5">Exceeded my expectations — the quality is outstanding.</p>
                    <button
                      className="mt-2 text-[11px] px-2.5 py-1 rounded-md"
                      style={{ background: config.colors.accent, color: '#fff' }}
                      type="button"
                    >
                      Write a review
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Style</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Widget theme</Label>
                    <Select value={String(config.layout.theme || 'modern')} onValueChange={v => setLayout('theme', v)}>
                      <SelectTrigger className="h-8 text-xs mt-1.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="modern">Modern — rounded cards, soft borders</SelectItem>
                        <SelectItem value="classic">Classic — serif titles, square edges</SelectItem>
                        <SelectItem value="minimal">Minimal — no cards, no histogram</SelectItem>
                        <SelectItem value="bold">Bold — heavy borders, large type</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Corner radius</Label>
                    <Input
                      type="number" min={0} max={40}
                      className="h-8 text-xs mt-1.5"
                      value={num(config.layout.borderRadius, 8)}
                      onChange={e => setLayout('borderRadius', Number(e.target.value))}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">What each review shows</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ToggleRow title="Verified Purchase badge" description="Only ever shown when we matched a real order to the reviewer" checked={b('showVerifiedBadge')} onChange={v => setBehaviour('showVerifiedBadge', v)} />
                <Separator />
                <ToggleRow title="Source badge" description="Shows where an imported review came from, e.g. Judge.me" checked={b('showSourceBadge')} onChange={v => setBehaviour('showSourceBadge', v)} />
                <Separator />
                <ToggleRow title="Photos and video" description="Attached media, opened full size in a lightbox" checked={b('showMedia')} onChange={v => setBehaviour('showMedia', v)} />
                <Separator />
                <ToggleRow title="Your replies" description="Store responses, shown under the review they answer" checked={b('showReply')} onChange={v => setBehaviour('showReply', v)} />
                <Separator />
                <ToggleRow title="“Helpful” button" description="Lets shoppers upvote reviews, and enables sorting by most helpful" checked={b('showHelpful')} onChange={v => setBehaviour('showHelpful', v)} />
                <Separator />
                <ToggleRow title="Review date" description="" checked={b('showDates')} onChange={v => setBehaviour('showDates', v)} />
                <Separator />
                <ToggleRow title="Reviewer location" description="Only shown where we have it" checked={b('showReviewerLocation')} onChange={v => setBehaviour('showReviewerLocation', v)} />
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Custom CSS</CardTitle>
                <CardDescription className="text-xs">
                  Injected on your storefront. Widget classes are prefixed <code className="text-[10px]">rm-</code> —
                  e.g. <code className="text-[10px]">.rm-review</code>, <code className="text-[10px]">.rm-btn--primary</code>.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <textarea
                  className="w-full h-32 p-3 border rounded-lg text-xs font-mono bg-gray-50 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder=".rm-review { box-shadow: 0 1px 3px rgba(0,0,0,.08); }"
                  value={config.customCss}
                  onChange={e => setCss(e.target.value)}
                  spellCheck={false}
                />
                <p className="text-[11px] text-muted-foreground mt-2">
                  <code>@import</code>, angle brackets and non-HTTPS <code>url()</code> are stripped when saved —
                  they are script-execution paths on your storefront.
                </p>
              </CardContent>
            </Card>

            {SaveBar}
          </div>
        </TabsContent>

        {/* ── Notifications ─────────────────────────────────────────────────────────── */}
        <TabsContent value="notifications">
          <div className="space-y-4">
            {!mailProvider && (
              <div className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-px" />
                <div>
                  <p className="font-medium">No email provider is configured yet.</p>
                  <p className="mt-0.5">
                    These preferences will save, but nothing will send until an email provider is set up on the server.
                  </p>
                </div>
              </div>
            )}

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Where to send</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs">Notification email</Label>
                  <Input
                    type="email"
                    className="h-9 text-xs mt-1.5"
                    placeholder={fallbackEmail || 'you@yourstore.com'}
                    value={notif.email}
                    onChange={e => setNotifField('email', e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    {fallbackEmail
                      ? <>Leave blank to use your store address, <strong>{fallbackEmail}</strong>.</>
                      : 'We have no address on file for your store, so this one is required.'}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">What to send</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <ToggleRow
                  title="Every new review"
                  description="One email per submission. Off by default — a busy store would get dozens a day."
                  checked={notif.newReview}
                  onChange={v => setNotifField('newReview', v)}
                />
                <Separator />
                <ToggleRow
                  title="Negative review alerts"
                  description="Sent straight away. A public reply within a few hours is what turns these around."
                  checked={notif.negativeReview}
                  onChange={v => setNotifField('negativeReview', v)}
                />
                {notif.negativeReview && (
                  <div className="pl-4 border-l-2 border-gray-100">
                    <Label className="text-xs">Alert me at or below</Label>
                    <Select
                      value={String(notif.negativeThreshold)}
                      onValueChange={v => setNotifField('negativeThreshold', Number(v))}
                    >
                      <SelectTrigger className="h-8 text-xs mt-1.5 max-w-[180px]"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1 star</SelectItem>
                        <SelectItem value="2">2 stars</SelectItem>
                        <SelectItem value="3">3 stars</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Separator />
                <ToggleRow
                  title="Weekly summary"
                  description="Review count, average rating and how many are waiting for approval. Skipped in a week with no activity."
                  checked={notif.weeklySummary}
                  onChange={v => setNotifField('weeklySummary', v)}
                />
              </CardContent>
            </Card>

            <div className="flex items-center gap-2">
              {SaveBar}
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5"
                onClick={sendTest}
                disabled={testing || !mailProvider || hasChanges}
                title={hasChanges ? 'Save your changes first' : undefined}
              >
                {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                Send a test
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ── Plan ──────────────────────────────────────────────────────────────────── */}
        <TabsContent value="subscription">
          <div className="space-y-4">
            <Card className="border-0 shadow-sm bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-100">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center text-white">
                  <Crown className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold">Current Plan: {usage?.planLabel ?? 'Free'}</p>
                  <p className="text-xs text-emerald-600">
                    {usage
                      ? usage.price === 0
                        ? 'No charge on this plan'
                        : `$${usage.price.toFixed(2)}/month • billed through Shopify`
                      : 'Loading plan details…'}
                  </p>
                  {usage && (
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {usage.reviews.used} of {usage.reviews.limit ?? 'unlimited'} reviews
                      {' · '}
                      {usage.widgets.used} of {usage.widgets.limit ?? 'unlimited'} widgets
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={() => {
                    // Subscriptions live in the merchant's Shopify admin, not in our app.
                    const url = 'https://admin.shopify.com/settings/billing/subscriptions';
                    if (window.top) window.top.location.href = url;
                    else window.location.href = url;
                  }}
                >
                  Manage Billing
                </Button>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {plans.map(plan => (
                <Card key={plan.id} className={`border-2 ${plan.color} relative ${plan.id === currentPlan ? '' : 'border-0 shadow-sm'}`}>
                  {plan.popular && (
                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2">
                      <Badge className="bg-emerald-600 text-white text-[10px]">MOST POPULAR</Badge>
                    </div>
                  )}
                  <CardHeader className="pb-2 pt-5">
                    <CardTitle className="text-sm">{plan.name}</CardTitle>
                    <CardDescription className="text-xs">
                      <span className="text-xl font-bold">${plan.price}</span>
                      <span className="text-muted-foreground">/{plan.interval}</span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1.5">
                      {plan.features.map(f => (
                        <li key={f} className="flex items-center gap-2 text-xs">
                          <CheckCircle className={`w-3 h-3 flex-shrink-0 ${plan.id === currentPlan ? 'text-emerald-500' : 'text-gray-400'}`} />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      className={`w-full mt-4 text-xs ${plan.id === currentPlan ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-100 hover:bg-gray-200 text-gray-800'}`}
                      disabled={plan.id === currentPlan || upgrading !== null}
                      onClick={() => handleUpgrade(plan.id)}
                    >
                      {plan.id === currentPlan
                        ? 'Current Plan'
                        : upgrading === plan.id
                          ? 'Redirecting…'
                          : plan.price === 0
                            ? 'Downgrade'
                            : 'Upgrade'}
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
