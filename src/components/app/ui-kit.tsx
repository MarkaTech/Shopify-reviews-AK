'use client';

import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Star, ArrowUpRight, type LucideIcon } from 'lucide-react';

/**
 * The shared visual vocabulary for every screen in the app.
 *
 * The point of centralising this is consistency under pressure: eight page
 * components edited at different times will otherwise drift into eight slightly
 * different card paddings, four shadow depths and three shades of "muted grey",
 * and that inconsistency is precisely what makes software look cheap. A merchant
 * cannot name it, but they read it instantly.
 *
 * Depth, gradients and motion live in globals.css as utility classes; this file
 * composes them into the handful of shapes the app actually uses.
 */

/* ────────────────────────────────────────────────────────────────────────────
   Cards
   ──────────────────────────────────────────────────────────────────────────── */

export function Panel({
  className,
  interactive,
  elevation = 'raised',
  children,
  ...props
}: React.ComponentProps<'div'> & {
  interactive?: boolean;
  elevation?: 'flat' | 'raised' | 'float' | 'hero';
}) {
  return (
    <div
      className={cn(
        'rounded-2xl',
        elevation === 'flat' && 'surface',
        elevation === 'raised' && 'surface-raised',
        elevation === 'float' && 'surface-float',
        elevation === 'hero' && 'surface-hero',
        interactive && 'lift cursor-pointer',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function PanelHeader({
  title,
  description,
  icon: Icon,
  tone = 'ink',
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  tone?: TileTone;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-5 pb-4', className)}>
      <div className="flex items-start gap-3 min-w-0">
        {Icon && (
          <span className={cn('tile size-9 shrink-0', TILE_TONE[tone])}>
            <Icon className="size-[18px]" strokeWidth={2.2} />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold text-ink-900 dark:text-white leading-tight">{title}</h3>
          {description && (
            <p className="text-[12.5px] text-ink-500 mt-0.5 leading-snug">{description}</p>
          )}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Icon tiles
   ──────────────────────────────────────────────────────────────────────────── */

export type TileTone = 'brand' | 'amber' | 'indigo' | 'cyan' | 'rose' | 'violet' | 'ink';

export const TILE_TONE: Record<TileTone, string> = {
  brand: 'tile-brand',
  amber: 'tile-amber',
  indigo: 'tile-indigo',
  cyan: 'tile-cyan',
  rose: 'tile-rose',
  violet: 'tile-violet',
  ink: 'tile-ink',
};

export function Tile({
  icon: Icon,
  tone = 'brand',
  size = 'md',
  className,
}: {
  icon: LucideIcon;
  tone?: TileTone;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const box = { sm: 'size-7', md: 'size-9', lg: 'size-11', xl: 'size-14' }[size];
  const glyph = { sm: 'size-3.5', md: 'size-[18px]', lg: 'size-5', xl: 'size-7' }[size];
  return (
    <span className={cn('tile shrink-0', box, TILE_TONE[tone], className)}>
      <Icon className={glyph} strokeWidth={2.2} />
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Numbers
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * A number that counts up to its value on first paint.
 *
 * Worth the code: a dashboard that animates its figures feels like it computed
 * them, and a static one feels like it printed them. Bailing out for
 * reduced-motion and for non-finite values keeps it honest.
 */
export function CountUp({
  value,
  duration = 900,
  decimals = 0,
  suffix = '',
  prefix = '',
  className,
}: {
  value: number;
  duration?: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
}) {
  const [shown, setShown] = useState(0);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    const target = Number.isFinite(value) ? value : 0;
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // Every state update goes through requestAnimationFrame, including the instant
    // ones. Setting state synchronously in an effect body triggers a cascading
    // render — React's own lint rule flags it — and deferring by a frame costs
    // nothing perceptible while keeping all three paths on one code shape.
    if (reduce || duration <= 0) {
      frame.current = requestAnimationFrame(() => setShown(target));
    } else {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        // Same decelerating curve as the CSS easing, so motion feels unified.
        const eased = 1 - Math.pow(1 - t, 3);
        setShown(target * eased);
        if (t < 1) frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    }

    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [value, duration]);

  return (
    <span className={cn('tnum', className)}>
      {prefix}
      {shown.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}
      {suffix}
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Stat card
   ──────────────────────────────────────────────────────────────────────────── */

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'brand',
  decimals = 0,
  suffix,
  spark,
  onClick,
  className,
}: {
  label: string;
  value: number;
  hint?: React.ReactNode;
  icon: LucideIcon;
  tone?: TileTone;
  decimals?: number;
  suffix?: string;
  /** Optional trend series; drawn as a tiny area behind the bottom edge. */
  spark?: number[];
  onClick?: () => void;
  className?: string;
}) {
  return (
    <Panel
      elevation="raised"
      interactive={!!onClick}
      onClick={onClick}
      className={cn('group relative overflow-hidden p-5', className)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11.5px] font-medium uppercase tracking-wider text-ink-400">{label}</p>
          <p className="mt-2 text-[28px] font-bold leading-none text-ink-900 dark:text-white display">
            <CountUp value={value} decimals={decimals} suffix={suffix} />
          </p>
          {hint && <p className="mt-2 text-[12px] text-ink-500 leading-snug">{hint}</p>}
        </div>
        <Tile icon={icon} tone={tone} size="lg" />
      </div>

      {spark && spark.length > 1 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 opacity-70">
          <Sparkline values={spark} />
        </div>
      )}
    </Panel>
  );
}

/**
 * Minimal inline area chart. Hand-rolled rather than a Recharts instance because
 * four of these on a dashboard is four ResponsiveContainers observing resize —
 * measurable jank for what is ultimately a decorative 60×24 path.
 */
export function Sparkline({
  values,
  stroke = 'var(--brand-500)',
  className,
}: {
  values: number[];
  stroke?: string;
  className?: string;
}) {
  if (values.length < 2) return null;
  const w = 100;
  const h = 28;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 4) - 2;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const id = `spark-${values.length}-${Math.round(max)}-${Math.round(min)}`;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn('h-full w-full', className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${h} ${pts.join(' ')} ${w},${h}`} fill={`url(#${id})`} />
      <polyline
        points={pts.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Stars
   ──────────────────────────────────────────────────────────────────────────── */

export function Stars({
  rating,
  size = 14,
  className,
  showValue,
}: {
  rating: number;
  size?: number;
  className?: string;
  showValue?: boolean;
}) {
  const full = Math.floor(rating);
  const frac = rating - full;

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <span className="inline-flex items-center gap-[1px]">
        {[0, 1, 2, 3, 4].map((i) => {
          // Partial fill via a clipped overlay, so 4.3 stars actually shows 4.3.
          const fill = i < full ? 1 : i === full ? frac : 0;
          return (
            <span key={i} className="relative inline-block" style={{ width: size, height: size }}>
              <Star
                className="absolute inset-0 text-ink-200 dark:text-white/15"
                style={{ width: size, height: size }}
                fill="currentColor"
                strokeWidth={0}
              />
              {fill > 0 && (
                <span
                  className="absolute inset-0 overflow-hidden"
                  style={{ width: `${fill * 100}%` }}
                >
                  <Star
                    className="text-amber-400"
                    style={{ width: size, height: size }}
                    fill="currentColor"
                    strokeWidth={0}
                  />
                </span>
              )}
            </span>
          );
        })}
      </span>
      {showValue && (
        <span className="tnum text-[12px] font-semibold text-ink-700 dark:text-ink-200">
          {rating.toFixed(1)}
        </span>
      )}
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Pills & meters
   ──────────────────────────────────────────────────────────────────────────── */

const PILL_TONE = {
  brand: 'bg-brand-50 text-brand-700 ring-brand-600/15 dark:bg-brand-500/10 dark:text-brand-300 dark:ring-brand-400/20',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
  rose: 'bg-rose-50 text-rose-700 ring-rose-600/15 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-400/20',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-600/15 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-400/20',
  violet: 'bg-violet-50 text-violet-700 ring-violet-600/15 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/20',
  cyan: 'bg-cyan-50 text-cyan-700 ring-cyan-600/15 dark:bg-cyan-500/10 dark:text-cyan-300 dark:ring-cyan-400/20',
  neutral: 'bg-ink-100 text-ink-600 ring-ink-900/8 dark:bg-white/8 dark:text-ink-300 dark:ring-white/10',
} as const;

export type PillTone = keyof typeof PILL_TONE;

export function Pill({
  children,
  tone = 'neutral',
  icon: Icon,
  className,
}: {
  children: React.ReactNode;
  tone?: PillTone;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap',
        PILL_TONE[tone],
        className
      )}
    >
      {Icon && <Icon className="size-3" strokeWidth={2.5} />}
      {children}
    </span>
  );
}

export function Meter({
  value,
  tone = 'brand',
  className,
  height = 8,
}: {
  /** 0–100. */
  value: number;
  tone?: 'brand' | 'amber' | 'rose' | 'indigo';
  className?: string;
  height?: number;
}) {
  const fill = {
    brand: 'linear-gradient(90deg, var(--brand-400), var(--brand-600))',
    amber: 'linear-gradient(90deg, #fbbf24, #d97706)',
    rose: 'linear-gradient(90deg, #fb7185, #e11d48)',
    indigo: 'linear-gradient(90deg, #818cf8, #4f46e5)',
  }[tone];

  return (
    <div
      className={cn('w-full overflow-hidden rounded-full bg-ink-100 dark:bg-white/8', className)}
      style={{ height, boxShadow: 'inset 0 1px 2px rgba(11,18,32,.09)' }}
    >
      <div
        className="h-full rounded-full transition-[width] duration-700 ease-out"
        style={{
          width: `${Math.max(0, Math.min(100, value))}%`,
          backgroundImage: fill,
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,.35)',
        }}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Empty state
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * Empty states are the screens a merchant sees on day one — the moment they
 * decide whether this app is finished software. A bare "No data" line is where
 * most apps lose that, so this one gets real art and a real next action.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondary,
  tone = 'brand',
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  secondary?: React.ReactNode;
  tone?: TileTone;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="relative mb-5">
        {/* Halo + two ghost tiles behind the real one: depth from nothing. */}
        <div
          className="absolute inset-0 -z-10 blur-2xl opacity-50"
          style={{ background: 'radial-gradient(circle, var(--brand-300), transparent 70%)' }}
        />
        <div className="absolute left-1/2 top-1 -z-10 size-14 -translate-x-1/2 rotate-12 rounded-2xl bg-ink-100 dark:bg-white/5" />
        <div className="absolute left-1/2 top-0.5 -z-10 size-14 -translate-x-1/2 -rotate-6 rounded-2xl bg-ink-50 dark:bg-white/[0.03]" />
        <Tile icon={Icon} tone={tone} size="xl" className="animate-float" />
      </div>
      <h3 className="text-[17px] font-semibold text-ink-900 dark:text-white">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-500">{description}</p>
      )}
      {action && <div className="mt-5 flex items-center gap-2">{action}</div>}
      {secondary && <div className="mt-3 text-[12px] text-ink-400">{secondary}</div>}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Loading
   ──────────────────────────────────────────────────────────────────────────── */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('shimmer rounded-lg', className)} />;
}

export function StatSkeletonRow({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <Panel key={i} className="p-5">
          <div className="flex items-start justify-between">
            <div className="w-full space-y-3">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-2.5 w-24" />
            </div>
            <Skeleton className="size-11 rounded-xl" />
          </div>
        </Panel>
      ))}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Buttons
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The primary call to action. Separate from the shadcn Button because it carries
 * the brand gradient, the tinted glow and the bevel — the three things that make
 * a button look pressable rather than painted.
 */
export function ActionButton({
  children,
  icon: Icon,
  trailingIcon,
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: React.ComponentProps<'button'> & {
  icon?: LucideIcon;
  trailingIcon?: LucideIcon;
  variant?: 'primary' | 'dark' | 'soft' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizes = {
    sm: 'h-8 px-3 text-[12.5px] gap-1.5 rounded-lg',
    md: 'h-9.5 px-4 text-[13.5px] gap-2 rounded-xl',
    lg: 'h-11 px-5 text-[14.5px] gap-2 rounded-xl',
  }[size];

  const variants = {
    primary: 'brand-fill',
    dark: 'ink-fill hover:brightness-110',
    soft: 'bg-brand-50 text-brand-700 hover:bg-brand-100 dark:bg-brand-500/12 dark:text-brand-300 dark:hover:bg-brand-500/20',
    outline:
      'surface text-ink-700 dark:text-ink-200 hover:border-ink-300 hover:bg-ink-50 dark:hover:bg-white/5',
    ghost: 'text-ink-600 dark:text-ink-300 hover:bg-ink-100 dark:hover:bg-white/8',
  }[variant];

  const glyph = size === 'sm' ? 'size-3.5' : 'size-4';

  return (
    <button
      className={cn(
        'ring-focus inline-flex shrink-0 items-center justify-center font-semibold transition-all',
        'disabled:pointer-events-none disabled:opacity-50',
        sizes,
        variants,
        className
      )}
      {...props}
    >
      {Icon && <Icon className={glyph} strokeWidth={2.4} />}
      {children}
      {trailingIcon &&
        React.createElement(trailingIcon, { className: glyph, strokeWidth: 2.4 })}
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Section heading (inside a page, above a group of panels)
   ──────────────────────────────────────────────────────────────────────────── */

export function SectionTitle({
  children,
  hint,
  action,
  className,
}: {
  children: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-end justify-between gap-4 mb-3', className)}>
      <div>
        <h2 className="text-[13px] font-bold uppercase tracking-[0.08em] text-ink-400">
          {children}
        </h2>
        {hint && <p className="mt-1 text-[12.5px] text-ink-500">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * A quiet inline link that still looks deliberate. Used for "learn more" and
 * cross-page jumps where a full button would shout.
 */
export function QuietLink({
  children,
  className,
  ...props
}: React.ComponentProps<'button'>) {
  return (
    <button
      className={cn(
        'ring-focus group inline-flex items-center gap-1 rounded text-[12.5px] font-semibold text-brand-700 transition-colors hover:text-brand-800 dark:text-brand-400 dark:hover:text-brand-300',
        className
      )}
      {...props}
    >
      {children}
      <ArrowUpRight className="size-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </button>
  );
}
