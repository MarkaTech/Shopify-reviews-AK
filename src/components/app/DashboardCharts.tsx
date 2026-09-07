'use client';

/**
 * The dashboard's two recharts figures, split out so recharts is not in the first paint.
 *
 * Why this file exists
 * -------------------
 * The dashboard is the app's entry route — `application_url` is the site root, so it is the
 * first thing a merchant and an App Store reviewer see. It imported recharts statically,
 * which put a ~478 KB chunk (the single largest in the bundle) on the critical path before
 * anything could render, for two figures that sit below the stat tiles and are not what
 * anyone opens the app to do.
 *
 * Every other screen was already behind `next/dynamic` for exactly this reason; the
 * dashboard's own charts were the remaining static import. Loading them separately means the
 * tiles, the recent-reviews list and the setup guide paint on a much smaller bundle, and the
 * charts fill in a moment later — which is the right trade for content that is below the
 * fold and decorative-leaning.
 *
 * The placeholder keeps the same height as the rendered chart, so nothing on the page moves
 * when the chunk arrives.
 */

import React from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';

const TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 12,
  border: '1px solid var(--border)',
  boxShadow: 'var(--elev-2)',
  background: 'var(--card)',
} as const;

export function ReviewsOverTimeChart({ data }: { data: Array<{ date: string; count: number }> }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 12, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="dashArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand-500)" stopOpacity={0.32} />
            <stop offset="100%" stopColor="var(--brand-500)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="4 4" stroke="var(--ink-200)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: 'var(--ink-400)' }}
          tickFormatter={(v: string) => v.slice(5)}
          axisLine={false}
          tickLine={false}
          minTickGap={24}
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'var(--ink-400)' }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={34}
        />
        <Tooltip
          cursor={{ stroke: 'var(--ink-300)', strokeDasharray: '4 4' }}
          contentStyle={TOOLTIP_STYLE}
        />
        <Area
          type="monotone"
          dataKey="count"
          name="Reviews"
          stroke="var(--brand-500)"
          strokeWidth={2.5}
          fill="url(#dashArea)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function SentimentChart({
  data,
}: {
  data: Array<{ name: string; value: number; color: string }>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={52}
          outerRadius={72}
          dataKey="value"
          paddingAngle={3}
          stroke="var(--card)"
          strokeWidth={3}
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} />
      </PieChart>
    </ResponsiveContainer>
  );
}
