'use client';

import React, { useState, useEffect } from 'react';
import {
  Download, Globe, ShoppingBag, CheckCircle, Clock, AlertCircle,
  XCircle, RefreshCw, ChevronRight, Link, FileText, Loader2
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { apiFetch, ApiError, errorMessage } from '@/lib/api-client';

const platforms = [
  {
    id: 'amazon', name: 'Amazon', icon: '🟠', color: 'bg-orange-50 border-orange-200 hover:border-orange-300',
    desc: 'Import reviews from Amazon product listings', urlPlaceholder: 'https://amazon.com/dp/B0XXXXXXXX'
  },
  {
    id: 'ebay', name: 'eBay', icon: '🔵', color: 'bg-blue-50 border-blue-200 hover:border-blue-300',
    desc: 'Import reviews from eBay listings', urlPlaceholder: 'https://ebay.com/itm/XXXXXXXX'
  },
  {
    id: 'etsy', name: 'Etsy', icon: '🟠', color: 'bg-amber-50 border-amber-200 hover:border-amber-300',
    desc: 'Import reviews from Etsy shops', urlPlaceholder: 'https://etsy.com/listing/XXXXXXXX'
  },
  {
    id: 'alibaba', name: 'Alibaba', icon: '🟡', color: 'bg-yellow-50 border-yellow-200 hover:border-yellow-300',
    desc: 'Import reviews from Alibaba products', urlPlaceholder: 'https://alibaba.com/product/XXXXXXXX'
  },
  {
    id: 'shopify', name: 'Shopify Store', icon: '🟢', color: 'bg-emerald-50 border-emerald-200 hover:border-emerald-300',
    desc: 'Import from any Shopify store', urlPlaceholder: 'https://store.myshopify.com/products/slug'
  },
];

interface ImportJob {
  id: string;
  source: string;
  status: string;
  totalReviews: number;
  importedReviews: number;
  failedReviews: number;
  errorMessage: string | null;
  createdAt: string;
}

const statusIcons: Record<string, React.ReactNode> = {
  completed: <CheckCircle className="w-4 h-4 text-emerald-500" />,
  processing: <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />,
  pending: <Clock className="w-4 h-4 text-amber-500" />,
  failed: <XCircle className="w-4 h-4 text-red-500" />,
};

export default function ImportPage() {
  const [selectedPlatform, setSelectedPlatform] = useState<string | null>(null);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [productId, setProductId] = useState('');

  useEffect(() => {
    apiFetch<{ jobs: ImportJob[] }>('/api/import')
      .then(d => setJobs(d.jobs || []))
      .catch(() => setJobs([]));
  }, []);

  const handleImport = async () => {
    if (!selectedPlatform) return;
    setImporting(true);
    try {
      // apiFetch throws on any non-2xx. Previously this read data.importedReviews from a
      // failed response and reported "Imported undefined reviews" as a success.
      const data = await apiFetch<{ importedReviews: number }>('/api/import', {
        method: 'POST',
        body: JSON.stringify({ source: selectedPlatform, config: { url: importUrl, productId } }),
      });

      const n = data.importedReviews ?? 0;
      if (n === 0) {
        toast.info(`No reviews were found to import from ${selectedPlatform}.`);
      } else {
        toast.success(`Imported ${n} review${n === 1 ? '' : 's'} from ${selectedPlatform}`);
      }

      setSelectedPlatform(null);
      setImportUrl('');
      setProductId('');
      const jobsData = await apiFetch<{ jobs: ImportJob[] }>('/api/import');
      setJobs(jobsData.jobs || []);
    } catch (err) {
      if (err instanceof ApiError && err.isPlanLimit) {
        toast.error(err.userMessage, {
          description: 'Open Settings to change your plan.',
          duration: 8000,
        });
      } else {
        toast.error(errorMessage(err, 'Import failed'));
      }
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold">Import Reviews</h2>
        <p className="text-xs text-muted-foreground">Import reviews from multiple platforms to build social proof</p>
      </div>

      {/* Platform Selection */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Select Platform</CardTitle>
          <CardDescription className="text-xs">Choose where to import reviews from</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {platforms.map(p => (
              <button
                key={p.id}
                className={`p-4 rounded-xl border-2 text-left transition-all ${p.color} ${selectedPlatform === p.id ? 'ring-2 ring-emerald-500 shadow-md' : ''}`}
                onClick={() => setSelectedPlatform(p.id)}
              >
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{p.icon}</span>
                  <div>
                    <p className="text-sm font-semibold">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground">{p.desc}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Import Form */}
      {selectedPlatform && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              Import from {platforms.find(p => p.id === selectedPlatform)?.name}
              <ChevronRight className="w-4 h-4" />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-xs">Product URL (optional)</Label>
              <div className="relative mt-1.5">
                <Link className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder={platforms.find(p => p.id === selectedPlatform)?.urlPlaceholder}
                  className="pl-8 h-9 text-xs"
                  value={importUrl}
                  onChange={e => setImportUrl(e.target.value)}
                />
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">Paste the product URL to import specific product reviews. Leave empty for general import.</p>
            </div>

            <div>
              <Label className="text-xs">Assign to Product (optional)</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger className="h-9 text-xs mt-1.5">
                  <SelectValue placeholder="Select a product" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All Products (auto-match)</SelectItem>
                  <SelectItem value="manual">Manual Assignment</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="bg-blue-50 rounded-lg p-3">
              <p className="text-xs text-blue-800">
                <strong>How it works:</strong> Our system will fetch reviews from the provided URL, validate each review, and import them into your store.
                Reviews will automatically be matched with your products by title similarity. You can reassign reviews after import.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <Button onClick={handleImport} disabled={importing} className="bg-emerald-600 hover:bg-emerald-700 text-xs gap-1.5">
                {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {importing ? 'Importing...' : 'Start Import'}
              </Button>
              <Button variant="ghost" size="sm" className="text-xs" onClick={() => setSelectedPlatform(null)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Import History */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">Import History</CardTitle>
              <CardDescription className="text-xs">Track your import jobs</CardDescription>
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => fetch('/api/import').then(r => r.json()).then(d => setJobs(d.jobs || []))}>
              <RefreshCw className="w-3 h-3" /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <div className="text-center py-8">
              <FileText className="w-10 h-10 mx-auto text-muted-foreground/30" />
              <p className="text-sm mt-2 text-muted-foreground">No import jobs yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {jobs.map(job => (
                <div key={job.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors">
                  {statusIcons[job.status] || statusIcons.pending}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold capitalize">{job.source}</span>
                      <Badge variant={job.status === 'completed' ? 'default' : 'outline'} className={`text-[10px] h-4 px-1.5 ${job.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : job.status === 'failed' ? 'bg-red-100 text-red-700' : ''}`}>
                        {job.status}
                      </Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {job.status === 'completed'
                        ? `${job.importedReviews} reviews imported`
                        : job.status === 'failed'
                        ? job.errorMessage || 'Import failed'
                        : `Processing ${job.totalReviews} reviews...`}
                    </p>
                  </div>
                  <span className="text-[11px] text-muted-foreground">{new Date(job.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
