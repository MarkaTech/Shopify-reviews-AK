'use client';

import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard, Star, Upload, FileSpreadsheet,
  Settings, ShoppingBag, Palette, BarChart3, MessageSquare,
  ChevronDown, ChevronRight, LogOut, Bell, Search, User,
  HelpCircle, ExternalLink, Gift
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';

export type PageId =
  | 'dashboard'
  | 'reviews'
  | 'bulk-upload'
  | 'questions'
  | 'widgets'
  | 'settings'
  | 'products'
  | 'incentives';

interface SidebarProps {
  currentPage: PageId;
  onPageChange: (page: PageId) => void;
  /** Real store details. The footer previously hardcoded a fictional store on a Pro
   *  plan, which contradicted the header and told Free-plan merchants they were paying. */
  storeName?: string;
  storeDomain?: string;
  plan?: string;
}

const PLAN_META: Record<string, { label: string; short: string; price: string }> = {
  free: { label: 'Free Plan', short: 'FREE', price: '$0/mo' },
  starter: { label: 'Starter Plan', short: 'START', price: '$9.99/mo' },
  pro: { label: 'Pro Plan', short: 'PRO', price: '$29.99/mo' },
  growth: { label: 'Growth Plan', short: 'GRW', price: '$19.99/mo' },
};

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'ST';
  return (parts[0][0] + (parts[1]?.[0] ?? parts[0][1] ?? '')).toUpperCase();
}

const mainNav = [
  { id: 'dashboard' as PageId, label: 'Dashboard', icon: LayoutDashboard },
  { id: 'reviews' as PageId, label: 'Reviews', icon: Star, badge: null },
];

// The marketplace URL importer was removed. It could not work — Amazon and Alibaba block
// automated fetches and publish no per-review structured data — and republishing another
// seller's reviews as your own breaks the FTC Rule on Consumer Reviews and the EU Omnibus
// Directive regardless. Legitimate review sources are a CSV of reviews the merchant owns,
// and first-party requests sent after a real order. Both live under Import Reviews.
const reviewSubNav = [
  { id: 'reviews' as PageId, label: 'All Reviews', icon: MessageSquare },
  { id: 'bulk-upload' as PageId, label: 'Import Reviews', icon: FileSpreadsheet },
  { id: 'questions' as PageId, label: 'Questions', icon: HelpCircle },
];

const settingsNav = [
  { id: 'products' as PageId, label: 'Products', icon: ShoppingBag },
  { id: 'widgets' as PageId, label: 'Widgets', icon: Palette },
  { id: 'incentives' as PageId, label: 'Incentives', icon: Gift },
  { id: 'settings' as PageId, label: 'Settings', icon: Settings },
];

export default function Sidebar({ currentPage, onPageChange, storeName, storeDomain, plan }: SidebarProps) {
  const planKey = plan && plan in PLAN_META ? plan : 'free';
  const planMeta = PLAN_META[planKey];
  const reviewsOpen = ['reviews', 'bulk-upload', 'questions'].includes(currentPage);
  const settingsOpen = ['products', 'widgets', 'incentives', 'settings'].includes(currentPage);

  return (
    <div className="w-[260px] h-screen bg-white border-r border-gray-200 flex flex-col fixed left-0 top-0 z-40">
      {/* Header */}
      <div className="p-4 flex items-center gap-3">
        <div className="w-9 h-9 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center">
          <Star className="w-5 h-5 text-white fill-white" />
        </div>
        <div>
          <h1 className="font-bold text-sm leading-tight">ReviewMaster</h1>
          <p className="text-xs text-muted-foreground">by Shopify Apps</p>
        </div>
      </div>
      <Separator />

      {/* Search */}
      <div className="px-3 pt-3 pb-1">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input placeholder="Search..." className="pl-8 h-8 text-xs" />
        </div>
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 px-2 py-2">
        <div className="space-y-1">
          {mainNav.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              className={cn(
                'w-full justify-start gap-2.5 h-8 px-3 text-sm font-normal',
                currentPage === item.id && 'bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
              )}
              onClick={() => onPageChange(item.id)}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Button>
          ))}

          {/* Reviews Section */}
          <div>
            <Button
              variant="ghost"
              className="w-full justify-between gap-2.5 h-8 px-3 text-sm font-normal hover:bg-gray-50"
              onClick={() => onPageChange('reviews')}
            >
              <div className="flex items-center gap-2.5">
                <BarChart3 className="w-4 h-4" />
                <span>Review Management</span>
              </div>
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", reviewsOpen && "rotate-180")} />
            </Button>
            {reviewsOpen && (
              <div className="ml-4 pl-3 border-l border-gray-200 space-y-0.5 mt-0.5">
                {reviewSubNav.map((item) => (
                  <Button
                    key={item.id}
                    variant="ghost"
                    className={cn(
                      'w-full justify-start gap-2.5 h-7 px-2 text-xs font-normal',
                      currentPage === item.id && 'bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                    )}
                    onClick={() => onPageChange(item.id)}
                  >
                    <item.icon className="w-3.5 h-3.5" />
                    {item.label}
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* Settings Section */}
          <div>
            <Button
              variant="ghost"
              className="w-full justify-between gap-2.5 h-8 px-3 text-sm font-normal hover:bg-gray-50"
              onClick={() => onPageChange('products')}
            >
              <div className="flex items-center gap-2.5">
                <Settings className="w-4 h-4" />
                <span>Configuration</span>
              </div>
              <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", settingsOpen && "rotate-180")} />
            </Button>
            {settingsOpen && (
              <div className="ml-4 pl-3 border-l border-gray-200 space-y-0.5 mt-0.5">
                {settingsNav.map((item) => (
                  <Button
                    key={item.id}
                    variant="ghost"
                    className={cn(
                      'w-full justify-start gap-2.5 h-7 px-2 text-xs font-normal',
                      currentPage === item.id && 'bg-emerald-50 text-emerald-700 hover:bg-emerald-50'
                    )}
                    onClick={() => onPageChange(item.id)}
                  >
                    <item.icon className="w-3.5 h-3.5" />
                    {item.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-3 border-t border-gray-200">
        <div className="flex items-center gap-2 px-2 mb-2">
          <Avatar className="w-7 h-7">
            <AvatarFallback className="text-xs bg-emerald-100 text-emerald-700">{initialsOf(storeName || '')}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{storeName || 'Your store'}</p>
            <p className="text-[10px] text-muted-foreground truncate">{storeDomain || '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="flex-1 h-7 text-xs gap-1.5">
                <span className="bg-emerald-100 text-emerald-700 rounded px-1.5 py-0.5 text-[10px] font-medium">{planMeta.short}</span>
                {planMeta.label}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>Current Plan</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {(['free', 'starter', 'growth', 'pro'] as const).map((p) => (
                <DropdownMenuItem
                  key={p}
                  className={p === planKey ? 'bg-emerald-50 text-emerald-700' : ''}
                >
                  {PLAN_META[p].label.replace(' Plan', '')} — {PLAN_META[p].price}
                  {p === planKey ? ' ✓' : ''}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <ExternalLink className="w-3.5 h-3.5 mr-2" />
                Manage Subscription
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <HelpCircle className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7">
            <Bell className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
