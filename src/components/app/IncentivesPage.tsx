'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Gift, ShieldCheck, Save, Loader2, Trash2, Pencil, CheckCircle2,
  Ticket, BadgeCheck, CalendarX,
  MessageSquare, Camera, Video, Plus, Eye, CalendarClock, Hash,
  type LucideIcon,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { apiFetch, ApiError, errorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import {
  Panel, PanelHeader, StatCard, Tile, Pill, EmptyState, ActionButton, SectionTitle, Skeleton,
  type TileTone,
} from './ui-kit';

/**
 * Review incentives.
 *
 * The compliance note in the form is not decoration. Every competing app in this category
 * offers a "minimum rating to qualify" setting, so a merchant arriving here will look for
 * one, not find it, and assume it is missing rather than deliberately absent. Saying why —
 * on the screen, next to the fields — is what stops them going looking for a workaround.
 *
 * The reward-value field disappears for free shipping because the API forces the value to
 * zero; showing a box whose contents are discarded is a lie about what was saved.
 */

const REWARD_TYPES = [
  { value: 'percentage', label: 'Percentage off' },
  { value: 'fixed_amount', label: 'Fixed amount off' },
  { value: 'free_shipping', label: 'Free shipping' },
] as const;

type RewardType = (typeof REWARD_TYPES)[number]['value'];

const DEFAULT_DISCLOSURE = 'This reviewer received a discount in exchange for an honest review.';

interface Incentive {
  id: string;
  storeId: string;
  name: string;
  isActive: boolean;
  rewardType: string;
  rewardValue: number;
  rewardValuePhoto: number | null;
  rewardValueVideo: number | null;
  requiresMedia: boolean;
  disclosureText: string;
  expiryDays: number;
  usageLimit: number | null;
  createdAt: string;
  updatedAt: string;
  _count: { grants: number };
}

interface Stats {
  issued: number;
  redeemed: number;
  expired: number;
}

interface FormState {
  name: string;
  rewardType: RewardType;
  /** Kept as strings so the inputs can be empty while a merchant is typing. */
  rewardValue: string;
  rewardValuePhoto: string;
  rewardValueVideo: string;
  requiresMedia: boolean;
  disclosureText: string;
  expiryDays: string;
  /** Blank means unlimited — the API stores null for that. */
  usageLimit: string;
  isActive: boolean;
}

const BLANK_FORM: FormState = {
  name: '',
  rewardType: 'percentage',
  rewardValue: '10',
  rewardValuePhoto: '',
  rewardValueVideo: '',
  requiresMedia: false,
  disclosureText: DEFAULT_DISCLOSURE,
  expiryDays: '30',
  usageLimit: '',
  isActive: true,
};

function rewardLabel(type: string, value: number): string {
  if (type === 'free_shipping') return 'Free shipping';
  if (type === 'percentage') return `${value}% off`;
  return `${value} off`;
}

/**
 * One rung of the media ladder: text, photo, video.
 *
 * Three boxes side by side rather than stacked rows, because the point of the feature is
 * that it is a ladder — a merchant should be able to read the shape of their own offer at
 * a glance. Defined at module scope so typing in one does not remount the input.
 */
function RewardTier({
  id,
  icon: Icon,
  tone,
  label,
  caption,
  value,
  onChange,
  placeholder,
  max,
  unit,
}: {
  id: string;
  icon: LucideIcon;
  tone: TileTone;
  label: string;
  caption: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  max?: number;
  unit?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 transition-colors hover:border-ink-300 dark:hover:border-white/20">
      <div className="flex items-center gap-2">
        <Tile icon={Icon} tone={tone} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-semibold leading-tight text-ink-800 dark:text-ink-100">
            {label}
          </p>
          <p className="truncate text-[11px] leading-tight text-ink-400">{caption}</p>
        </div>
      </div>
      <div className="relative mt-2.5">
        <Input
          id={id}
          type="number"
          min={1}
          max={max}
          placeholder={placeholder}
          className={cn('tnum h-9 rounded-xl text-[13px]', unit && 'pr-7')}
          value={value}
          onChange={e => onChange(e.target.value)}
        />
        {unit && (
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11.5px] font-semibold text-ink-400">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

export default function IncentivesPage() {
  const [incentives, setIncentives] = useState<Incentive[]>([]);
  const [stats, setStats] = useState<Stats>({ issued: 0, redeemed: 0, expired: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({ ...BLANK_FORM });

  // Promise chain rather than async/await: every setState lands in a callback, so nothing
  // runs synchronously when this is called from an effect. Returns the promise so the
  // mutation handlers below can still await a refresh before clearing their busy state.
  const load = useCallback(() => {
    return apiFetch<{ incentives?: Incentive[]; stats?: Stats }>('/api/incentives')
      .then(data => {
        setIncentives(data.incentives || []);
        setStats(data.stats || { issued: 0, redeemed: 0, expired: 0 });
      })
      .catch(err => {
        toast.error(errorMessage(err, 'Could not load your incentives'));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm(f => ({ ...f, [k]: v }));

  /** Plan limits are the one failure worth routing somewhere, so they get their own branch. */
  const reportError = (err: unknown, fallback: string) => {
    if (err instanceof ApiError && err.isPlanLimit) {
      toast.error(err.userMessage, { description: 'Open Settings → Plan to upgrade.', duration: 8000 });
      return;
    }
    toast.error(errorMessage(err, fallback));
  };

  const resetForm = () => {
    setEditingId(null);
    setForm({ ...BLANK_FORM });
  };

  const startEdit = (i: Incentive) => {
    setEditingId(i.id);
    setForm({
      name: i.name,
      rewardType: (REWARD_TYPES.find(r => r.value === i.rewardType)?.value ?? 'percentage'),
      rewardValue: String(i.rewardValue),
      rewardValuePhoto: i.rewardValuePhoto == null ? '' : String(i.rewardValuePhoto),
      rewardValueVideo: i.rewardValueVideo == null ? '' : String(i.rewardValueVideo),
      requiresMedia: i.requiresMedia,
      disclosureText: i.disclosureText,
      expiryDays: String(i.expiryDays),
      usageLimit: i.usageLimit === null ? '' : String(i.usageLimit),
      isActive: i.isActive,
    });
  };

  const save = async () => {
    if (!form.name.trim()) {
      toast.error('Give the incentive a name');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        rewardType: form.rewardType,
        rewardValue: Number(form.rewardValue),
        rewardValuePhoto: form.rewardValuePhoto.trim() === '' ? null : Number(form.rewardValuePhoto),
        rewardValueVideo: form.rewardValueVideo.trim() === '' ? null : Number(form.rewardValueVideo),
        requiresMedia: form.requiresMedia,
        disclosureText: form.disclosureText.trim() || DEFAULT_DISCLOSURE,
        expiryDays: Number(form.expiryDays),
        // '' rather than 0: the API reads an empty string as "no limit".
        usageLimit: form.usageLimit.trim() === '' ? '' : Number(form.usageLimit),
        isActive: form.isActive,
      };

      if (editingId) {
        await apiFetch('/api/incentives', {
          method: 'PUT',
          body: JSON.stringify({ id: editingId, ...payload }),
        });
        toast.success('Incentive updated');
      } else {
        await apiFetch('/api/incentives', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Incentive saved');
      }
      resetForm();
      await load();
    } catch (err) {
      reportError(err, 'Could not save the incentive');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Only one incentive is ever active: the server switches the others off when this one
   * goes on, so the whole list is reloaded rather than the single row patched.
   */
  const toggleActive = async (i: Incentive) => {
    try {
      await apiFetch('/api/incentives', {
        method: 'PUT',
        body: JSON.stringify({ id: i.id, isActive: !i.isActive }),
      });
      await load();
    } catch (err) {
      reportError(err, 'Could not change that');
    }
  };

  const remove = async (id: string) => {
    try {
      await apiFetch('/api/incentives', { method: 'DELETE', body: JSON.stringify({ id }) });
      toast.success('Incentive deleted. Codes already issued stay valid until they expire.');
      if (editingId === id) resetForm();
      await load();
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete the incentive'));
    }
  };

  const showValue = form.rewardType !== 'free_shipping';
  const previewReward = rewardLabel(form.rewardType, Number(form.rewardValue) || 0).toLowerCase();

  const valueMax = form.rewardType === 'percentage' ? 100 : undefined;
  const valueUnit = form.rewardType === 'percentage' ? '%' : undefined;

  /** Send a merchant with an empty list to the form, wherever it has wrapped to. */
  const jumpToForm = () => {
    resetForm();
    document.getElementById('incentive-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="space-y-6">
      {/* ── Codes issued, across every incentive ever run ────────────────────────── */}
      <div className="stagger grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Codes issued"
          value={stats.issued}
          icon={Ticket}
          tone="brand"
          hint="Across every incentive you have run."
        />
        <StatCard
          label="Redeemed"
          value={stats.redeemed}
          icon={BadgeCheck}
          tone="cyan"
          hint={
            stats.issued > 0
              ? `${Math.round((stats.redeemed / stats.issued) * 100)}% of the codes issued`
              : 'Nothing redeemed yet'
          }
        />
        <StatCard
          label="Expired unused"
          value={stats.expired}
          icon={CalendarX}
          tone="amber"
          hint="Ran past the expiry window"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* ── Left: the form ───────────────────────────────────────────────────────── */}
        <Panel id="incentive-form" className="animate-rise self-start">
          <PanelHeader
            title={editingId ? 'Edit incentive' : 'New incentive'}
            description="The reward is issued as a single-use Shopify discount code once the review is published."
            icon={editingId ? Pencil : Gift}
            tone="brand"
            action={editingId ? <Pill tone="amber">Editing</Pill> : undefined}
          />

          <div className="space-y-5 px-5 pb-5">
            {/*
              Placed above the fields, not below them: a merchant looking for a
              minimum-rating setting should read why there is none before concluding it is
              an oversight and asking support for it.
            */}
            <div className="rounded-xl border border-brand-600/15 bg-brand-50/70 p-3.5 dark:border-brand-400/20 dark:bg-brand-500/[0.08]">
              <div className="flex gap-3">
                <Tile icon={ShieldCheck} tone="brand" size="sm" />
                <div className="space-y-1.5 text-[11.5px] leading-relaxed text-brand-900/85 dark:text-brand-100/80">
                  <p className="text-[12.5px] font-semibold text-brand-900 dark:text-brand-200">
                    There is no minimum-rating setting, and there will not be one.
                  </p>
                  <p>
                    A reward may never depend on what a review says. Offering something in exchange for a
                    positive review — expressly or by implication — is prohibited by the FTC&rsquo;s Rule on
                    Consumer Reviews (<strong>16 CFR 465.4</strong>, penalties to roughly $53,000 per instance),
                    the <strong>EU Omnibus Directive</strong>, and the <strong>UK DMCC Act 2024</strong>.
                    &ldquo;Leave a 5-star review, get 10% off&rdquo; is the textbook violation.
                  </p>
                  <p>
                    Requiring a <strong>photo or video</strong> is lawful, because media is a content type
                    rather than a sentiment: a one-star review with a photo earns exactly what a five-star one
                    with a photo earns.
                  </p>
                  <p>
                    Every incentivised review carries the disclosure below on your storefront and in your
                    Google feed. Incentivised reviews are excluded from Shop app syndication — Shop&rsquo;s
                    guidelines ban compensation for reviews outright, with no disclosure carve-out.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="incentiveName" className="text-[12.5px] font-semibold">Name</Label>
              <Input
                id="incentiveName"
                className="h-9 rounded-xl text-[13px]"
                placeholder="Thanks for reviewing"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                maxLength={100}
              />
              <p className="text-[11.5px] text-ink-400">
                For your own reference, and on the discount title in Shopify.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-[12.5px] font-semibold">Reward type</Label>
                <Select value={form.rewardType} onValueChange={v => set('rewardType', v as RewardType)}>
                  <SelectTrigger className="h-9 w-full rounded-xl text-[13px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REWARD_TYPES.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!showValue && (
                <p className="self-end pb-2 text-[11.5px] leading-relaxed text-ink-400">
                  Free shipping has no value to set — the whole shipping line comes off.
                </p>
              )}
            </div>

            {showValue && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-ink-800 dark:text-ink-100">
                    Reward more for photos and video
                  </span>
                  {/* The one-line version of the notice above, kept beside the fields it governs. */}
                  <Pill tone="brand" icon={ShieldCheck}>Never tied to the rating</Pill>
                </div>
                <p className="text-[11.5px] leading-relaxed text-ink-500">
                  Optional higher rewards when a review includes media — e.g. 10% for text,
                  12% with a photo, 15% with a video. Rewards depend on what a review
                  contains, never on its rating.
                </p>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  <RewardTier
                    id="rewardValue"
                    icon={MessageSquare}
                    tone="ink"
                    label="Base reward"
                    caption="Any review"
                    max={valueMax}
                    unit={valueUnit}
                    value={form.rewardValue}
                    onChange={v => set('rewardValue', v)}
                  />
                  <RewardTier
                    id="rewardValuePhoto"
                    icon={Camera}
                    tone="cyan"
                    label="With a photo"
                    caption="Optional"
                    placeholder="same as base"
                    max={valueMax}
                    unit={valueUnit}
                    value={form.rewardValuePhoto}
                    onChange={v => set('rewardValuePhoto', v)}
                  />
                  <RewardTier
                    id="rewardValueVideo"
                    icon={Video}
                    tone="violet"
                    label="With a video"
                    caption="Optional"
                    placeholder="same as photo"
                    max={valueMax}
                    unit={valueUnit}
                    value={form.rewardValueVideo}
                    onChange={v => set('rewardValueVideo', v)}
                  />
                </div>

                <p className="text-[11.5px] text-ink-400">
                  {form.rewardType === 'percentage'
                    ? 'Percentage off, between 1 and 100.'
                    : 'Amount off, in your store’s currency.'}
                </p>
              </div>
            )}

            <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-ink-50/70 p-3.5 dark:bg-white/[0.03]">
              <div className="min-w-0">
                <span className="text-[12.5px] font-semibold text-ink-800 dark:text-ink-100">
                  Require a photo or video
                </span>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
                  Only reviews with media earn the reward. Lawful, because it asks for a kind of content
                  rather than a kind of opinion.
                </p>
              </div>
              <Switch checked={form.requiresMedia} onCheckedChange={v => set('requiresMedia', v)} />
            </div>

            {/* Legally required on every incentivised review, so it stays in plain sight. */}
            <div className="rounded-xl border border-amber-600/20 bg-amber-50/60 p-3.5 dark:border-amber-400/20 dark:bg-amber-500/[0.07]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="disclosureText" className="text-[12.5px] font-semibold text-ink-900 dark:text-white">
                  <ShieldCheck className="size-4 text-amber-600 dark:text-amber-400" strokeWidth={2.2} />
                  Disclosure text
                </Label>
                <Pill tone="amber">Required</Pill>
              </div>
              <Textarea
                id="disclosureText"
                className="mt-2 min-h-[68px] rounded-xl bg-card text-[13px]"
                value={form.disclosureText}
                onChange={e => set('disclosureText', e.target.value)}
                maxLength={300}
              />
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-500">
                Shown to the shopper before they write, and beside every review that earned the reward.
                Leave it blank to use the default.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="expiryDays" className="text-[12.5px] font-semibold">
                  <CalendarClock className="size-3.5 text-ink-400" strokeWidth={2.2} />
                  Code expires after (days)
                </Label>
                <Input
                  id="expiryDays"
                  type="number"
                  min={1}
                  max={365}
                  className="tnum h-9 rounded-xl text-[13px]"
                  value={form.expiryDays}
                  onChange={e => set('expiryDays', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="usageLimit" className="text-[12.5px] font-semibold">
                  <Hash className="size-3.5 text-ink-400" strokeWidth={2.2} />
                  Usage limit
                </Label>
                <Input
                  id="usageLimit"
                  type="number"
                  min={1}
                  className="tnum h-9 rounded-xl text-[13px]"
                  placeholder="Unlimited"
                  value={form.usageLimit}
                  onChange={e => set('usageLimit', e.target.value)}
                />
                <p className="text-[11.5px] text-ink-400">
                  Total codes to issue. Leave blank for no cap.
                </p>
              </div>
            </div>

            <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-ink-50/70 p-3.5 dark:bg-white/[0.03]">
              <div className="min-w-0">
                <span className="text-[12.5px] font-semibold text-ink-800 dark:text-ink-100">Active</span>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-500">
                  Turning this on switches off any other active incentive.
                </p>
              </div>
              <Switch checked={form.isActive} onCheckedChange={v => set('isActive', v)} />
            </div>

            <div className="rounded-xl border border-border bg-ink-50/70 p-3.5 dark:bg-white/[0.03]">
              <p className="flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-wider text-ink-400">
                <Eye className="size-3.5" strokeWidth={2.4} />
                What the shopper sees
              </p>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-800 dark:text-ink-100">
                {form.requiresMedia
                  ? `Add a photo or video with your review and get ${previewReward} on your next order.`
                  : `Leave a review and get ${previewReward} on your next order.`}
              </p>
              <p className="mt-1.5 text-[12px] italic leading-relaxed text-ink-500">
                {form.disclosureText.trim() || DEFAULT_DISCLOSURE}
              </p>
            </div>

            <div className="flex gap-2">
              <ActionButton onClick={save} disabled={saving} className="flex-1">
                {saving
                  ? <Loader2 className="size-4 animate-spin" />
                  : <Save className="size-4" strokeWidth={2.4} />}
                {editingId ? 'Update incentive' : 'Save incentive'}
              </ActionButton>
              {editingId && (
                <ActionButton variant="outline" onClick={resetForm}>
                  Cancel
                </ActionButton>
              )}
            </div>
          </div>
        </Panel>

        {/* ── Right: performance and the saved list ────────────────────────────────── */}
        <div>
          <SectionTitle
            hint="Only the active one issues codes. The rest are kept but ignored."
            action={
              <Pill tone="neutral" className="tnum">
                {incentives.length} saved
              </Pill>
            }
          >
            Your incentives
          </SectionTitle>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Panel key={i} elevation="flat" className="flex items-center gap-3 p-3.5">
                  <Skeleton className="size-9 rounded-xl" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-3.5 w-28" />
                    <Skeleton className="h-2.5 w-44" />
                  </div>
                  <Skeleton className="h-7 w-20 rounded-lg" />
                </Panel>
              ))}
            </div>
          ) : incentives.length === 0 ? (
            <Panel>
              <EmptyState
                icon={Gift}
                tone="rose"
                title="No incentives yet"
                description="Create one to start offering a discount code for reviews. Nothing is issued until you switch an incentive on."
                action={
                  <ActionButton icon={Plus} onClick={jumpToForm}>
                    Create an incentive
                  </ActionButton>
                }
              />
            </Panel>
          ) : (
            <div className="space-y-3">
              {incentives.map((i, idx) => {
                // The ladder, read back to the merchant. Free shipping has no tiers to show:
                // rewardLabel ignores the value for it, so every rung would read the same.
                const tiers: string[] = [];
                if (i.rewardType !== 'free_shipping') {
                  if (i.rewardValuePhoto != null) tiers.push(`photo ${rewardLabel(i.rewardType, i.rewardValuePhoto)}`);
                  if (i.rewardValueVideo != null) tiers.push(`video ${rewardLabel(i.rewardType, i.rewardValueVideo)}`);
                }

                return (
                  <Panel
                    key={i.id}
                    elevation={i.isActive ? 'raised' : 'flat'}
                    style={{ animationDelay: `${idx * 55}ms` }}
                    className={cn(
                      'animate-rise group flex items-center gap-3 p-3.5',
                      i.isActive && 'ring-1 ring-brand-500/25'
                    )}
                  >
                    <Tile icon={Gift} tone={i.isActive ? 'brand' : 'ink'} />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="display tnum text-[15px] font-bold text-ink-900 dark:text-white">
                          {rewardLabel(i.rewardType, i.rewardValue)}
                        </span>
                        {i.isActive ? (
                          <Pill tone="brand" icon={CheckCircle2}>Active</Pill>
                        ) : (
                          <Pill tone="neutral">Inactive</Pill>
                        )}
                        {i.requiresMedia && <Pill tone="violet" icon={Camera}>Media required</Pill>}
                      </div>

                      <p className="mt-0.5 truncate text-[12.5px] font-medium text-ink-700 dark:text-ink-200">
                        {i.name}
                      </p>

                      <p className="mt-1 truncate text-[11.5px] text-ink-400">
                        <span className="tnum">expires in {i.expiryDays}d</span>
                        {' · '}
                        <span className="tnum">
                          {i.usageLimit === null
                            ? `${i._count.grants} issued`
                            : `${i._count.grants} of ${i.usageLimit} issued`}
                        </span>
                        {tiers.length > 0 && <span className="tnum">{' · '}{tiers.join(' · ')}</span>}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <Switch
                        checked={i.isActive}
                        onCheckedChange={() => toggleActive(i)}
                        aria-label="Active"
                        className="mr-1"
                      />
                      <ActionButton
                        variant="ghost"
                        size="sm"
                        className="px-2"
                        onClick={() => startEdit(i)}
                        aria-label="Edit"
                      >
                        <Pencil className="size-3.5" />
                      </ActionButton>
                      <ActionButton
                        variant="ghost"
                        size="sm"
                        className="px-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-500/10"
                        onClick={() => remove(i.id)}
                        aria-label="Delete"
                      >
                        <Trash2 className="size-3.5" />
                      </ActionButton>
                    </div>
                  </Panel>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
