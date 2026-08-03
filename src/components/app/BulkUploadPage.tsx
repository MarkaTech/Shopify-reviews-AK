'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Upload, Download, FileSpreadsheet, CheckCircle, XCircle,
  AlertCircle, ShoppingBag, ChevronDown, Plus, Trash2, Table
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { apiFetch, ApiError, errorMessage } from '@/lib/api-client';

interface Product {
  id: string;
  title: string;
  image: string | null;
  reviewCount: number;
  averageRating: number;
}

export default function BulkUploadPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ total: number; imported: number; failed: number; errors: string[] } | null>(null);
  const [manualRows, setManualRows] = useState<Array<{ reviewerName: string; rating: string; title: string; body: string }>>([
    { reviewerName: '', rating: '5', title: '', body: '' }
  ]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'file' | 'manual'>('file');
  const [aliUrl, setAliUrl] = useState('');
  const [aliConfirm, setAliConfirm] = useState(false);
  const [aliImporting, setAliImporting] = useState(false);
  const [aliResult, setAliResult] = useState<{ imported: number; skipped: number; listingTotal: number; truncated: boolean } | null>(null);

  useEffect(() => {
    apiFetch<{ products: Product[] }>('/api/products?limit=250')
      .then(d => setProducts(d.products || []))
      .catch(() => setProducts([]));
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      if (!f.name.endsWith('.csv')) {
        toast.error('Please upload a CSV file');
        return;
      }
      setFile(f);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (mode === 'file' && !file) {
      toast.error('Please select a CSV file');
      return;
    }

    setUploading(true);
    setResult(null);

    try {
      const formData = new FormData();
      if (mode === 'file' && file) {
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
      // Without this the type mismatch was masked by ignoreBuildErrors and `errors` could
      // land as undefined, crashing the error list render below.
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

  const handleDownloadTemplate = () => {
    window.open('/api/bulk-upload', '_blank');
  };

  const addRow = () => {
    setManualRows([...manualRows, { reviewerName: '', rating: '5', title: '', body: '' }]);
  };

  const removeRow = (index: number) => {
    setManualRows(manualRows.filter((_, i) => i !== index));
  };

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold">Import Reviews</h2>
        <p className="text-xs text-muted-foreground">Bring in reviews you already own, via CSV or manual entry</p>
      </div>

      {/*
        Replaces the marketplace URL importer, which scraped Amazon and Alibaba product
        pages. That approach fails technically (both sites block automated fetches and
        publish no per-review structured data) and, more importantly, republishing another
        seller's reviews as your own is misrepresentation under the FTC Rule on Consumer
        Reviews and the EU Omnibus Directive. This panel names the two sources that are
        actually defensible — the same two Judge.me and Loox use.
      */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
        <p className="text-xs font-semibold text-blue-900">Where reviews can come from</p>
        <ul className="mt-1.5 space-y-1 text-[11px] text-blue-800">
          <li>
            <strong>Reviews you own</strong> — export them from your own seller account or
            your previous review app, and upload the CSV below.
          </li>
          <li>
            <strong>Your own customers</strong> — after an order is paid, ReviewMaster
            emails the buyer a private link. Those come back marked as verified purchases.
          </li>
        </ul>
        <p className="mt-1.5 text-[11px] text-blue-700">
          Dropshipping from AliExpress? You can import a listing&apos;s reviews below —
          only for the same product you actually sell, and they are always labelled with
          their source, never as verified purchases. Copying reviews from other
          marketplaces (Amazon, eBay, Etsy) is not supported: those describe a different
          seller&apos;s transaction, and presenting them as yours is illegal in the US and EU.
        </p>
      </div>

      {/* Product Selection */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShoppingBag className="w-4 h-4" /> Assign to Product
          </CardTitle>
          <CardDescription className="text-xs">Select which product these reviews are for (optional)</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedProduct} onValueChange={setSelectedProduct}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder="Select a product..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No specific product (general)</SelectItem>
              {products.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-2">
            All {products.length} products synced from your Shopify store are available in the dropdown.
          </p>
        </CardContent>
      </Card>

      {/* Upload Mode Toggle */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex gap-2 mb-4">
            <Button
              variant={mode === 'file' ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setMode('file')}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" /> CSV Upload
            </Button>
            <Button
              variant={mode === 'manual' ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setMode('manual')}
            >
              <Table className="w-3.5 h-3.5" /> Manual Entry
            </Button>
          </div>

          {mode === 'file' ? (
            <div className="space-y-4">
              {/* CSV Upload Area */}
              <div
                className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer hover:border-emerald-300 hover:bg-emerald-50/30 transition-all"
                onClick={() => fileInputRef.current?.click()}
              >
                <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleFileChange} />
                <Upload className="w-10 h-10 mx-auto text-muted-foreground/40" />
                <p className="text-sm font-medium mt-3">
                  {file ? file.name : 'Drop your CSV file here or click to browse'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {file ? `${(file.size / 1024).toFixed(1)} KB` : 'Supports .csv files up to 10MB'}
                </p>
                {file && (
                  <Button variant="ghost" size="sm" className="mt-2 text-xs text-red-500" onClick={(e) => { e.stopPropagation(); setFile(null); setResult(null); }}>
                    Remove file
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={handleDownloadTemplate}>
                  <Download className="w-3.5 h-3.5" /> Download CSV Template
                </Button>
              </div>

              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs font-medium">CSV Template Format:</p>
                <div className="mt-2 overflow-x-auto">
                  <table className="text-[11px] w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-1 pr-3 font-medium text-muted-foreground">reviewerName</th>
                        <th className="text-left py-1 pr-3 font-medium text-muted-foreground">rating</th>
                        <th className="text-left py-1 pr-3 font-medium text-muted-foreground">title</th>
                        <th className="text-left py-1 pr-3 font-medium text-muted-foreground">body</th>
                        <th className="text-left py-1 pr-3 font-medium text-muted-foreground">reviewDate</th>
                        <th className="text-left py-1 pr-3 font-medium text-muted-foreground">reviewerEmail</th>
                        <th className="text-left py-1 pr-3 font-medium text-muted-foreground">verifiedPurchase</th>
                        <th className="text-left py-1 font-medium text-muted-foreground">source</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="py-1 pr-3">John Smith</td>
                        <td className="py-1 pr-3">5</td>
                        <td className="py-1 pr-3">Amazing!</td>
                        <td className="py-1 pr-3">Best product ever...</td>
                        <td className="py-1 pr-3">2025-01-15</td>
                        <td className="py-1 pr-3">john@email.com</td>
                        <td className="py-1 pr-3">true</td>
                        <td className="py-1">direct</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : (
            /* Manual Entry Spreadsheet */
            <div className="space-y-3">
              <div className="overflow-x-auto border rounded-lg">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b">
                      <th className="text-left p-2 font-medium w-[150px]">Reviewer Name *</th>
                      <th className="text-left p-2 font-medium w-[80px]">Rating *</th>
                      <th className="text-left p-2 font-medium w-[200px]">Title</th>
                      <th className="text-left p-2 font-medium">Body *</th>
                      <th className="p-2 w-[40px]"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {manualRows.map((row, i) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="p-1">
                          <input
                            type="text"
                            className="w-full h-8 px-2 rounded border text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            placeholder="Name"
                            value={row.reviewerName}
                            onChange={e => updateRow(i, 'reviewerName', e.target.value)}
                          />
                        </td>
                        <td className="p-1">
                          <select
                            className="w-full h-8 px-2 rounded border text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            value={row.rating}
                            onChange={e => updateRow(i, 'rating', e.target.value)}
                          >
                            {[1, 2, 3, 4, 5].map(n => (
                              <option key={n} value={n}>{n} Star{n > 1 ? 's' : ''}</option>
                            ))}
                          </select>
                        </td>
                        <td className="p-1">
                          <input
                            type="text"
                            className="w-full h-8 px-2 rounded border text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            placeholder="Review title"
                            value={row.title}
                            onChange={e => updateRow(i, 'title', e.target.value)}
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="text"
                            className="w-full h-8 px-2 rounded border text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            placeholder="Review content..."
                            value={row.body}
                            onChange={e => updateRow(i, 'body', e.target.value)}
                          />
                        </td>
                        <td className="p-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeRow(i)}>
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button variant="outline" size="sm" className="text-xs gap-1" onClick={addRow}>
                <Plus className="w-3.5 h-3.5" /> Add Row
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload Button */}
      <Button
        onClick={handleUpload}
        disabled={uploading || (mode === 'file' && !file) || (mode === 'manual' && manualRows.every(r => !r.reviewerName && !r.body))}
        className="bg-emerald-600 hover:bg-emerald-700 text-xs gap-1.5"
      >
        <Upload className="w-3.5 h-3.5" />
        {uploading ? 'Uploading...' : mode === 'file' ? 'Upload CSV' : 'Submit Reviews'}
      </Button>

      {/* AliExpress Import */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Download className="w-4 h-4" /> Import from AliExpress
          </CardTitle>
          <CardDescription className="text-xs">
            Dropshipping this product? Paste its AliExpress listing URL and its reviews are
            imported onto the product selected above — source-labelled, never marked verified.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label className="text-xs">AliExpress product URL</Label>
            <input
              type="url"
              value={aliUrl}
              onChange={e => { setAliUrl(e.target.value); setAliResult(null); }}
              placeholder="https://www.aliexpress.com/item/1005001234567890.html"
              className="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 text-xs shadow-sm"
            />
          </div>
          <label className="flex items-start gap-2 text-[11px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={aliConfirm}
              onChange={e => setAliConfirm(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I confirm this listing is the <strong>same product</strong> I sell — these
              reviews describe the exact item my customers receive. Imported reviews are
              shown with their AliExpress source and are never labelled as verified purchases.
            </span>
          </label>
          <Button
            onClick={handleAliImport}
            disabled={aliImporting || !aliUrl.trim() || !aliConfirm}
            className="bg-emerald-600 hover:bg-emerald-700 text-xs gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            {aliImporting ? 'Importing…' : 'Import Reviews'}
          </Button>
          {aliResult && (
            <div className="text-xs bg-emerald-50 text-emerald-800 rounded-lg p-3">
              Imported {aliResult.imported} review{aliResult.imported === 1 ? '' : 's'}
              {aliResult.skipped > 0 ? `, skipped ${aliResult.skipped} already imported` : ''}
              {aliResult.truncated ? ` — the listing reports ${aliResult.listingTotal} in total; run the import again later or upgrade your plan for more room.` : ''}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card className="border-0 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Upload Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="text-center p-3 bg-emerald-50 rounded-lg">
                <CheckCircle className="w-6 h-6 mx-auto text-emerald-500" />
                <p className="text-lg font-bold text-emerald-700 mt-1">{result.imported}</p>
                <p className="text-[11px] text-emerald-600">Imported</p>
              </div>
              <div className="text-center p-3 bg-red-50 rounded-lg">
                <XCircle className="w-6 h-6 mx-auto text-red-500" />
                <p className="text-lg font-bold text-red-700 mt-1">{result.failed}</p>
                <p className="text-[11px] text-red-600">Failed</p>
              </div>
              <div className="text-center p-3 bg-gray-50 rounded-lg">
                <AlertCircle className="w-6 h-6 mx-auto text-gray-500" />
                <p className="text-lg font-bold">{result.total}</p>
                <p className="text-[11px] text-muted-foreground">Total</p>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="bg-red-50 rounded-lg p-3 max-h-40 overflow-y-auto">
                <p className="text-xs font-medium text-red-800 mb-1">Errors:</p>
                {result.errors.map((err, i) => (
                  <p key={i} className="text-[11px] text-red-600">• {err}</p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
