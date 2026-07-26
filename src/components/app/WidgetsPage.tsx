'use client';

import React, { useState, useEffect } from 'react';
import {
  Palette, Star, Grid, Layers, LayoutList, Columns, MessageSquare,
  Eye, Code, Copy, Settings2, Plus, Trash2, Sparkles, Monitor, Smartphone
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { apiFetch, ApiError, errorMessage } from '@/lib/api-client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

const widgetTypes = [
  { id: 'carousel', name: 'Carousel', icon: Layers, desc: 'Sliding review cards with navigation', preview: 'carousel' },
  { id: 'grid', name: 'Grid', icon: Grid, desc: 'Grid layout with multiple columns', preview: 'grid' },
  { id: 'list', name: 'List', icon: LayoutList, desc: 'Stacked list of reviews', preview: 'list' },
  { id: 'masonry', name: 'Masonry', icon: Columns, desc: 'Pinterest-style masonry layout', preview: 'masonry' },
  { id: 'badge', name: 'Star Badge', icon: Star, desc: 'Show rating badge on product', preview: 'badge' },
  { id: 'floating', name: 'Floating Widget', icon: Sparkles, desc: 'Floating review button', preview: 'floating' },
  { id: 'popup', name: 'Popup Modal', icon: MessageSquare, desc: 'Show review popup after delay', preview: 'popup' },
  { id: 'sidebar', name: 'Sidebar', icon: Eye, desc: 'Side panel with reviews', preview: 'sidebar' },
  { id: 'testimonial', name: 'Testimonials', icon: Star, desc: 'Featured testimonials section', preview: 'testimonial' },
];

const placements = [
  { value: 'product_page', label: 'Product Page' },
  { value: 'collection_page', label: 'Collection Page' },
  { value: 'home_page', label: 'Home Page' },
  { value: 'all_pages', label: 'All Pages' },
  { value: 'custom', label: 'Custom Position' },
];

interface Widget {
  id: string;
  name: string;
  widgetType: string;
  placement: string | null;
  isActive: boolean;
  config: string;
  createdAt: string;
}

const SAMPLE_REVIEWS = [
  { name: 'Sarah M.', rating: 5, title: 'Absolutely love this!', body: 'This product exceeded all my expectations. The quality is outstanding and it looks even better in person.', verified: true, date: '2 days ago' },
  { name: 'James K.', rating: 4, title: 'Great value', body: 'Good quality for the price point. Works as described and shipping was fast.', verified: true, date: '5 days ago' },
  { name: 'Emily R.', rating: 5, title: 'Perfect purchase', body: 'Exactly what I was looking for! The fit is perfect and the material feels premium.', verified: false, date: '1 week ago' },
  { name: 'Michael T.', rating: 5, title: 'Highly recommend', body: 'Best purchase this year. Already recommended to all my friends. Will buy again for sure.', verified: true, date: '2 weeks ago' },
  { name: 'Jessica L.', rating: 4, title: 'Very happy', body: 'Really impressed with the quality. Packaging was great and product arrived quickly.', verified: true, date: '3 weeks ago' },
];

function StarRating({ rating, size = 'sm' }: { rating: number; size?: 'sm' | 'md' }) {
  const sizeClass = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(s => (
        <Star key={s} className={`${sizeClass} ${s <= rating ? 'text-amber-400 fill-amber-400' : 'text-gray-300'}`} />
      ))}
    </div>
  );
}

function WidgetPreview({ type }: { type: string }) {
  switch (type) {
    case 'carousel':
      return (
        <div className="space-y-3">
          <div className="flex gap-3 overflow-x-auto pb-2">
            {SAMPLE_REVIEWS.slice(0, 3).map((r, i) => (
              <div key={i} className="min-w-[250px] max-w-[250px] p-4 border rounded-xl bg-white shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white text-[10px] font-bold">{r.name.charAt(0)}</div>
                  <div>
                    <p className="text-[11px] font-semibold">{r.name}</p>
                    <p className="text-[9px] text-gray-400">{r.date}</p>
                  </div>
                  {r.verified && <Badge className="text-[8px] h-3.5 px-1 bg-emerald-100 text-emerald-700">Verified</Badge>}
                </div>
                <StarRating rating={r.rating} />
                <p className="text-[11px] font-medium mt-1">{r.title}</p>
                <p className="text-[10px] text-gray-500 mt-1 line-clamp-2">{r.body}</p>
              </div>
            ))}
          </div>
          <div className="flex justify-center gap-1">
            {[0, 1, 2].map(i => (
              <div key={i} className={`w-1.5 h-1.5 rounded-full ${i === 0 ? 'bg-emerald-500' : 'bg-gray-300'}`} />
            ))}
          </div>
        </div>
      );

    case 'grid':
      return (
        <div className="grid grid-cols-2 gap-3">
          {SAMPLE_REVIEWS.slice(0, 4).map((r, i) => (
            <div key={i} className="p-3 border rounded-lg bg-white">
              <StarRating rating={r.rating} />
              <p className="text-[10px] font-medium mt-1 line-clamp-1">{r.title}</p>
              <p className="text-[9px] text-gray-500 mt-0.5 line-clamp-2">{r.body}</p>
              <p className="text-[9px] text-gray-400 mt-1.5">{r.name}</p>
            </div>
          ))}
        </div>
      );

    case 'list':
      return (
        <div className="space-y-2">
          {SAMPLE_REVIEWS.slice(0, 3).map((r, i) => (
            <div key={i} className="flex gap-3 p-3 border rounded-lg bg-white">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">{r.name.charAt(0)}</div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold">{r.name}</span>
                  <StarRating rating={r.rating} />
                </div>
                <p className="text-[10px] text-gray-600 mt-0.5">{r.body}</p>
              </div>
            </div>
          ))}
        </div>
      );

    case 'badge':
      return (
        <div className="flex items-center gap-4 p-4 bg-white rounded-xl border">
          <div className="text-center">
            <p className="text-3xl font-bold text-emerald-600">4.8</p>
            <StarRating rating={5} size="md" />
            <p className="text-[10px] text-gray-500 mt-1">Based on 156 reviews</p>
          </div>
          <Separator orientation="vertical" className="h-16" />
          <div className="flex-1 space-y-1.5">
            {[5, 4, 3, 2, 1].map(s => {
              const pct = s === 5 ? 65 : s === 4 ? 22 : s === 3 ? 8 : s === 2 ? 3 : 2;
              return (
                <div key={s} className="flex items-center gap-2">
                  <span className="text-[10px] w-3">{s}</span>
                  <Star className="w-2.5 h-2.5 text-amber-400 fill-amber-400" />
                  <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[9px] text-gray-400 w-6 text-right">{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      );

    case 'testimonial':
      return (
        <div className="p-5 bg-gradient-to-br from-emerald-50 to-teal-50 rounded-xl border border-emerald-100">
          <div className="text-center mb-3">
            <StarRating rating={5} size="md" />
          </div>
          <blockquote className="text-sm text-center italic text-gray-700">&ldquo;{SAMPLE_REVIEWS[0].body}&rdquo;</blockquote>
          <div className="flex items-center justify-center gap-2 mt-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500 flex items-center justify-center text-white text-xs font-bold">{SAMPLE_REVIEWS[0].name.charAt(0)}</div>
            <div>
              <p className="text-xs font-semibold">{SAMPLE_REVIEWS[0].name}</p>
              <p className="text-[10px] text-gray-500">Verified Buyer</p>
            </div>
          </div>
        </div>
      );

    default:
      return (
        <div className="p-8 text-center text-muted-foreground">
          <Star className="w-8 h-8 mx-auto mb-2" />
          <p className="text-xs">Preview for {type} widget</p>
        </div>
      );
  }
}

export default function WidgetsPage() {
  const [widgets, setWidgets] = useState<Widget[]>([]);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [widgetName, setWidgetName] = useState('');
  const [widgetPlacement, setWidgetPlacement] = useState('product_page');
  const [showCode, setShowCode] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');

  // Widget config
  const [config, setConfig] = useState({
    maxReviews: '10',
    showPhotos: true,
    showVerified: true,
    showSource: false,
    autoPlay: true,
    columns: '3',
    starColor: '#FBBF24',
    backgroundColor: '#FFFFFF',
    textColor: '#1F2937',
    borderRadius: '12',
    animation: 'fade',
    showReply: true,
    showHelpful: true,
    minRating: '1',
    showEmpty: false,
    sortBy: 'newest',
  });

  useEffect(() => {
    fetch('/api/widgets').then(r => r.json()).then(d => setWidgets(d.widgets || []));
  }, []);

  const [showCode, setShowCode] = useState(false);

  const handleCreateWidget = async () => {
    if (!selectedType || !widgetName) {
      toast.error('Please select a widget type and enter a name');
      return;
    }
    try {
      const data = await apiFetch<Widget>('/api/widgets', {
        method: 'POST',
        body: JSON.stringify({ name: widgetName, widgetType: selectedType, placement: widgetPlacement, config }),
      });
      toast.success('Widget created');
      setWidgets([...widgets, data]);
      setSelectedType(null);
      setWidgetName('');
    } catch (err) {
      // Free plans allow one widget of a single type. Without this check the old code
      // announced "Widget created!" and pushed the error payload into the list.
      if (err instanceof ApiError && err.isPlanLimit) {
        toast.error(err.userMessage, { description: 'Open Settings to change your plan.', duration: 8000 });
      } else {
        toast.error(errorMessage(err, 'Could not create the widget'));
      }
    }
  };

  const handleDeleteWidget = async (id: string) => {
    try {
      await apiFetch('/api/widgets', { method: 'DELETE', body: JSON.stringify({ id }) });
      toast.success('Widget deleted');
      setWidgets(widgets.filter(w => w.id !== id));
    } catch (err) {
      toast.error(errorMessage(err, 'Could not delete the widget'));
    }
  };

  const codeSnippet = `<!-- ReviewMaster Widget -->
<div id="reviewmaster-widget"
  data-widget-id="your-widget-id"
  data-type="${selectedType || 'carousel'}"
  data-placement="${widgetPlacement}"
  data-max-reviews="${config.maxReviews}"
  data-show-photos="${config.showPhotos}"
  data-show-verified="${config.showVerified}">
</div>
<script src="https://cdn.reviewmaster.app/widget.js"></script>`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold">Widget Builder</h2>
          <p className="text-xs text-muted-foreground">Design how reviews appear on your storefront</p>
        </div>
        <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => setShowCode(true)}>
          <Code className="w-3.5 h-3.5" /> View Theme Code
        </Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Left: Widget Type & Config */}
        <div className="space-y-4">
          {/* Widget Type Selection */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Widget Type</CardTitle>
              <CardDescription className="text-xs">Choose how reviews are displayed</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2">
                {widgetTypes.map(wt => (
                  <button
                    key={wt.id}
                    className={`p-3 rounded-xl border-2 text-left transition-all ${selectedType === wt.id ? 'border-emerald-500 bg-emerald-50 shadow-sm' : 'border-gray-200 hover:border-gray-300'}`}
                    onClick={() => { setSelectedType(wt.id); setWidgetName(wt.name + ' Widget'); }}
                  >
                    <wt.icon className={`w-5 h-5 ${selectedType === wt.id ? 'text-emerald-600' : 'text-gray-400'}`} />
                    <p className="text-[11px] font-semibold mt-1.5">{wt.name}</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Widget Settings */}
          {selectedType && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Widget Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs">Widget Name</Label>
                  <Input className="h-8 text-xs mt-1" value={widgetName} onChange={e => setWidgetName(e.target.value)} />
                </div>

                <div>
                  <Label className="text-xs">Placement</Label>
                  <Select value={widgetPlacement} onValueChange={setWidgetPlacement}>
                    <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {placements.map(p => (
                        <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                <div className="space-y-3">
                  <Label className="text-xs font-medium">Display Options</Label>

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Show Photos</span>
                    <Switch checked={config.showPhotos} onCheckedChange={v => setConfig({ ...config, showPhotos: v })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Show Verified Badge</span>
                    <Switch checked={config.showVerified} onCheckedChange={v => setConfig({ ...config, showVerified: v })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Show Source Badge</span>
                    <Switch checked={config.showSource} onCheckedChange={v => setConfig({ ...config, showSource: v })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Show Store Replies</span>
                    <Switch checked={config.showReply} onCheckedChange={v => setConfig({ ...config, showReply: v })} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Show Helpful Button</span>
                    <Switch checked={config.showHelpful} onCheckedChange={v => setConfig({ ...config, showHelpful: v })} />
                  </div>
                  {selectedType === 'carousel' && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Auto-Play</span>
                      <Switch checked={config.autoPlay} onCheckedChange={v => setConfig({ ...config, autoPlay: v })} />
                    </div>
                  )}
                </div>

                <Separator />

                <div className="space-y-3">
                  <Label className="text-xs font-medium">Appearance</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Max Reviews</Label>
                      <Input type="number" className="h-8 text-xs mt-1" value={config.maxReviews} onChange={e => setConfig({ ...config, maxReviews: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Columns</Label>
                      <Select value={config.columns} onValueChange={v => setConfig({ ...config, columns: v })}>
                        <SelectTrigger className="h-8 text-xs mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="2">2 Columns</SelectItem>
                          <SelectItem value="3">3 Columns</SelectItem>
                          <SelectItem value="4">4 Columns</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Star Color</Label>
                      <div className="flex gap-2 mt-1">
                        <input type="color" value={config.starColor} onChange={e => setConfig({ ...config, starColor: e.target.value })} className="w-8 h-8 rounded border cursor-pointer" />
                        <Input className="h-8 text-xs flex-1" value={config.starColor} onChange={e => setConfig({ ...config, starColor: e.target.value })} />
                      </div>
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground">Border Radius</Label>
                      <Input type="number" className="h-8 text-xs mt-1" value={config.borderRadius} onChange={e => setConfig({ ...config, borderRadius: e.target.value })} />
                    </div>
                  </div>
                </div>

                <Button onClick={handleCreateWidget} className="w-full bg-emerald-600 hover:bg-emerald-700 text-xs gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> Save Widget
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Existing Widgets */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Active Widgets ({widgets.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {widgets.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-4">No widgets created yet</p>
              ) : (
                <div className="space-y-2">
                  {widgets.map(w => (
                    <div key={w.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${w.isActive ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-200 text-gray-400'}`}>
                        {widgetTypes.find(t => t.id === w.widgetType)?.icon ? React.createElement(widgetTypes.find(t => t.id === w.widgetType)!.icon, { className: 'w-4 h-4' }) : <Star className="w-4 h-4" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold">{w.name}</p>
                        <p className="text-[10px] text-muted-foreground capitalize">{w.widgetType} • {w.placement?.replace('_', ' ')}</p>
                      </div>
                      <Badge className={`text-[10px] h-5 px-1.5 ${w.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
                        {w.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDeleteWidget(w.id)}>
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Preview */}
        <div className="space-y-4">
          <Card className="border-0 shadow-sm sticky top-4">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm">Live Preview</CardTitle>
                  <CardDescription className="text-xs">See how your widget looks</CardDescription>
                </div>
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                  <Button variant={previewDevice === 'desktop' ? 'secondary' : 'ghost'} size="sm" className="h-6 text-[10px] gap-1" onClick={() => setPreviewDevice('desktop')}>
                    <Monitor className="w-3 h-3" /> Desktop
                  </Button>
                  <Button variant={previewDevice === 'mobile' ? 'secondary' : 'ghost'} size="sm" className="h-6 text-[10px] gap-1" onClick={() => setPreviewDevice('mobile')}>
                    <Smartphone className="w-3 h-3" /> Mobile
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className={`bg-gray-50 rounded-xl p-4 border ${previewDevice === 'mobile' ? 'max-w-[375px] mx-auto' : ''}`}>
                <div className="bg-white rounded-lg p-4 shadow-sm" style={{ borderRadius: `${config.borderRadius}px` }}>
                  {selectedType ? (
                    <WidgetPreview type={selectedType} />
                  ) : (
                    <div className="text-center py-12">
                      <Palette className="w-12 h-12 mx-auto text-gray-200" />
                      <p className="text-sm text-muted-foreground mt-3">Select a widget type to preview</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">Choose from 9 different display styles</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Embed Code */}
              {selectedType && (
                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <Label className="text-xs font-medium">Embed Code</Label>
                    <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1" onClick={() => { setShowCode(!showCode); }}>
                      <Code className="w-3 h-3" /> {showCode ? 'Hide' : 'Show'}
                    </Button>
                  </div>
                  {showCode && (
                    <div className="relative">
                      <pre className="bg-gray-900 text-green-400 text-[10px] p-3 rounded-lg overflow-x-auto">
                        <code>{codeSnippet}</code>
                      </pre>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute top-2 right-2 h-6 w-6 bg-gray-700 hover:bg-gray-600 text-gray-300"
                        onClick={() => { navigator.clipboard.writeText(codeSnippet); toast.success('Code copied!'); }}
                      >
                        <Copy className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Theme code dialog — this button previously did nothing. */}
      <Dialog open={showCode} onOpenChange={setShowCode}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-base">Theme embed code</DialogTitle>
            <DialogDescription className="text-xs">
              Paste this into your theme where the reviews should appear. In Shopify admin go to
              Online Store → Themes → Edit code, and add it to your product template.
            </DialogDescription>
          </DialogHeader>

          <pre className="bg-gray-900 text-gray-100 rounded-md p-3 text-[11px] overflow-x-auto whitespace-pre-wrap">
            <code>{codeSnippet}</code>
          </pre>

          <DialogFooter>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setShowCode(false)}>
              Close
            </Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-xs"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(codeSnippet);
                  toast.success('Code copied to clipboard');
                } catch {
                  toast.error('Could not copy. Select the text and copy manually.');
                }
              }}
            >
              Copy code
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
