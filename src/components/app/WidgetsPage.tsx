'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Star, Grid, Layers, LayoutList, Columns, MessageSquare, Eye, Sparkles,
  Monitor, Smartphone, Trash2, Save, Loader2, Info, CheckCircle2, Pencil,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { apiFetch, ApiError, errorMessage } from '@/lib/api-client';

/**
 * Widget builder.
 *
 * What changed, and why it matters
 * --------------------------------
 * This screen used to write rows that nothing read. A merchant could design a carousel,
 * save it, see it listed as "Active", and their storefront would carry on rendering a
 * plain list — while the saved row still counted against their plan's widget limit.
 *
 * Now the widget IS the storefront layout. The theme block reports which page it is on,
 * the reviews API resolves that to the merchant's widget for that placement, and the
 * storefront script renders accordingly. The preview below is built from the same values
 * that get sent, so what a merchant sees here is what they get.
 */

const widgetTypes = [
  { id: 'carousel', name: 'Carousel', icon: Layers, desc: 'Sliding cards a shopper swipes through' },
  { id: 'grid', name: 'Grid', icon: Grid, desc: 'Even columns of equal-height cards' },
  { id: 'list', name: 'List', icon: LayoutList, desc: 'Stacked, full width. The safest default.' },
  { id: 'masonry', name: 'Masonry', icon: Columns, desc: 'Columns that flow, like Pinterest' },
  { id: 'badge', name: 'Star Badge', icon: Star, desc: 'Rating summary only — no review list' },
  { id: 'floating', name: 'Floating Widget', icon: Sparkles, desc: 'A pinned button that opens a panel' },
  { id: 'popup', name: 'Popup Modal', icon: MessageSquare, desc: 'Opens itself once, after a delay' },
  { id: 'sidebar', name: 'Sidebar', icon: Eye, desc: 'Slides in from the edge of the page' },
  { id: 'testimonial', name: 'Testimonials', icon: Star, desc: 'One featured quote, centred' },
];

const placements = [
  { value: 'product_page', label: 'Product page' },
  { value: 'collection_page', label: 'Collection page' },
  { value: 'home_page', label: 'Home page' },
  { value: 'all_pages', label: 'Anywhere' },
  { value: 'custom', label: 'Custom position' },
];

/** Layouts where columns are meaningful. A list has one column by definition. */
const USES_COLUMNS = new Set(['grid', 'masonry']);
const IS_OVERLAY = new Set(['floating', 'popup', 'sidebar']);

interface WidgetConfigShape {
  maxReviews: number;
  columns: number;
  borderRadius: number;
  popupDelay: number;
  autoPlay: boolean;
  showPhotos: boolean;
  showVerified: boolean;
  showSource: boolean;
  showReply: boolean;
  showHelpful: boolean;
  starColor: string;
  backgroundColor: string;
  textColor: string;
  sortBy: string;
}

const DEFAULT_WIDGET_CONFIG: WidgetConfigShape = {
  maxReviews: 10,
  columns: 3,
  borderRadius: 8,
  popupDelay: 5,
  autoPlay: false,
  showPhotos: true,
  showVerified: true,
  showSource: false,
  showReply: true,
  showHelpful: true,
  starColor: '#F5A623',
  backgroundColor: '#FFFFFF',
  textColor: '#1F2937',
  sortBy: 'recent',
};

interface Widget {
  id: string;
  name: string;
  widgetType: string;
  placement: string | null;
  isActive: boolean;
  config: string;
  createdAt: string;
}

const SAMPLE = [
  { name: 'Sarah M.', rating: 5, title: 'Absolutely love this', body: 'Exceeded my expectations. The quality is outstanding and it looks even better in person.', verified: true, date: '2 days ago' },
  { name: 'James K.', rating: 4, title: 'Great value', body: 'Good quality for the price. Works as described and shipping was fast.', verified: true, date: '5 days ago' },
  { name: 'Emily R.', rating: 5, title: 'Perfect purchase', body: 'Exactly what I was looking for. The fit is perfect and the material feels premium.', verified: false, date: '1 week ago' },
  { name: 'Michael T.', rating: 5, title: 'Highly recommend', body: 'Best purchase this year. Already recommended it to friends.', verified: true, date: '2 weeks ago' },
];

function Stars({ rating, color, size = 12 }: { rating: number; color: string; size?: number }) {
  return (
    <span style={{ letterSpacing: '1px', fontSize: size, lineHeight: 1 }}>
      {[1, 2, 3, 4, 5].map(s => (
        <span key={s} style={{ color: s <= rating ? color : '#d4d4d8' }}>★</span>
      ))}
    </span>
  );
}

/**
 * A real preview, driven by the same values that are about to be saved.
 *
 * Not a mockup image and not a hardcoded example per type: every colour, radius, column
 * count and toggle below feeds this, so a merchant can see the effect of a change before
 * committing it to a live storefront.
 */
function Preview({ type, cfg, device }: { type: string; cfg: WidgetConfigShape; device: 'desktop' | 'mobile' }) {
  const columns = device === 'mobile' ? 1 : USES_COLUMNS.has(type) ? cfg.columns : 1;

  const card = (r: typeof SAMPLE[number], i: number, extra: React.CSSProperties = {}) => (
    <div
      key={i}
      style={{
        background: cfg.backgroundColor,
        color: cfg.textColor,
        border: '1px solid #e5e7eb',
        borderRadius: cfg.borderRadius,
        padding: 12,
        breakInside: 'avoid',
        ...extra,
      }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <Stars rating={r.rating} color={cfg.starColor} />
        <span className="text-[11px] font-semibold">{r.name}</span>
        {cfg.showVerified && r.verified && (
          <span className="text-[9px] px-1.5 py-px rounded-full bg-emerald-50 text-emerald-700">Verified</span>
        )}
        {cfg.showSource && <span className="text-[9px] px-1.5 py-px rounded-full bg-slate-100 text-slate-600">Import</span>}
        <span className="text-[9px] opacity-50 ml-auto">{r.date}</span>
      </div>
      <p className="text-[11px] font-medium mt-1.5">{r.title}</p>
      <p className="text-[10px] mt-0.5 opacity-75 leading-relaxed">{r.body}</p>
      {cfg.showPhotos && i === 0 && (
        <div className="flex gap-1 mt-1.5">
          {[0, 1].map(k => (
            <div key={k} className="w-9 h-9 rounded bg-gradient-to-br from-slate-200 to-slate-300" style={{ borderRadius: Math.min(cfg.borderRadius, 8) }} />
          ))}
        </div>
      )}
      {cfg.showReply && i === 1 && (
        <div className="mt-1.5 pl-2 border-l-2 border-emerald-500 text-[10px] opacity-75">
          <strong>Store response</strong>
          <p className="mt-px">Thanks James — glad it arrived quickly.</p>
        </div>
      )}
      {cfg.showHelpful && (
        <div className="mt-2">
          <span className="text-[9px] border rounded-full px-2 py-0.5 opacity-70">Helpful</span>
        </div>
      )}
    </div>
  );

  if (type === 'badge') {
    return (
      <div style={{ border: '1px solid #e5e7eb', borderRadius: cfg.borderRadius, padding: 14, background: cfg.backgroundColor, color: cfg.textColor }} className="flex items-center gap-5 flex-wrap">
        <div>
          <p className="text-2xl font-bold leading-none">4.8</p>
          <Stars rating={5} color={cfg.starColor} size={14} />
          <p className="text-[10px] opacity-60 mt-1">Based on 156 reviews</p>
        </div>
        <div className="flex-1 min-w-[160px] space-y-1">
          {[[5, 65], [4, 22], [3, 8], [2, 3], [1, 2]].map(([s, pct]) => (
            <div key={s} className="flex items-center gap-2">
              <span className="text-[10px] w-4">{s}★</span>
              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: cfg.starColor }} />
              </div>
              <span className="text-[9px] opacity-50 w-6 text-right">{pct}%</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'testimonial') {
    const r = SAMPLE[0];
    return (
      <div style={{ background: cfg.backgroundColor, color: cfg.textColor, borderRadius: cfg.borderRadius, padding: 28 }} className="text-center border">
        <Stars rating={5} color={cfg.starColor} size={16} />
        <blockquote className="text-sm italic mt-3 leading-relaxed">&ldquo;{r.body}&rdquo;</blockquote>
        <p className="text-xs font-semibold mt-3">{r.name}</p>
        {cfg.showVerified && <p className="text-[10px] opacity-60">Verified Buyer</p>}
      </div>
    );
  }

  if (IS_OVERLAY.has(type)) {
    return (
      <div className="relative h-[300px] rounded-lg border bg-white overflow-hidden">
        {/* A stand-in storefront, so the overlay's position on the page is legible. */}
        <div className="p-4 space-y-2 opacity-30">
          <div className="h-24 bg-gray-200 rounded" />
          <div className="h-3 bg-gray-200 rounded w-2/3" />
          <div className="h-3 bg-gray-200 rounded w-1/2" />
          <div className="h-8 bg-gray-300 rounded w-32" />
        </div>

        {type === 'popup' ? (
          <>
            <div className="absolute inset-0 bg-black/40" />
            <div
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[78%] p-3 shadow-xl overflow-hidden"
              style={{ background: cfg.backgroundColor, color: cfg.textColor, borderRadius: cfg.borderRadius }}
            >
              <p className="text-[11px] font-bold mb-2">Customer reviews</p>
              <div className="space-y-2">{SAMPLE.slice(0, 2).map((r, i) => card(r, i))}</div>
            </div>
            <p className="absolute bottom-2 left-0 right-0 text-center text-[10px] text-muted-foreground">
              Opens after {cfg.popupDelay}s, once per visit
            </p>
          </>
        ) : (
          <>
            <div
              className="absolute right-0 top-0 bottom-0 w-[62%] p-3 shadow-xl overflow-hidden"
              style={{ background: cfg.backgroundColor, color: cfg.textColor }}
            >
              <p className="text-[11px] font-bold mb-2">Customer reviews</p>
              <div className="space-y-2">{SAMPLE.slice(0, 2).map((r, i) => card(r, i))}</div>
            </div>
            <div className="absolute right-3 bottom-3 px-3 py-1.5 rounded-full text-[10px] text-white shadow-lg" style={{ background: '#059669' }}>
              ★ See all reviews
            </div>
          </>
        )}
      </div>
    );
  }

  if (type === 'carousel') {
    return (
      <div>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {SAMPLE.slice(0, Math.min(4, cfg.maxReviews)).map((r, i) => card(r, i, { minWidth: 230, maxWidth: 230, flex: '0 0 auto' }))}
        </div>
        <div className="flex justify-end gap-1.5 mt-1">
          <span className="w-6 h-6 rounded border flex items-center justify-center text-xs">‹</span>
          <span className="w-6 h-6 rounded border flex items-center justify-center text-xs">›</span>
        </div>
        {cfg.autoPlay && <p className="text-[10px] text-muted-foreground mt-1">Advances every 5s until a shopper interacts</p>}
      </div>
    );
  }

  if (type === 'masonry') {
    return (
      <div style={{ columnCount: columns, columnGap: 12 }}>
        {SAMPLE.slice(0, Math.min(4, cfg.maxReviews)).map((r, i) =>
          card(r, i, { marginBottom: 12, display: 'inline-block', width: '100%' })
        )}
      </div>
    );
  }

  // list and grid
  return (
    <div style={{ display: 'grid', gap: 12, gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))` }}>
      {SAMPLE.slice(0, Math.min(type === 'list' ? 3 : 4, cfg.maxReviews)).map((r, i) => card(r, i))}
    </div>
  );
}

export default function WidgetsPage() {
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedType, setSelectedType] = useState<string>('list');
  const [name, setName] = useState('List Widget');
  const [placement, setPlacement] = useState('product_page');
  const [cfg, setCfg] = useState<WidgetConfigShape>({ ...DEFAULT_WIDGET_CONFIG });
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');

  // `loading` starts true and is only ever cleared, so this never calls setState
  // synchronously from the effect body. A silent refetch after saving is also the better
  // behaviour — flashing the skeleton back in would hide the list the merchant just
  // added to.
  const reload = useCallback(() => {
    apiFetch<{ widgets: Widget[] }>('/api/widgets')
      .then(d => setWidgets(d.widgets || []))
      .catch(err => toast.error(errorMessage(err, 'Could not load your widgets')))
      .finally(() => setLoading(false));
  }, []);

  useEffect(reload, [reload]);

  const set = <K extends keyof WidgetConfigShape>(k: K, v: WidgetConfigShape[K]) =>
    setCfg(c => ({ ...c, [k]: v }));

  /**
   * The widget that currently governs this placement.
   *
   * Mirrors the server's resolution order in getStorefrontConfig: exact placement, then
   * "anywhere", then a lone widget. Shown to the merchant so saving a second widget for
   * the same placement is not a silent no-op.
   */
  const governing = useMemo(() => {
    const active = widgets.filter(w => w.isActive);
    return (
      active.find(w => w.placement === placement) ||
      active.find(w => w.placement === 'all_pages') ||
      (active.length === 1 ? active[0] : null)
    );
  }, [widgets, placement]);

  const conflict = governing && governing.id !== editingId && governing.placement === placement;

  const startNew = (typeId: string) => {
    const t = widgetTypes.find(w => w.id === typeId);
    setEditingId(null);
    setSelectedType(typeId);
    setName(`${t?.name ?? 'Review'} Widget`);
    setCfg({ ...DEFAULT_WIDGET_CONFIG });
  };

  const startEdit = (w: Widget) => {
    setEditingId(w.id);
    setSelectedType(w.widgetType);
    setName(w.name);
    setPlacement(w.placement || 'product_page');
    let parsed: Partial<WidgetConfigShape> = {};
    try {
      parsed = JSON.parse(w.config || '{}');
    } catch {
      // A row saved by an older build could hold anything. Falling back to defaults is
      // better than showing a broken form.
    }
    // Older rows stored numbers as strings, because the form used text inputs.
    setCfg({
      ...DEFAULT_WIDGET_CONFIG,
      ...parsed,
      maxReviews: Number(parsed.maxReviews) || DEFAULT_WIDGET_CONFIG.maxReviews,
      columns: Number(parsed.columns) || DEFAULT_WIDGET_CONFIG.columns,
      borderRadius: Number(parsed.borderRadius ?? DEFAULT_WIDGET_CONFIG.borderRadius),
      popupDelay: Number(parsed.popupDelay ?? DEFAULT_WIDGET_CONFIG.popupDelay),
    });
  };

  const save = async () => {
    if (!name.trim()) {
      toast.error('Give the widget a name');
      return;
    }
    setSaving(true);
    try {
      const payload = { name: name.trim(), widgetType: selectedType, placement, config: cfg, isActive: true };
      if (editingId) {
        await apiFetch('/api/widgets', { method: 'PUT', body: JSON.stringify({ id: editingId, ...payload }) });
        toast.success('Widget updated. Your storefront picks this up within about five minutes.');
      } else {
        await apiFetch('/api/widgets', { method: 'POST', body: JSON.stringify(payload) });
        toast.success('Widget saved and live on your storefront.');
      }
      reload();
      setEditingId(null);
    } catch (err) {
      if (err instanceof ApiError && err.isPlanLimit) {
        toast.error(err.userMessage, { description: 'Open Settings → Plan to upgrade.', duration: 8000 });
      } else {
        toast.error(errorMessage(err, 'Could not save the widget'));
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (w: Widget) => {
    try {
      await apiFetch('/api/widgets', {
        method: 'PUT',
        body: JSON.stringify({ id: w.id, isActive: !w.isActive }),
      });
      setWidgets(ws => ws.map(x => (x.id === w.id ? { ...x, isActive: !x.isActive } : x)));
    } catch (err) {
      toast.error(errorMessage(err, 'Could not change that'));
    }
  };

  const remove = async (id: string) => {
    try {
      await apiFetch('/api/widgets', { method: 'DELETE', body: JSON.stringify({ id }) });
      toast.success('Widget deleted');
      setWidgets(ws => ws.filter(w => w.id !== id));
      if (editingId === id) setEditingId(null);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete the widget'));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">Widget builder</h2>
        <p className="text-xs text-muted-foreground">
          Choose how reviews look on each part of your storefront. Changes go live without touching your theme.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* ── Left: type, settings, saved widgets ────────────────────────────────── */}
        <div className="space-y-4">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Widget type</CardTitle>
              <CardDescription className="text-xs">Choose how reviews are displayed</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2">
                {widgetTypes.map(wt => (
                  <button
                    key={wt.id}
                    type="button"
                    title={wt.desc}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                      selectedType === wt.id ? 'border-emerald-500 bg-emerald-50 shadow-sm' : 'border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => (editingId ? setSelectedType(wt.id) : startNew(wt.id))}
                  >
                    <wt.icon className={`w-5 h-5 ${selectedType === wt.id ? 'text-emerald-600' : 'text-gray-400'}`} />
                    <p className="text-[11px] font-semibold mt-1.5">{wt.name}</p>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground mt-3">
                {widgetTypes.find(w => w.id === selectedType)?.desc}
              </p>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">
                {editingId ? 'Edit widget' : 'New widget'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Name</Label>
                  <Input className="h-8 text-xs mt-1" value={name} onChange={e => setName(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Where it appears</Label>
                  <Select value={placement} onValueChange={setPlacement}>
                    <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {placements.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {conflict && (
                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-2">
                  <strong>{governing!.name}</strong> already governs the {placements.find(p => p.value === placement)?.label.toLowerCase()}.
                  Saving this one will take over — or edit that widget instead.
                </p>
              )}

              <Separator />

              <div className="space-y-3">
                <Label className="text-xs font-medium">Layout</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Reviews shown</Label>
                    <Input type="number" min={1} max={50} className="h-8 text-xs mt-1" value={cfg.maxReviews} onChange={e => set('maxReviews', Number(e.target.value))} />
                  </div>
                  {USES_COLUMNS.has(selectedType) && (
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Columns</Label>
                      <Select value={String(cfg.columns)} onValueChange={v => set('columns', Number(v))}>
                        <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[2, 3, 4].map(n => <SelectItem key={n} value={String(n)}>{n} columns</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Corner radius</Label>
                    <Input type="number" min={0} max={40} className="h-8 text-xs mt-1" value={cfg.borderRadius} onChange={e => set('borderRadius', Number(e.target.value))} />
                  </div>
                  {selectedType === 'popup' && (
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Open after (seconds)</Label>
                      <Input type="number" min={0} max={120} className="h-8 text-xs mt-1" value={cfg.popupDelay} onChange={e => set('popupDelay', Number(e.target.value))} />
                    </div>
                  )}
                  <div>
                    <Label className="text-[11px] text-muted-foreground">Sort by</Label>
                    <Select value={cfg.sortBy} onValueChange={v => set('sortBy', v)}>
                      <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="recent">Most recent</SelectItem>
                        <SelectItem value="highest">Highest rating</SelectItem>
                        <SelectItem value="lowest">Lowest rating</SelectItem>
                        <SelectItem value="helpful">Most helpful</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {selectedType === 'carousel' && (
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs">Advance automatically</span>
                      <p className="text-[10px] text-muted-foreground">Stops the moment a shopper interacts</p>
                    </div>
                    <Switch checked={cfg.autoPlay} onCheckedChange={v => set('autoPlay', v)} />
                  </div>
                )}
              </div>

              <Separator />

              <div className="space-y-3">
                <Label className="text-xs font-medium">Colours</Label>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    ['starColor', 'Stars'],
                    ['backgroundColor', 'Card'],
                    ['textColor', 'Text'],
                  ] as const).map(([key, label]) => (
                    <div key={key}>
                      <Label className="text-[11px] text-muted-foreground">{label}</Label>
                      <div className="flex gap-1.5 mt-1">
                        <input type="color" value={cfg[key]} onChange={e => set(key, e.target.value)} className="w-8 h-8 rounded border cursor-pointer p-0" aria-label={label} />
                        <Input className="h-8 text-[11px] flex-1 font-mono" value={cfg[key]} onChange={e => set(key, e.target.value)} spellCheck={false} />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  These override your account colours for this placement only. Leave them alone to inherit Settings → Display.
                </p>
              </div>

              <Separator />

              <div className="space-y-3">
                <Label className="text-xs font-medium">What each review shows</Label>
                {([
                  ['showPhotos', 'Photos and video'],
                  ['showVerified', 'Verified Purchase badge'],
                  ['showSource', 'Source badge'],
                  ['showReply', 'Your replies'],
                  ['showHelpful', '“Helpful” button'],
                ] as const).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{label}</span>
                    <Switch checked={cfg[key]} onCheckedChange={v => set(key, v)} />
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Button onClick={save} disabled={saving} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-xs gap-1.5">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {editingId ? 'Update widget' : 'Save widget'}
                </Button>
                {editingId && (
                  <Button variant="outline" className="text-xs" onClick={() => { setEditingId(null); startNew(selectedType); }}>
                    Cancel
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Your widgets ({widgets.length})</CardTitle>
              <CardDescription className="text-xs">
                One widget governs each placement. Inactive widgets are kept but ignored.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="h-16 bg-gray-100 rounded-lg animate-pulse" />
              ) : widgets.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No widgets yet — your storefront is using the default list layout.
                </p>
              ) : (
                <div className="space-y-2">
                  {widgets.map(w => {
                    const T = widgetTypes.find(t => t.id === w.widgetType);
                    const isGoverning = governing?.id === w.id;
                    return (
                      <div key={w.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${w.isActive ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-200 text-gray-400'}`}>
                          {T ? <T.icon className="w-4 h-4" /> : <Star className="w-4 h-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate">{w.name}</p>
                          <p className="text-[10px] text-muted-foreground capitalize">
                            {T?.name ?? w.widgetType} · {placements.find(p => p.value === w.placement)?.label ?? 'Anywhere'}
                          </p>
                        </div>
                        {isGoverning && (
                          <Badge className="text-[10px] h-5 px-1.5 bg-emerald-600 text-white gap-1">
                            <CheckCircle2 className="w-2.5 h-2.5" /> Live
                          </Badge>
                        )}
                        <Switch checked={w.isActive} onCheckedChange={() => toggleActive(w)} aria-label="Active" />
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(w)} aria-label="Edit">
                          <Pencil className="w-3.5 h-3.5 text-gray-500" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(w.id)} aria-label="Delete">
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── Right: preview and install ─────────────────────────────────────────── */}
        <div className="space-y-4">
          <Card className="border-0 shadow-sm sticky top-4">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm">Live preview</CardTitle>
                  <CardDescription className="text-xs">Built from the settings on the left</CardDescription>
                </div>
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                  <Button variant={device === 'desktop' ? 'secondary' : 'ghost'} size="sm" className="h-6 text-[10px] gap-1" onClick={() => setDevice('desktop')}>
                    <Monitor className="w-3 h-3" /> Desktop
                  </Button>
                  <Button variant={device === 'mobile' ? 'secondary' : 'ghost'} size="sm" className="h-6 text-[10px] gap-1" onClick={() => setDevice('mobile')}>
                    <Smartphone className="w-3 h-3" /> Mobile
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className={`bg-gray-50 rounded-xl p-4 border ${device === 'mobile' ? 'max-w-[375px] mx-auto' : ''}`}>
                <Preview type={selectedType} cfg={cfg} device={device} />
              </div>
            </CardContent>
          </Card>

          {/*
            Real installation instructions. The previous version of this screen offered an
            embed snippet pointing at cdn.reviewmaster.app — a domain that does not exist —
            so any merchant who followed it got nothing.
          */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Info className="w-4 h-4 text-emerald-600" /> Putting this on your storefront
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-2.5 text-muted-foreground">
              <p>
                <strong className="text-foreground">1.</strong> In Shopify admin, go to
                {' '}<strong className="text-foreground">Online Store → Themes → Customize</strong>.
              </p>
              <p>
                <strong className="text-foreground">2.</strong> Open the page you want reviews on, then
                {' '}<strong className="text-foreground">Add block → Apps → Product reviews</strong>.
              </p>
              <p>
                <strong className="text-foreground">3.</strong> In the block&rsquo;s settings, set
                {' '}<strong className="text-foreground">&ldquo;This block is on&rdquo;</strong> to
                {' '}<strong className="text-foreground">{placements.find(p => p.value === placement)?.label}</strong>{' '}
                so it uses this widget.
              </p>
              <p className="pt-1 border-t">
                No theme code to edit, and everything is removed cleanly if you ever uninstall the app.
                Storefront changes appear within about five minutes.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
