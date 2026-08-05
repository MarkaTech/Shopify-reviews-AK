'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Upload, Download, FileSpreadsheet, CheckCircle2, XCircle, AlertCircle,
  ShoppingBag, Plus, Trash2, Table, Store, ShieldAlert, Info, Link2,
  ArrowRight, Sparkles, Check,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { apiFetch, ApiError, errorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { Panel, PanelHeader, ActionButton, Pill, Tile, type TileTone } from './ui-kit';

interface Product {
  id: string;
  title: string;
  image: string | null;
  reviewCount: number;
  averageRating: number;
}

type Source = 'csv' | 'manual' | 'aliexpress' | 'etsy';

const SOURCES: Array<{
  id: Source;
  label: string;
  blurb: string;
  icon: typeof FileSpreadsheet;
  tone: TileTone;
}> = [
  { id: 'csv', label: 'CSV file', blurb: 'From another review app or your seller account', icon: FileSpreadsheet, tone: 'brand' },
  { id: 'manual', label: 'Type them in', blurb: 'A handful of reviews, entered by hand', icon: Table, tone: 'indigo' },
  { id: 'aliexpress', label: 'AliExpress', blurb: 'Paste a listing URL you dropship', icon: Link2, tone: 'amber' },
  { id: 'etsy', label: 'Etsy', blurb: 'Connect your shop, syncs weekly', icon: Store, tone: 'rose' },
];

export default function BulkUploadPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ total: number; imported: number; failed: number; errors: string[] } | null>(null);
  const [manualRows, setManualRows] = useState<Array<{ reviewerName: string; rating: string; title: string; body: string }>>([
    { reviewerName: '', rating: '5', title: '', body: '' }
  ]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<Source>('csv');
  const [aliUrl, setAliUrl] = useState('');
  const [aliConfirm, setAliConfirm] = useState(false);
  const [aliImporting, setAliImporting] = useState(false);
  const [aliResult, setAliResult] = useState<{ imported: number; skipped: number; listingTotal: number; truncated: boolean } | null>(null);
  const [etsy, setEtsy] = useState<{ connected: boolean; shopId: string | null; lastSyncAt: string | null } | null>(null);
  const [etsyKey, setEtsyKey] = useState('');
  const [etsyShop, setEtsyShop] = useState('');
  const [etsyBusy, setEtsyBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ products: Product[] }>('/api/products?limit=250')
      .then(d => setProducts(d.products || []))
      .catch(() => setProducts([]));
    apiFetch<{ connected: boolean; shopId: string | null; lastSyncAt: string | null }>('/api/etsy/connect')
      .then(setEtsy)
      .catch(() => setEtsy(null));
  }, []);

  const acceptFile = (f: File | undefined) => {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith('.csv')) {
      toast.error('Please upload a CSV file');
      return;
    }
    setFile(f);
    setResult(null);
  };

  const handleUpload = async () => {
    if (source === 'csv' && !file) {
      toast.error('Please select a CSV file');
      return;
    }

    setUploading(true);
    setResult(null);

    try {
      const formData = new FormData();
      if (source === 'csv' && file) {
        formData.append('file', file);
      } else {
        // Convert manual rows to CSV
        const csv = 'reviewerName,rating,title,body\n' + manualRows
          .filter(r => r.reviewerName && r.body)
          .map(r => `"${r.reviewerName}","${r.rating}","${r.title.replace(/"/g, '""')}","${r.body.replace(/"/g, '""')}"`)
          .join('\n');
        formData.append('file', new Blob([csv], { type: 'text/csv' }), 'manual-upload.csv');
      }
      if (selectedProduct && selectedProduct !== '__none__') formData.append('productId', selectedProduct);

      // FormData body, so no JSON Content-Type — apiFetch only sets it for string bodies.
      const data = await apiFetch<{ imported: number; failed: number; total: number; errors?: string[] }>(
        '/api/bulk-upload', { method: 'POST', body: formData }
      );
      // errors is optional on the wire but required by the result state, so default it.
      setResult({ ...data, errors: data.errors ?? [] });

      if (data.imported > 0) {
        toast.success(`Imported ${data.imported} review${data.imported === 1 ? '' : 's'}`);
      }
      if (data.failed > 0) {
        toast.error(`${data.failed} row${data.failed === 1 ? '' : 's'} failed to import`);
      }
      if (data.imported === 0 && data.failed === 0) {
        toast.info('No reviews found in that file.');
      }
    } catch (err) {
      if (err instanceof ApiError && err.isPlanLimit) {
        toast.error(err.userMessage, { description: 'Open Settings to change your plan.', duration: 8000 });
      } else {
        toast.error(errorMessage(err, 'Upload failed. Please try again.'));
      }
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadTemplate = () => window.open('/api/bulk-upload', '_blank');

  const addRow = () => setManualRows([...manualRows, { reviewerName: '', rating: '5', title: '', body: '' }]);
  const removeRow = (index: number) => setManualRows(manualRows.filter((_, i) => i !== index));
  const updateRow = (index: number, field: string, value: string) => {
    const updated = [...manualRows];
    updated[index] = { ...updated[index], [field]: value };
    setManualRows(updated);
  };

  const handleAliImport = async () => {
    if (!selectedProduct || selectedProduct === '__none__') {
      toast.error('Choose which of your products these reviews belong to first.');
      return;
    }
    if (!aliConfirm) {
      toast.error('Confirm the listing is the same product you sell.');
      return;
    }
    setAliImporting(true);
    setAliResult(null);
    try {
      const data = await apiFetch<{ imported: number; skipped: number; listingTotal: number; truncated: boolean }>(
        '/api/import/aliexpress',
        { method: 'POST', body: JSON.stringify({ url: aliUrl, productId: selectedProduct, confirmSameProduct: true }) }
      );
      setAliResult(data);
      if (data.imported > 0) toast.success(`Imported ${data.imported} review${data.imported === 1 ? '' : 's'} from AliExpress`);
      else toast.info('Nothing new to import — every review on that listing is already here.');
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        toast.error(errorMessage(err, 'AliExpress import needs a paid plan.'));
      } else {
        toast.error(errorMessage(err, 'Import failed'));
      }
    } finally {
      setAliImporting(false);
    }
  };

  const etsyConnect = async () => {
    setEtsyBusy(true);
    try {
      const data = await apiFetch<{ authUrl: string }>('/api/etsy/connect', {
        method: 'POST',
        body: JSON.stringify({ keystring: etsyKey, shop: etsyShop }),
      });
      // Etsy's consent screen refuses to be framed; break out of the embedded admin.
      if (window.top) window.top.location.href = data.authUrl;
      else window.location.href = data.authUrl;
    } catch (err) {
      toast.error(errorMessage(err, 'Could not start the Etsy connection'));
      setEtsyBusy(false);
    }
  };

  const etsySync = async () => {
    setEtsyBusy(true);
    try {
      const r = await apiFetch<{ imported: number; skippedExisting: number; skippedUnmatched: number; unmatchedListings: number }>(
        '/api/etsy/sync', { method: 'POST' }
      );
      if (r.imported > 0) toast.success(`Imported ${r.imported} Etsy review${r.imported === 1 ? '' : 's'}`);
      else toast.info('Nothing new — your Etsy reviews are already in sync.');
      if (r.skippedUnmatched > 0) {
        toast.info(`${r.skippedUnmatched} review(s) skipped: their Etsy listings have no product here with the same title.`);
      }
      apiFetch<{ connected: boolean; shopId: string | null; lastSyncAt: string | null }>('/api/etsy/connect').then(setEtsy).catch(() => {});
    } catch (err) {
      toast.error(errorMessage(err, 'Etsy sync failed'));
    } finally {
      setEtsyBusy(false);
    }
  };

  const needsProduct = source === 'aliexpress';
  const productChosen = selectedProduct && selectedProduct !== '__none__';

  return (
    <div className="space-y-5">
      {/* ── Source picker ── */}
      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        {SOURCES.map((s) => {
          const active = source === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setSource(s.id)}
              className={cn(
                'ring-focus group relative rounded-2xl p-4 text-left transition-all duration-200',
                active
                  ? 'surface-float -translate-y-0.5 border-brand-500/40'
                  : 'surface-raised lift'
              )}
            >
              {active && (
                <span className="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-brand-600 text-white shadow-[var(--glow-brand)]">
                  <Check className="size-3" strokeWidth={3.5} />
                </span>
              )}
              <Tile icon={s.icon} tone={s.tone} size="lg" />
              <p className="mt-3 text-[13.5px] font-semibold text-ink-900 dark:text-white">{s.label}</p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">{s.blurb}</p>
              {s.id === 'etsy' && etsy?.connected && (
                <Pill tone="brand" className="mt-2">Connected</Pill>
              )}
            </button>
          );
        })}
      </div>

      {/* ── Provenance notice ──
          Replaces the marketplace URL importer, which scraped Amazon and Alibaba product
          pages. That approach fails technically (both sites block automated fetches and
          publish no per-review structured data) and, more importantly, republishing
          another seller's reviews as your own is misrepresentation under the FTC Rule on
          Consumer Reviews and the EU Omnibus Directive. */}
      <div className="flex gap-3 rounded-2xl border border-indigo-200/70 bg-indigo-50/60 p-4 dark:border-indigo-400/15 dark:bg-indigo-500/[0.07]">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-indigo-600 dark:text-indigo-300" />
        <div className="text-[12px] leading-relaxed text-indigo-900 dark:text-indigo-100">
          <p className="font-semibold">Only import reviews you can stand behind.</p>
          <p className="mt-1 text-indigo-800/90 dark:text-indigo-200/80">
            Reviews you own (your seller account, your previous app) and your own customers&apos;
            reviews are always safe. AliExpress listings are allowed <em>only</em> for the same
            product you sell, and are labelled with their source — never as verified purchases.
            Amazon and eBay are not supported: those describe a different seller&apos;s
            transaction, and presenting them as yours is illegal in the US and EU.
          </p>
        </div>
      </div>

      {/* ── Product assignment ── */}
      <Panel>
        <PanelHeader
          title="Assign to a product"
          description={
            needsProduct
              ? 'Required for AliExpress imports — the reviews attach to this product.'
              : 'Optional. Leave blank for reviews that are about your store in general.'
          }
          icon={ShoppingBag}
          tone="cyan"
          action={
            needsProduct && !productChosen ? <Pill tone="amber">Required</Pill> : undefined
          }
        />
        <div className="px-5 pb-5">
          <Select value={selectedProduct} onValueChange={setSelectedProduct}>
            <SelectTrigger className="h-10 rounded-xl text-[13px]">
              <SelectValue placeholder="Choose a product…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No specific product</SelectItem>
              {products.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="mt-2 text-[11.5px] text-ink-400">
            {products.length} product{products.length === 1 ? '' : 's'} synced from Shopify.
          </p>
        </div>
      </Panel>

      {/* ── CSV ── */}
      {source === 'csv' && (
        <Panel className="animate-rise">
          <PanelHeader
            title="Upload a CSV"
            description="One row per review. Up to 10MB."
            icon={FileSpreadsheet}
            tone="brand"
            action={
              <ActionButton size="sm" variant="outline" icon={Download} onClick={handleDownloadTemplate}>
                Template
              </ActionButton>
            }
          />

          <div className="px-5 pb-5">
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                // Drag and drop was advertised by the copy ("Drop your CSV file here")
                // but never implemented — the div had no drop handler at all.
                e.preventDefault();
                setDragging(false);
                acceptFile(e.dataTransfer.files?.[0]);
              }}
              className={cn(
                'cursor-pointer rounded-2xl border-2 border-dashed p-9 text-center transition-all duration-200',
                dragging
                  ? 'border-brand-500 bg-brand-50/70 dark:bg-brand-500/10'
                  : file
                    ? 'border-brand-300 bg-brand-50/40 dark:border-brand-500/30 dark:bg-brand-500/[0.06]'
                    : 'border-ink-300 hover:border-brand-400 hover:bg-ink-50/60 dark:border-white/12 dark:hover:bg-white/[0.03]'
              )}
            >
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={(e) => acceptFile(e.target.files?.[0])} />
              <Tile icon={file ? CheckCircle2 : Upload} tone={file ? 'brand' : 'ink'} size="xl" className="mx-auto" />
              <p className="mt-4 text-[14px] font-semibold text-ink-900 dark:text-white">
                {file ? file.name : 'Drop your CSV here, or click to browse'}
              </p>
              <p className="mt-1 text-[12px] text-ink-500">
                {file ? `${(file.size / 1024).toFixed(1)} KB · ready to import` : 'Accepts .csv up to 10MB'}
              </p>
              {file && (
                <button
                  onClick={(e) => { e.stopPropagation(); setFile(null); setResult(null); }}
                  className="ring-focus mt-3 rounded text-[12px] font-semibold text-rose-600 hover:text-rose-700"
                >
                  Remove file
                </button>
              )}
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-border">
              <div className="flex items-center gap-2 border-b border-border bg-ink-50/70 px-3 py-2 dark:bg-white/[0.03]">
                <Info className="size-3.5 text-ink-400" />
                <p className="text-[11.5px] font-semibold text-ink-600 dark:text-ink-300">Expected columns</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-border">
                      {['reviewerName', 'rating', 'title', 'body', 'reviewDate', 'reviewerEmail', 'verifiedPurchase', 'source'].map(h => (
                        <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-semibold text-ink-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="text-ink-500">
                      {['John Smith', '5', 'Amazing!', 'Best product ever…', '2026-01-15', 'john@email.com', 'true', 'direct'].map((v, i) => (
                        <td key={i} className="whitespace-nowrap px-3 py-2">{v}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <ActionButton
              className="mt-4"
              icon={Upload}
              onClick={handleUpload}
              disabled={uploading || !file}
            >
              {uploading ? 'Importing…' : 'Import CSV'}
            </ActionButton>
          </div>
        </Panel>
      )}

      {/* ── Manual ── */}
      {source === 'manual' && (
        <Panel className="animate-rise">
          <PanelHeader
            title="Type reviews in"
            description="For a small batch you are transcribing by hand."
            icon={Table}
            tone="indigo"
          />
          <div className="px-5 pb-5">
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-border bg-ink-50/70 dark:bg-white/[0.03]">
                    <th className="w-[170px] px-2.5 py-2 text-left font-semibold text-ink-500">Reviewer *</th>
                    <th className="w-[110px] px-2.5 py-2 text-left font-semibold text-ink-500">Rating *</th>
                    <th className="w-[200px] px-2.5 py-2 text-left font-semibold text-ink-500">Title</th>
                    <th className="px-2.5 py-2 text-left font-semibold text-ink-500">Review *</th>
                    <th className="w-[44px] px-2.5 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {manualRows.map((row, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="p-1.5">
                        <Input
                          className="h-8 rounded-lg text-[12px]"
                          placeholder="Name"
                          value={row.reviewerName}
                          onChange={e => updateRow(i, 'reviewerName', e.target.value)}
                        />
                      </td>
                      <td className="p-1.5">
                        <Select value={row.rating} onValueChange={(v) => updateRow(i, 'rating', v)}>
                          <SelectTrigger className="h-8 rounded-lg text-[12px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[5, 4, 3, 2, 1].map(n => (
                              <SelectItem key={n} value={String(n)}>{n} star{n > 1 ? 's' : ''}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="p-1.5">
                        <Input
                          className="h-8 rounded-lg text-[12px]"
                          placeholder="Optional"
                          value={row.title}
                          onChange={e => updateRow(i, 'title', e.target.value)}
                        />
                      </td>
                      <td className="p-1.5">
                        <Input
                          className="h-8 rounded-lg text-[12px]"
                          placeholder="What did they say?"
                          value={row.body}
                          onChange={e => updateRow(i, 'body', e.target.value)}
                        />
                      </td>
                      <td className="p-1.5">
                        <button
                          onClick={() => removeRow(i)}
                          disabled={manualRows.length === 1}
                          aria-label="Remove row"
                          className="ring-focus rounded-lg p-1.5 text-ink-300 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30 dark:hover:bg-rose-500/10"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <ActionButton size="sm" variant="outline" icon={Plus} onClick={addRow}>
                Add row
              </ActionButton>
              <div className="flex-1" />
              <ActionButton
                icon={Upload}
                onClick={handleUpload}
                disabled={uploading || manualRows.every(r => !r.reviewerName || !r.body)}
              >
                {uploading ? 'Saving…' : `Add ${manualRows.filter(r => r.reviewerName && r.body).length || ''} review${manualRows.filter(r => r.reviewerName && r.body).length === 1 ? '' : 's'}`}
              </ActionButton>
            </div>
          </div>
        </Panel>
      )}

      {/* ── AliExpress ── */}
      {source === 'aliexpress' && (
        <Panel className="animate-rise">
          <PanelHeader
            title="Import from an AliExpress listing"
            description="Paste the listing URL for a product you dropship. Reviews land on the product selected above."
            icon={Link2}
            tone="amber"
          />
          <div className="space-y-4 px-5 pb-5">
            <div>
              <Label className="text-[12.5px] font-semibold">Listing URL</Label>
              <Input
                type="url"
                value={aliUrl}
                onChange={e => { setAliUrl(e.target.value); setAliResult(null); }}
                placeholder="https://www.aliexpress.com/item/1005001234567890.html"
                className="mt-1.5 h-10 rounded-xl text-[13px]"
              />
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-ink-50 p-3 transition-colors hover:bg-ink-100/70 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]">
              <input
                type="checkbox"
                checked={aliConfirm}
                onChange={e => setAliConfirm(e.target.checked)}
                className="mt-0.5 size-4 accent-[var(--brand-600)]"
              />
              <span className="text-[12px] leading-relaxed text-ink-600 dark:text-ink-300">
                I confirm this listing is the <strong className="text-ink-800 dark:text-white">same product</strong> I
                sell — these reviews describe the exact item my customers receive. Imported reviews
                show their AliExpress source and are never labelled as verified purchases.
              </span>
            </label>

            <ActionButton
              icon={Download}
              onClick={handleAliImport}
              disabled={aliImporting || !aliUrl.trim() || !aliConfirm}
            >
              {aliImporting ? 'Importing…' : 'Import reviews'}
            </ActionButton>

            {aliResult && (
              <div className="flex items-start gap-2.5 rounded-xl bg-brand-50 p-3.5 text-[12.5px] text-brand-800 dark:bg-brand-500/10 dark:text-brand-200">
                <Sparkles className="mt-0.5 size-4 shrink-0" />
                <p className="leading-relaxed">
                  Imported <strong>{aliResult.imported}</strong> review{aliResult.imported === 1 ? '' : 's'}
                  {aliResult.skipped > 0 ? `, skipped ${aliResult.skipped} already here` : ''}
                  {aliResult.truncated
                    ? ` — the listing reports ${aliResult.listingTotal} in total. Run the import again later, or upgrade for more room.`
                    : '.'}
                </p>
              </div>
            )}
          </div>
        </Panel>
      )}

      {/* ── Etsy ── */}
      {source === 'etsy' && (
        <Panel className="animate-rise">
          <PanelHeader
            title="Sync from Etsy"
            description="Sell the same products on Etsy? Connect your shop and reviews sync in weekly, matched by product title and counted as verified reviewers."
            icon={Store}
            tone="rose"
          />
          <div className="space-y-4 px-5 pb-5">
            {etsy?.connected ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-brand-50 p-4 dark:bg-brand-500/10">
                <div>
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-brand-800 dark:text-brand-200">
                    <CheckCircle2 className="size-4" />
                    Connected to {etsy.shopId}
                  </p>
                  <p className="mt-0.5 text-[12px] text-brand-700/80 dark:text-brand-300/80">
                    {etsy.lastSyncAt
                      ? `Last synced ${new Date(etsy.lastSyncAt).toLocaleDateString()}`
                      : 'Never synced yet'}
                  </p>
                </div>
                <ActionButton icon={Download} onClick={etsySync} disabled={etsyBusy}>
                  {etsyBusy ? 'Syncing…' : 'Sync now'}
                </ActionButton>
              </div>
            ) : (
              <>
                <div className="flex gap-2.5 rounded-xl bg-ink-50 p-3.5 dark:bg-white/[0.03]">
                  <Info className="mt-0.5 size-4 shrink-0 text-ink-400" />
                  <p className="text-[12px] leading-relaxed text-ink-600 dark:text-ink-300">
                    Needs a free Etsy API keystring. Create one at <strong>etsy.com/developers → Your apps</strong>,
                    and set the callback URL to <code className="rounded bg-ink-200/70 px-1 py-0.5 text-[11px] dark:bg-white/10">/api/etsy/callback</code> on this app&apos;s domain.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-[12.5px] font-semibold">Etsy keystring</Label>
                    <Input
                      value={etsyKey}
                      onChange={e => setEtsyKey(e.target.value)}
                      placeholder="abc123def456…"
                      className="mt-1.5 h-10 rounded-xl text-[13px]"
                    />
                  </div>
                  <div>
                    <Label className="text-[12.5px] font-semibold">Shop ID or name</Label>
                    <Input
                      value={etsyShop}
                      onChange={e => setEtsyShop(e.target.value)}
                      placeholder="YourShopName"
                      className="mt-1.5 h-10 rounded-xl text-[13px]"
                    />
                  </div>
                </div>

                <ActionButton
                  trailingIcon={ArrowRight}
                  onClick={etsyConnect}
                  disabled={etsyBusy || !etsyKey.trim() || !etsyShop.trim()}
                >
                  {etsyBusy ? 'Connecting…' : 'Connect Etsy'}
                </ActionButton>
              </>
            )}
          </div>
        </Panel>
      )}

      {/* ── Results ── */}
      {result && (
        <Panel className="animate-rise">
          <PanelHeader title="Import results" icon={CheckCircle2} tone="brand" />
          <div className="px-5 pb-5">
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Imported', value: result.imported, icon: CheckCircle2, cls: 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300' },
                { label: 'Failed', value: result.failed, icon: XCircle, cls: 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300' },
                { label: 'Rows read', value: result.total, icon: AlertCircle, cls: 'bg-ink-100 text-ink-600 dark:bg-white/5 dark:text-ink-300' },
              ].map(s => (
                <div key={s.label} className={cn('rounded-xl p-4 text-center', s.cls)}>
                  <s.icon className="mx-auto size-5" />
                  <p className="tnum mt-1.5 text-[22px] font-bold leading-none">{s.value}</p>
                  <p className="mt-1 text-[11.5px] font-medium opacity-80">{s.label}</p>
                </div>
              ))}
            </div>

            {result.errors.length > 0 && (
              <div className="mt-4 max-h-44 overflow-y-auto rounded-xl bg-rose-50 p-3.5 dark:bg-rose-500/10">
                <p className="mb-1.5 text-[12px] font-semibold text-rose-800 dark:text-rose-200">
                  {result.errors.length} row{result.errors.length === 1 ? '' : 's'} could not be imported
                </p>
                {result.errors.map((err, i) => (
                  <p key={i} className="text-[11.5px] leading-relaxed text-rose-700 dark:text-rose-300">• {err}</p>
                ))}
              </div>
            )}
          </div>
        </Panel>
      )}
    </div>
  );
}
