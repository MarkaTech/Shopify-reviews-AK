'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Gift, ShieldCheck, Save, Loader2, Trash2, Pencil, CheckCircle2,
  Ticket, BadgeCheck, CalendarX,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { apiFetch, ApiError, errorMessage } from '@/lib/api-client';

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

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2.5 p-3 rounded-lg bg-gray-50">
      <div className="w-8 h-8 rounded-lg bg-white border flex items-center justify-center text-emerald-600 flex-shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-bold leading-none">{value}</p>
        <p className="text-[10px] text-muted-foreground mt-1">{label}</p>
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">Review incentives</h2>
        <p className="text-xs text-muted-foreground">
          Offer a discount code for leaving a review. One incentive is active at a time.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* ── Left: the form ───────────────────────────────────────────────────────── */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">{editingId ? 'Edit incentive' : 'New incentive'}</CardTitle>
            <CardDescription className="text-xs">
              The reward is issued as a single-use Shopify discount code once the review is published.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/*
              Placed above the fields, not below them: a merchant looking for a
              minimum-rating setting should read why there is none before concluding it is
              an oversight and asking support for it.
            */}
            <div className="text-[11px] text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg p-3 flex gap-2">
              <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-px text-emerald-600" />
              <div className="space-y-1.5 leading-relaxed">
                <p className="font-semibold text-xs">There is no minimum-rating setting, and there will not be one.</p>
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

            <div>
              <Label className="text-xs">Name</Label>
              <Input
                className="h-8 text-xs mt-1"
                placeholder="Thanks for reviewing"
                value={form.name}
                onChange={e => set('name', e.target.value)}
                maxLength={100}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                For your own reference, and on the discount title in Shopify.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Reward type</Label>
                <Select value={form.rewardType} onValueChange={v => set('rewardType', v as RewardType)}>
                  <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REWARD_TYPES.map(r => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {showValue && (
                <div>
                  <Label className="text-xs">
                    {form.rewardType === 'percentage' ? 'Percentage off' : 'Amount off'}
                  </Label>
                  <Input
                    type="number"
                    min={1}
                    max={form.rewardType === 'percentage' ? 100 : undefined}
                    className="h-8 text-xs mt-1"
                    value={form.rewardValue}
                    onChange={e => set('rewardValue', e.target.value)}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {form.rewardType === 'percentage'
                      ? 'Between 1 and 100.'
                      : 'In your store’s currency.'}
                  </p>
                </div>
              )}
            </div>

            {showValue && (
              <div>
                <span className="text-xs font-medium">Reward more for photos and video</span>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                  Optional higher rewards when a review includes media — e.g. 10% for text,
                  12% with a photo, 15% with a video. Rewards depend on what a review
                  contains, never on its rating.
                </p>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div>
                    <Label className="text-xs">With a photo</Label>
                    <Input
                      type="number"
                      min={1}
                      max={form.rewardType === 'percentage' ? 100 : undefined}
                      placeholder="same as base"
                      className="h-8 text-xs mt-1"
                      value={form.rewardValuePhoto}
                      onChange={e => set('rewardValuePhoto', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">With a video</Label>
                    <Input
                      type="number"
                      min={1}
                      max={form.rewardType === 'percentage' ? 100 : undefined}
                      placeholder="same as photo"
                      className="h-8 text-xs mt-1"
                      value={form.rewardValueVideo}
                      onChange={e => set('rewardValueVideo', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            )}

            <Separator />

            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-xs font-medium">Require a photo or video</span>
                <p className="text-[10px] text-muted-foreground mt-0.5 leading-relaxed">
                  Only reviews with media earn the reward. Lawful, because it asks for a kind of content
                  rather than a kind of opinion.
                </p>
              </div>
              <Switch checked={form.requiresMedia} onCheckedChange={v => set('requiresMedia', v)} />
            </div>

            <div>
              <Label className="text-xs">Disclosure text</Label>
              <Textarea
                className="text-xs mt-1 min-h-[60px]"
                value={form.disclosureText}
                onChange={e => set('disclosureText', e.target.value)}
                maxLength={300}
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Shown to the shopper before they write, and beside every review that earned the reward.
                Leave it blank to use the default.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Code expires after (days)</Label>
                <Input
                  type="number"
                  min={1}
                  max={365}
                  className="h-8 text-xs mt-1"
                  value={form.expiryDays}
                  onChange={e => set('expiryDays', e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Usage limit</Label>
                <Input
                  type="number"
                  min={1}
                  className="h-8 text-xs mt-1"
                  placeholder="Unlimited"
                  value={form.usageLimit}
                  onChange={e => set('usageLimit', e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Total codes to issue. Leave blank for no cap.
                </p>
              </div>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-xs font-medium">Active</span>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Turning this on switches off any other active incentive.
                </p>
              </div>
              <Switch checked={form.isActive} onCheckedChange={v => set('isActive', v)} />
            </div>

            <div className="text-[11px] bg-gray-50 border rounded-lg p-3">
              <p className="font-medium text-xs mb-1">What the shopper sees</p>
              <p className="text-muted-foreground leading-relaxed">
                {form.requiresMedia
                  ? `Add a photo or video with your review and get ${previewReward} on your next order.`
                  : `Leave a review and get ${previewReward} on your next order.`}
              </p>
              <p className="text-muted-foreground italic mt-1">
                {form.disclosureText.trim() || DEFAULT_DISCLOSURE}
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={save}
                disabled={saving}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-xs gap-1.5"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                {editingId ? 'Update incentive' : 'Save incentive'}
              </Button>
              {editingId && (
                <Button variant="outline" className="text-xs" onClick={resetForm}>
                  Cancel
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Right: performance and the saved list ────────────────────────────────── */}
        <div className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Codes issued</CardTitle>
              <CardDescription className="text-xs">Across every incentive you have run.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2">
                <StatTile icon={<Ticket className="w-4 h-4" />} label="Issued" value={stats.issued} />
                <StatTile icon={<BadgeCheck className="w-4 h-4" />} label="Redeemed" value={stats.redeemed} />
                <StatTile icon={<CalendarX className="w-4 h-4" />} label="Expired unused" value={stats.expired} />
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Your incentives ({incentives.length})</CardTitle>
              <CardDescription className="text-xs">
                Only the active one issues codes. The rest are kept but ignored.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-16 bg-gray-100 rounded-lg animate-pulse" />
              ) : incentives.length === 0 ? (
                <div className="py-10 text-center">
                  <Gift className="w-10 h-10 mx-auto text-muted-foreground/30" />
                  <p className="text-sm font-medium mt-3">No incentives yet</p>
                  <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed max-w-xs mx-auto">
                    Create one on the left to start offering a discount code for reviews. Nothing is issued
                    until you switch an incentive on.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {incentives.map(i => (
                    <div
                      key={i.id}
                      className={`flex items-center gap-3 p-3 rounded-lg ${
                        i.isActive ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'bg-gray-50'
                      }`}
                    >
                      <div
                        className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                          i.isActive ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-200 text-gray-400'
                        }`}
                      >
                        <Gift className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold truncate">{i.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {rewardLabel(i.rewardType, i.rewardValue)}
                          {i.requiresMedia ? ' · photo or video required' : ''}
                          {' · expires in '}{i.expiryDays}d
                          {' · '}
                          {i.usageLimit === null
                            ? `${i._count.grants} issued`
                            : `${i._count.grants} of ${i.usageLimit} issued`}
                        </p>
                      </div>
                      {i.isActive && (
                        <Badge className="text-[10px] h-5 px-1.5 bg-emerald-600 text-white gap-1 flex-shrink-0">
                          <CheckCircle2 className="w-2.5 h-2.5" /> Active
                        </Badge>
                      )}
                      <Switch
                        checked={i.isActive}
                        onCheckedChange={() => toggleActive(i)}
                        aria-label="Active"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => startEdit(i)}
                        aria-label="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5 text-gray-500" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => remove(i.id)}
                        aria-label="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
