'use client';

import React, { useState, useEffect } from 'react';
import {
  Settings, Bell, Shield, Palette, Globe, Mail, ToggleLeft,
  CheckCircle, CreditCard, Crown, Zap, Lock, Info
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

const plans = [
  {
    id: 'free', name: 'Free', price: 0, interval: 'month',
    features: ['50 reviews', '1 widget type', 'Basic filters', 'Email support', 'Review display'],
    current: false, color: 'border-gray-200'
  },
  {
    id: 'pro', name: 'Pro', price: 29, interval: 'month',
    features: ['Unlimited reviews', 'All widget types', 'Advanced filters', 'All import sources', 'Bulk CSV upload', 'Photo reviews', 'Custom CSS', 'Priority support', 'Analytics dashboard'],
    current: true, color: 'border-emerald-500 ring-2 ring-emerald-200', popular: true
  },
  {
    id: 'enterprise', name: 'Enterprise', price: 99, interval: 'month',
    features: ['Everything in Pro', 'Custom branding', 'API access', 'Webhook support', 'Dedicated support', 'White-label option', 'Multi-language', 'Advanced analytics', 'Bulk operations', 'SLA guarantee'],
    current: false, color: 'border-gray-200'
  },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/settings').then(r => r.json()).then(d => {
      setSettings(d.settings || {});
      setLoading(false);
    });
  }, []);

  const updateSetting = (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const saveSettings = async () => {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings }),
    });
    toast.success('Settings saved successfully!');
  };

  const getBool = (key: string) => settings[key] === 'true';
  const getStr = (key: string) => settings[key] || '';

  if (loading) {
    return <div className="space-y-4 animate-pulse"><div className="h-96 bg-gray-100 rounded-xl" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold">Settings</h2>
        <p className="text-xs text-muted-foreground">Configure your review app preferences</p>
      </div>

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList className="bg-gray-100 p-0.5 h-9">
          <TabsTrigger value="general" className="text-xs h-8 gap-1.5"><Settings className="w-3.5 h-3.5" />General</TabsTrigger>
          <TabsTrigger value="display" className="text-xs h-8 gap-1.5"><Palette className="w-3.5 h-3.5" />Display</TabsTrigger>
          <TabsTrigger value="notifications" className="text-xs h-8 gap-1.5"><Bell className="w-3.5 h-3.5" />Notifications</TabsTrigger>
          <TabsTrigger value="subscription" className="text-xs h-8 gap-1.5"><CreditCard className="w-3.5 h-3.5" />Plan</TabsTrigger>
        </TabsList>

        {/* General Settings */}
        <TabsContent value="general">
          <div className="space-y-4">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Review Settings</CardTitle>
                <CardDescription className="text-xs">Configure how reviews are submitted and displayed</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium">Auto-publish reviews</p>
                    <p className="text-[11px] text-muted-foreground">New reviews are published immediately without approval</p>
                  </div>
                  <Switch checked={getBool('auto_publish')} onCheckedChange={v => updateSetting('auto_publish', String(v))} />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium">Require approval</p>
                    <p className="text-[11px] text-muted-foreground">All reviews must be approved before publishing</p>
                  </div>
                  <Switch checked={getBool('require_approval')} onCheckedChange={v => updateSetting('require_approval', String(v))} />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium">Allow anonymous reviews</p>
                    <p className="text-[11px] text-muted-foreground">Let customers submit reviews without a name</p>
                  </div>
                  <Switch checked={getBool('allow_anonymous')} onCheckedChange={v => updateSetting('allow_anonymous', String(v))} />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium">Enable photo reviews</p>
                    <p className="text-[11px] text-muted-foreground">Allow customers to upload photos with reviews</p>
                  </div>
                  <Switch checked={getBool('enable_photo_reviews')} onCheckedChange={v => updateSetting('enable_photo_reviews', String(v))} />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium">Enable video reviews</p>
                    <p className="text-[11px] text-muted-foreground">Allow customers to submit video reviews</p>
                  </div>
                  <Switch checked={getBool('enable_video_reviews')} onCheckedChange={v => updateSetting('enable_video_reviews', String(v))} />
                </div>
                <Separator />
                <div>
                  <p className="text-xs font-medium">Minimum review length</p>
                  <p className="text-[11px] text-muted-foreground mb-1.5">Minimum characters required for a review body</p>
                  <Input type="number" className="h-8 text-xs max-w-[120px]" value={getStr('min_review_length')} onChange={e => updateSetting('min_review_length', e.target.value)} />
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Review Form</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs">Form Position</Label>
                  <Select value={getStr('review_form_position')} onValueChange={v => updateSetting('review_form_position', v)}>
                    <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="above_reviews">Above Reviews</SelectItem>
                      <SelectItem value="below_reviews">Below Reviews</SelectItem>
                      <SelectItem value="separate_tab">Separate Tab</SelectItem>
                      <SelectItem value="floating_button">Floating Button</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Button onClick={saveSettings} className="bg-emerald-600 hover:bg-emerald-700 text-xs gap-1.5">
              <CheckCircle className="w-3.5 h-3.5" /> Save Settings
            </Button>
          </div>
        </TabsContent>

        {/* Display Settings */}
        <TabsContent value="display">
          <div className="space-y-4">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Colors & Appearance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Primary Color</Label>
                    <div className="flex gap-2 mt-1.5">
                      <input type="color" value={getStr('primary_color')} onChange={e => updateSetting('primary_color', e.target.value)} className="w-9 h-9 rounded-lg border cursor-pointer" />
                      <Input className="h-9 text-xs flex-1" value={getStr('primary_color')} onChange={e => updateSetting('primary_color', e.target.value)} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Star Color</Label>
                    <div className="flex gap-2 mt-1.5">
                      <input type="color" value={getStr('star_color')} onChange={e => updateSetting('star_color', e.target.value)} className="w-9 h-9 rounded-lg border cursor-pointer" />
                      <Input className="h-9 text-xs flex-1" value={getStr('star_color')} onChange={e => updateSetting('star_color', e.target.value)} />
                    </div>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">Widget Theme</Label>
                  <Select value={getStr('widget_theme')} onValueChange={v => updateSetting('widget_theme', v)}>
                    <SelectTrigger className="h-8 text-xs mt-1.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="modern">Modern</SelectItem>
                      <SelectItem value="classic">Classic</SelectItem>
                      <SelectItem value="minimal">Minimal</SelectItem>
                      <SelectItem value="bold">Bold</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Badges</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium">Show Verified Purchase Badge</p>
                    <p className="text-[11px] text-muted-foreground">Display badge for verified buyers</p>
                  </div>
                  <Switch checked={getBool('show_verified_badge')} onCheckedChange={v => updateSetting('show_verified_badge', String(v))} />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium">Show Source Badge</p>
                    <p className="text-[11px] text-muted-foreground">Show where the review was imported from</p>
                  </div>
                  <Switch checked={getBool('show_source_badge')} onCheckedChange={v => updateSetting('show_source_badge', String(v))} />
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium">Show Ratings Summary</p>
                    <p className="text-[11px] text-muted-foreground">Display average rating breakdown</p>
                  </div>
                  <Switch checked={getBool('show_ratings_summary')} onCheckedChange={v => updateSetting('show_ratings_summary', String(v))} />
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Custom CSS</CardTitle>
                <CardDescription className="text-xs">Add custom CSS to override default styles</CardDescription>
              </CardHeader>
              <CardContent>
                <textarea
                  className="w-full h-32 p-3 border rounded-lg text-xs font-mono bg-gray-50 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  placeholder=".review-card { border-radius: 10px; }"
                  value={getStr('custom_css')}
                  onChange={e => updateSetting('custom_css', e.target.value)}
                />
              </CardContent>
            </Card>

            <Button onClick={saveSettings} className="bg-emerald-600 hover:bg-emerald-700 text-xs gap-1.5">
              <CheckCircle className="w-3.5 h-3.5" /> Save Display Settings
            </Button>
          </div>
        </TabsContent>

        {/* Notification Settings */}
        <TabsContent value="notifications">
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Notification Preferences</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">Email Notifications</p>
                  <p className="text-[11px] text-muted-foreground">Get notified when a new review is submitted</p>
                </div>
                <Switch checked={getBool('email_notifications')} onCheckedChange={v => updateSetting('email_notifications', String(v))} />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">Negative Review Alerts</p>
                  <p className="text-[11px] text-muted-foreground">Immediate alert for 1-2 star reviews</p>
                </div>
                <Switch defaultChecked />
              </div>
              <Separator />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">Weekly Summary</p>
                  <p className="text-[11px] text-muted-foreground">Get a weekly email with review statistics</p>
                </div>
                <Switch defaultChecked />
              </div>
            </CardContent>
          </Card>
          <Button onClick={saveSettings} className="bg-emerald-600 hover:bg-emerald-700 text-xs gap-1.5 mt-4">
            <CheckCircle className="w-3.5 h-3.5" /> Save Notifications
          </Button>
        </TabsContent>

        {/* Subscription Plans */}
        <TabsContent value="subscription">
          <div className="space-y-4">
            <Card className="border-0 shadow-sm bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-100">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center text-white">
                  <Crown className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold">Current Plan: Pro</p>
                  <p className="text-xs text-emerald-600">$29/month • Renews on August 1, 2026</p>
                </div>
                <Button variant="outline" size="sm" className="text-xs">Manage Billing</Button>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {plans.map(plan => (
                <Card key={plan.id} className={`border-2 ${plan.color} relative ${plan.current ? '' : 'border-0 shadow-sm'}`}>
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
                          <CheckCircle className={`w-3 h-3 flex-shrink-0 ${plan.current ? 'text-emerald-500' : 'text-gray-400'}`} />
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <Button
                      className={`w-full mt-4 text-xs ${plan.current ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-gray-100 hover:bg-gray-200 text-gray-800'}`}
                      disabled={plan.current}
                    >
                      {plan.current ? 'Current Plan' : 'Upgrade'}
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
