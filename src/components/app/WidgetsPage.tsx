'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Star, Grid, Layers, LayoutList, Columns, MessageSquare, Eye, Sparkles,
  Monitor, Smartphone, Trash2, Save, Loader2, Info, CheckCircle2, Pencil,
  Check, AlertTriangle, Palette, SlidersHorizontal, ListChecks, Blocks, Lock,
} from 'lucide-react';
import { useConfirm } from './confirm';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';
import { apiFetch, ApiError, errorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Panel, PanelHeader, Pill, ActionButton, EmptyState, Skeleton } from './ui-kit';

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
          <span className="text-[9px] px-1.5 py-px rounded-full bg-brand-50 text-brand-700">Verified</span>
        )}
        {cfg.showSource && <span className="text-[9px] px-1.5 py-px rounded-full bg-ink-100 text-ink-500">Import</span>}
        <span className="text-[9px] opacity-50 ml-auto">{r.date}</span>
      </div>
      <p className="text-[11px] font-medium mt-1.5">{r.title}</p>
      <p className="text-[10px] mt-0.5 opacity-75 leading-relaxed">{r.body}</p>
      {cfg.showPhotos && i === 0 && (
        <div className="flex gap-1 mt-1.5">
          {[0, 1].map(k => (
            <div key={k} className="w-9 h-9 rounded bg-gradient-to-br from-ink-200 to-ink-300" style={{ borderRadius: Math.min(cfg.borderRadius, 8) }} />
          ))}
        </div>
      )}
      {cfg.showReply && i === 1 && (
        // The storefront draws this rule in the accent colour (--rm-accent, #059669).
        <div className="mt-1.5 pl-2 border-l-2 text-[10px] opacity-75" style={{ borderLeftColor: '#059669' }}>
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
          <p className="tnum text-2xl font-bold leading-none display">4.8</p>
          <Stars rating={5} color={cfg.starColor} size={14} />
          <p className="tnum text-[10px] opacity-60 mt-1">Based on 156 reviews</p>
        </div>
        <div className="flex-1 min-w-[160px] space-y-1">
          {[[5, 65], [4, 22], [3, 8], [2, 3], [1, 2]].map(([s, pct]) => (
            <div key={s} className="flex items-center gap-2">
              <span className="tnum text-[10px] w-4">{s}★</span>
              <div className="flex-1 h-1.5 bg-ink-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: cfg.starColor }} />
              </div>
              <span className="tnum text-[9px] opacity-50 w-6 text-right">{pct}%</span>
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
      <div className="relative h-[300px] rounded-xl border bg-white overflow-hidden">
        {/* A stand-in storefront, so the overlay's position on the page is legible. */}
        <div className="p-4 space-y-2 opacity-30">
          <div className="h-24 bg-ink-200 rounded-lg" />
          <div className="h-3 bg-ink-200 rounded w-2/3" />
          <div className="h-3 bg-ink-200 rounded w-1/2" />
          <div className="h-8 bg-ink-300 rounded-lg w-32" />
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
            <p className="tnum absolute bottom-2 left-0 right-0 text-center text-[10px] text-ink-400">
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
        <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar">
          {SAMPLE.slice(0, Math.min(4, cfg.maxReviews)).map((r, i) => card(r, i, { minWidth: 230, maxWidth: 230, flex: '0 0 auto' }))}
        </div>
        <div className="flex justify-end gap-1.5 mt-1">
          <span className="w-6 h-6 rounded-lg border flex items-center justify-center text-xs">‹</span>
          <span className="w-6 h-6 rounded-lg border flex items-center justify-center text-xs">›</span>
        </div>
        {cfg.autoPlay && <p className="text-[10px] text-ink-400 mt-1">Advances every 5s until a shopper interacts</p>}
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

/** One label treatment for every field in the builder, so the form reads as one form. */
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-[11.5px] font-medium text-ink-500">{children}</Label>
  );
}

export default function WidgetsPage() {
  const confirm = useConfirm();
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
    const ok = await confirm({
      title: 'Delete this widget?',
      body: 'It stops appearing on your storefront immediately. Its layout and colour settings are not kept, so rebuilding it means configuring it again.',
      confirmLabel: 'Delete widget',
    });
    if (!ok) return;
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
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      {/* ── Left: type, settings, saved widgets ────────────────────────────────── */}
      <div className="stagger space-y-4">
        <Panel>
          <PanelHeader
            title="Widget type"
            description="Choose how reviews are displayed."
            icon={Blocks}
            tone="brand"
            action={<Pill tone="neutral" className="tnum">{widgetTypes.length} layouts</Pill>}
          />
          <div className="px-5 pb-5">
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {widgetTypes.map(wt => {
                const active = selectedType === wt.id;
                return (
                  <button
                    key={wt.id}
                    type="button"
                    title={wt.desc}
                    aria-pressed={active}
                    className={cn(
                      'ring-focus relative rounded-2xl p-3 text-left transition-all duration-200',
                      active
                        ? 'surface-float is-selected -translate-y-0.5'
                        : 'surface-raised lift'
                    )}
                    onClick={() => (editingId ? setSelectedType(wt.id) : startNew(wt.id))}
                  >
                    {active && (
                      <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-brand-600 text-white shadow-[var(--glow-brand)]">
                        <Check className="size-3" strokeWidth={3.5} />
                      </span>
                    )}
                    <span
                      className={cn(
                        'tile size-8',
                        active
                          ? 'tile-brand'
                          : 'bg-ink-100 text-ink-500 dark:bg-white/8 dark:text-ink-300'
                      )}
                    >
                      <wt.icon className="size-4" strokeWidth={2.2} />
                    </span>
                    <p className="mt-2 text-[12.5px] font-semibold leading-tight text-ink-900 dark:text-white">
                      {wt.name}
                    </p>
                  </button>
                );
              })}
            </div>
            <p className="mt-3.5 flex items-start gap-1.5 text-[12.5px] leading-snug text-ink-500">
              <Sparkles className="mt-px size-3.5 shrink-0 text-brand-500" strokeWidth={2.4} />
              {widgetTypes.find(w => w.id === selectedType)?.desc}
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title={editingId ? 'Edit widget' : 'New widget'}
            description="Name it, then pick which part of your storefront it governs."
            icon={Pencil}
            tone="indigo"
            action={
              editingId
                ? <Pill tone="amber" icon={Pencil}>Editing</Pill>
                : <Pill tone="brand" icon={Sparkles}>Draft</Pill>
            }
          />
          <div className="space-y-4 px-5 pb-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel>Name</FieldLabel>
                <Input className="mt-1.5 h-9 rounded-xl text-[13px]" value={name} onChange={e => setName(e.target.value)} />
              </div>
              <div>
                <FieldLabel>Where it appears</FieldLabel>
                <Select value={placement} onValueChange={setPlacement}>
                  <SelectTrigger className="mt-1.5 h-9 w-full rounded-xl text-[13px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {placements.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {conflict && (
              <div className="flex gap-2.5 rounded-xl border border-amber-200/70 bg-amber-50/70 p-3 dark:border-amber-400/15 dark:bg-amber-500/[0.07]">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" />
                <p className="text-[12px] leading-relaxed text-amber-900 dark:text-amber-100">
                  <strong className="font-semibold">{governing!.name}</strong> already governs the {placements.find(p => p.value === placement)?.label.toLowerCase()}.
                  Saving this one will take over — or edit that widget instead.
                </p>
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Layout"
            description="How much is shown, and the shape of each card."
            icon={SlidersHorizontal}
            tone="cyan"
          />
          <div className="space-y-3.5 px-5 pb-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <FieldLabel>Reviews shown</FieldLabel>
                <Input type="number" min={1} max={50} className="tnum mt-1.5 h-9 rounded-xl text-[13px]" value={cfg.maxReviews} onChange={e => set('maxReviews', Number(e.target.value))} />
              </div>
              {USES_COLUMNS.has(selectedType) && (
                <div>
                  <FieldLabel>Columns</FieldLabel>
                  <Select value={String(cfg.columns)} onValueChange={v => set('columns', Number(v))}>
                    <SelectTrigger className="mt-1.5 h-9 w-full rounded-xl text-[13px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[2, 3, 4].map(n => <SelectItem key={n} value={String(n)}>{n} columns</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div>
                <FieldLabel>Corner radius</FieldLabel>
                <div className="mt-1.5 flex items-center gap-2">
                  <Input type="number" min={0} max={40} className="tnum h-9 flex-1 rounded-xl text-[13px]" value={cfg.borderRadius} onChange={e => set('borderRadius', Number(e.target.value))} />
                  {/* A live shape chip: the number means nothing until you see the corner. */}
                  <span
                    aria-hidden
                    className="size-9 shrink-0 border border-border bg-ink-100 dark:bg-white/8"
                    style={{ borderRadius: Math.min(cfg.borderRadius, 18) }}
                  />
                </div>
              </div>
              {selectedType === 'popup' && (
                <div>
                  <FieldLabel>Open after (seconds)</FieldLabel>
                  <Input type="number" min={0} max={120} className="tnum mt-1.5 h-9 rounded-xl text-[13px]" value={cfg.popupDelay} onChange={e => set('popupDelay', Number(e.target.value))} />
                </div>
              )}
              <div>
                <FieldLabel>Sort by</FieldLabel>
                <Select value={cfg.sortBy} onValueChange={v => set('sortBy', v)}>
                  <SelectTrigger className="mt-1.5 h-9 w-full rounded-xl text-[13px]"><SelectValue /></SelectTrigger>
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
              <div className="animate-rise flex items-center justify-between gap-3 rounded-xl bg-ink-50 px-3 py-2.5 dark:bg-white/[0.03]">
                <div className="min-w-0">
                  <span className="text-[12.5px] font-medium text-ink-800 dark:text-white">Advance automatically</span>
                  <p className="text-[11.5px] leading-snug text-ink-500">Stops the moment a shopper interacts</p>
                </div>
                <Switch checked={cfg.autoPlay} onCheckedChange={v => set('autoPlay', v)} aria-label="Advance automatically" />
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Colours"
            description="These override your account colours for this placement only."
            icon={Palette}
            tone="violet"
          />
          <div className="px-5 pb-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {([
                ['starColor', 'Stars'],
                ['backgroundColor', 'Card'],
                ['textColor', 'Text'],
              ] as const).map(([key, label]) => (
                <div key={key}>
                  <FieldLabel>{label}</FieldLabel>
                  <div className="mt-1.5 flex gap-2">
                    {/* Real swatch: the native picker sits invisibly on top of it. */}
                    <span
                      className="relative size-9 shrink-0 overflow-hidden rounded-xl ring-1 ring-inset ring-ink-900/12 shadow-[inset_0_1px_0_rgba(255,255,255,.45)] dark:ring-white/15"
                      style={{ background: cfg[key] }}
                    >
                      <input type="color" value={cfg[key]} onChange={e => set(key, e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" aria-label={label} />
                    </span>
                    <Input className="h-9 min-w-0 flex-1 rounded-xl font-mono text-[12px]" value={cfg[key]} onChange={e => set(key, e.target.value)} spellCheck={false} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11.5px] leading-snug text-ink-400">
              Leave them alone to inherit Settings → Display.
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="What each review shows"
            description="Trim a card down to only the parts you want shoppers reading."
            icon={ListChecks}
            tone="amber"
          />
          <div className="px-5 pb-5">
            <div className="overflow-hidden rounded-xl border border-border">
              {([
                ['showPhotos', 'Photos and video'],
                ['showVerified', 'Verified Purchase badge'],
                ['showSource', 'Source badge'],
                ['showReply', 'Your replies'],
                ['showHelpful', '“Helpful” button'],
              ] as const).map(([key, label], i) => (
                <div
                  key={key}
                  className={cn(
                    'flex items-center justify-between gap-3 bg-card px-3 py-2.5',
                    i > 0 && 'border-t border-border'
                  )}
                >
                  <span className="text-[12.5px] text-ink-700 dark:text-ink-200">{label}</span>
                  <Switch checked={cfg[key]} onCheckedChange={v => set(key, v)} aria-label={label} />
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel elevation="float" className="flex flex-wrap items-center gap-2 p-3">
          <ActionButton onClick={save} disabled={saving} className="min-w-[168px] flex-1">
            {saving ? <Loader2 className="size-4 animate-spin" strokeWidth={2.4} /> : <Save className="size-4" strokeWidth={2.4} />}
            {editingId ? 'Update widget' : 'Save widget'}
          </ActionButton>
          {editingId && (
            <ActionButton variant="outline" onClick={() => { setEditingId(null); startNew(selectedType); }}>
              Cancel
            </ActionButton>
          )}
          <p className="w-full text-[11.5px] leading-snug text-ink-400 sm:w-auto sm:flex-1 sm:text-right">
            Live on your storefront within about five minutes.
          </p>
        </Panel>

        <Panel>
          <PanelHeader
            title="Your widgets"
            description="One widget governs each placement. Inactive widgets are kept but ignored."
            icon={Layers}
            tone="ink"
            action={<Pill tone="neutral" className="tnum">{widgets.length}</Pill>}
          />
          <div className="px-5 pb-5">
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl border border-border p-2.5">
                    <Skeleton className="size-9 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-3 w-1/3" />
                      <Skeleton className="h-2.5 w-1/4" />
                    </div>
                    <Skeleton className="h-5 w-8 rounded-full" />
                  </div>
                ))}
              </div>
            ) : widgets.length === 0 ? (
              <EmptyState
                icon={LayoutList}
                tone="indigo"
                title="No widgets yet"
                description="Your storefront is using the default list layout. Pick a type above, then save it to take over."
              />
            ) : (
              <div className="space-y-2">
                {widgets.map(w => {
                  const T = widgetTypes.find(t => t.id === w.widgetType);
                  const isGoverning = governing?.id === w.id;
                  return (
                    <div
                      key={w.id}
                      className={cn(
                        'flex items-center gap-2.5 rounded-xl border p-2.5 transition-colors',
                        isGoverning
                          ? 'border-brand-500/35 bg-brand-50/60 dark:border-brand-400/25 dark:bg-brand-500/[0.07]'
                          : 'border-border bg-ink-50/70 dark:bg-white/[0.03]'
                      )}
                    >
                      <span
                        className={cn(
                          'tile size-9 shrink-0',
                          w.isActive ? 'tile-brand' : 'bg-ink-200 text-ink-400 dark:bg-white/8 dark:text-ink-400'
                        )}
                      >
                        {T ? <T.icon className="size-4" strokeWidth={2.2} /> : <Star className="size-4" strokeWidth={2.2} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-ink-900 dark:text-white">{w.name}</p>
                        <p className="mt-0.5 truncate text-[11.5px] text-ink-500">
                          {T?.name ?? w.widgetType} · {placements.find(p => p.value === w.placement)?.label ?? 'Anywhere'}
                        </p>
                      </div>
                      {isGoverning && (
                        <Pill tone="brand" icon={CheckCircle2}>Live</Pill>
                      )}
                      <Switch checked={w.isActive} onCheckedChange={() => toggleActive(w)} aria-label="Active" />
                      <ActionButton
                        variant="ghost"
                        size="sm"
                        className="px-2"
                        onClick={() => startEdit(w)}
                        aria-label="Edit"
                        title="Edit"
                      >
                        <Pencil className="size-3.5" />
                      </ActionButton>
                      <ActionButton
                        variant="ghost"
                        size="sm"
                        className="px-2 text-rose-500 hover:bg-rose-50 hover:text-rose-600 dark:text-rose-400 dark:hover:bg-rose-500/12"
                        onClick={() => remove(w.id)}
                        aria-label="Delete"
                        title="Delete"
                      >
                        <Trash2 className="size-3.5" />
                      </ActionButton>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Panel>
      </div>

      {/* ── Right: preview and install ─────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="sticky top-28 space-y-4">
          <Panel elevation="hero">
            <PanelHeader
              title="Live preview"
              description="Built from the settings on the left."
              icon={Eye}
              tone="brand"
              action={
                <div className="flex items-center gap-0.5 rounded-xl bg-ink-100 p-0.5 dark:bg-white/8">
                  {([
                    ['desktop', Monitor, 'Desktop'],
                    ['mobile', Smartphone, 'Mobile'],
                  ] as const).map(([id, Icon, label]) => (
                    <button
                      key={id}
                      type="button"
                      aria-pressed={device === id}
                      onClick={() => setDevice(id)}
                      className={cn(
                        'ring-focus inline-flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[11.5px] font-semibold transition-all',
                        device === id
                          ? 'bg-card text-ink-900 shadow-[var(--elev-1)] dark:text-white'
                          : 'text-ink-500 hover:text-ink-700 dark:hover:text-ink-200'
                      )}
                    >
                      <Icon className="size-3.5" strokeWidth={2.4} />
                      {label}
                    </button>
                  ))}
                </div>
              }
            />
            <div className="px-5 pb-5">
              {/* A stage rather than a plain box: chrome + grid backdrop reads as "your store". */}
              <div className="relative overflow-hidden rounded-2xl border border-border bg-ink-50/80 dark:bg-white/[0.02]">
                <div className="grid-lines pointer-events-none absolute inset-0" aria-hidden />

                <div className="relative flex items-center gap-2 border-b border-border bg-card/70 px-3 py-2 backdrop-blur-sm">
                  <span className="flex shrink-0 gap-1.5" aria-hidden>
                    <span className="size-2.5 rounded-full bg-rose-400/80" />
                    <span className="size-2.5 rounded-full bg-amber-400/80" />
                    <span className="size-2.5 rounded-full bg-brand-400/80" />
                  </span>
                  <span className="ml-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-ink-100 px-2.5 py-1 text-[10.5px] text-ink-500 dark:bg-white/8">
                    <Lock className="size-2.5 shrink-0" strokeWidth={2.6} />
                    <span className="truncate">
                      your-store.myshopify.com{placement === 'product_page' ? '/products/…' : placement === 'collection_page' ? '/collections/…' : ''}
                    </span>
                  </span>
                  <span className="tnum hidden shrink-0 rounded-full bg-ink-100 px-2 py-0.5 text-[10.5px] font-semibold text-ink-500 sm:inline-block dark:bg-white/8">
                    {device === 'mobile' ? '375px' : 'Desktop'}
                  </span>
                </div>

                <div className={cn('relative p-4', device === 'mobile' && 'mx-auto max-w-[375px]')}>
                  <Preview type={selectedType} cfg={cfg} device={device} />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Pill tone="indigo">{widgetTypes.find(w => w.id === selectedType)?.name ?? selectedType}</Pill>
                <Pill tone="cyan">{placements.find(p => p.value === placement)?.label ?? 'Anywhere'}</Pill>
                <Pill tone="neutral" className="tnum">{cfg.maxReviews} shown</Pill>
                {USES_COLUMNS.has(selectedType) && (
                  <Pill tone="neutral" className="tnum">{cfg.columns} columns</Pill>
                )}
              </div>
            </div>
          </Panel>

          {/*
            Real installation instructions. The previous version of this screen offered an
            embed snippet pointing at cdn.reviewmaster.app — a domain that does not exist —
            so any merchant who followed it got nothing.
          */}
          <Panel>
            <PanelHeader
              title="Putting this on your storefront"
              description="Three steps in your theme editor. No code."
              icon={Info}
              tone="cyan"
            />
            <div className="px-5 pb-5">
              <ol className="space-y-3">
                <li className="flex gap-2.5">
                  <span className="tnum mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700 ring-1 ring-inset ring-brand-600/15 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-400/20">1</span>
                  <p className="text-[12.5px] leading-relaxed text-ink-500">
                    In Shopify admin, go to
                    {' '}<strong className="font-semibold text-ink-800 dark:text-white">Online Store → Themes → Customize</strong>.
                  </p>
                </li>
                <li className="flex gap-2.5">
                  <span className="tnum mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700 ring-1 ring-inset ring-brand-600/15 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-400/20">2</span>
                  <p className="text-[12.5px] leading-relaxed text-ink-500">
                    Open the page you want reviews on, then
                    {' '}<strong className="font-semibold text-ink-800 dark:text-white">Add block → Apps → Product reviews</strong>.
                  </p>
                </li>
                <li className="flex gap-2.5">
                  <span className="tnum mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-bold text-brand-700 ring-1 ring-inset ring-brand-600/15 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-400/20">3</span>
                  <p className="text-[12.5px] leading-relaxed text-ink-500">
                    In the block&rsquo;s settings, set
                    {' '}<strong className="font-semibold text-ink-800 dark:text-white">&ldquo;This block is on&rdquo;</strong> to
                    {' '}<strong className="font-semibold text-ink-800 dark:text-white">{placements.find(p => p.value === placement)?.label}</strong>{' '}
                    so it uses this widget.
                  </p>
                </li>
              </ol>
              <p className="mt-4 flex items-start gap-2 border-t border-border pt-3.5 text-[12px] leading-relaxed text-ink-400">
                <CheckCircle2 className="mt-px size-3.5 shrink-0 text-brand-500" strokeWidth={2.4} />
                <span>
                  No theme code to edit, and everything is removed cleanly if you ever uninstall the app.
                  Storefront changes appear within about five minutes.
                </span>
              </p>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
