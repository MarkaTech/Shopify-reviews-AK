'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Sidebar, { type PageId } from '@/components/app/Sidebar';
import DashboardPage from '@/components/app/DashboardPage';
import ReviewsPage from '@/components/app/ReviewsPage';
import ImportPage from '@/components/app/ImportPage';
import BulkUploadPage from '@/components/app/BulkUploadPage';
import WidgetsPage from '@/components/app/WidgetsPage';
import SettingsPage from '@/components/app/SettingsPage';
import ProductsPage from '@/components/app/ProductsPage';
import { Toaster } from 'sonner';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Store, Star, Shield, Upload, Zap, Globe } from 'lucide-react';

const PAGE_TITLES: Record<PageId, { title: string; desc: string; parent?: string }> = {
  dashboard: { title: 'Dashboard', desc: 'Overview of your reviews and analytics' },
  reviews: { title: 'Reviews', desc: 'Manage all customer reviews', parent: 'Review Management' },
  import: { title: 'Import Reviews', desc: 'Import from Amazon, eBay, Etsy, and more', parent: 'Review Management' },
  'bulk-upload': { title: 'Bulk Upload', desc: 'Upload reviews via CSV or manual entry', parent: 'Review Management' },
  products: { title: 'Products', desc: 'Synced products from Shopify', parent: 'Configuration' },
  widgets: { title: 'Widgets', desc: 'Customize review display on storefront', parent: 'Configuration' },
  settings: { title: 'Settings', desc: 'App preferences and subscription', parent: 'Configuration' },
};

export default function Home() {
  const [currentPage, setCurrentPage] = useState<PageId>('dashboard');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [storeName, setStoreName] = useState('');
  const [storeDomain, setStoreDomain] = useState('');
  const [storePlan, setStorePlan] = useState('free');
  const [shopInput, setShopInput] = useState('');
  // Derive initial error from URL search params (no setState needed)
  const getInitialError = () => {
    if (typeof window === 'undefined') return '';
    const params = new URLSearchParams(window.location.search);
    const error = params.get('error');
    if (error) {
      window.history.replaceState({}, '', window.location.pathname);
      return error || 'Authentication failed';
    }
    return '';
  };
  const [authError, setAuthError] = useState(getInitialError);
  const pageInfo = PAGE_TITLES[currentPage];

  // Check existing session on mount
  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/store');
      if (res.ok) {
        const data = await res.json();
        if (data.store) {
          setStoreName(data.store.name);
          setStoreDomain(data.store.shopifyDomain || data.store.domain);
          setStorePlan(data.store.plan);
          setIsAuthenticated(true);
          return;
        }
      }
      setIsAuthenticated(false);
    } catch {
      // Session invalid or network failure
      setIsAuthenticated(false);
    } finally {
      // Must run on EVERY path. This previously sat after the try/catch, so the
      // successful branch above returned early and never cleared it — leaving the app
      // stuck on "Loading ReviewMaster..." forever, but only once auth actually worked.
      setIsLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!authError) {
      checkSession();
    }
  }, [authError, checkSession]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleInstall = async () => {
    const shop = shopInput.trim().toLowerCase();
    if (!shop) {
      setAuthError('Please enter your store URL');
      return;
    }

    const shopDomain = shop.includes('.myshopify.com') ? shop : `${shop}.myshopify.com`;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shopDomain)) {
      setAuthError('Invalid store URL format');
      return;
    }

    setAuthError('');
    window.location.href = `/api/auth/install?shop=${shopDomain}`;
  };

  const handleLogout = () => {
    // Clear session cookie and reload
    document.cookie = 'reviewmaster_session=; Path=/; Max-Age=0';
    setIsAuthenticated(false);
    setStoreName('');
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
          <p className="text-sm text-gray-500">Loading ReviewMaster...</p>
        </div>
      </div>
    );
  }

  // Not authenticated — show install welcome screen
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-emerald-50/30">
        <div className="w-full max-w-lg mx-auto px-6">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-600 mb-4">
              <Star className="w-8 h-8 text-white" fill="white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">ReviewMaster</h1>
            <p className="text-gray-500 mt-2">The Ultimate Shopify Review App</p>
          </div>

          <Card className="shadow-xl border-0">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg">Install on Your Shopify Store</CardTitle>
              <CardDescription>
                Enter your Shopify store URL to install ReviewMaster and start collecting beautiful customer reviews.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    placeholder="your-store.myshopify.com"
                    value={shopInput}
                    onChange={(e) => setShopInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleInstall()}
                    className="pl-10 h-11"
                  />
                </div>
              </div>

              {authError && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{authError}</p>
              )}

              <Button
                onClick={handleInstall}
                className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-base font-semibold"
              >
                <Store className="w-4 h-4 mr-2" />
                Install on Shopify
              </Button>

              <div className="border-t pt-4 mt-2">
                <p className="text-xs text-center text-gray-400 mb-4">What you get with ReviewMaster:</p>
                <div className="grid grid-cols-2 gap-3">
                  <FeatureItem icon={<Star className="w-4 h-4" />} label="Collect Reviews" desc="CSV, import, manual" />
                  <FeatureItem icon={<Upload className="w-4 h-4" />} label="Import Platform" desc="Amazon, eBay, Etsy" />
                  <FeatureItem icon={<Zap className="w-4 h-4" />} label="Beautiful Widgets" desc="9 customizable types" />
                  <FeatureItem icon={<Shield className="w-4 h-4" />} label="Multi-tenant" desc="Data isolated per store" />
                </div>
              </div>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-gray-400 mt-6">
            By installing, you agree to our{' '}
            <a href="/terms" className="underline hover:text-gray-600">Terms of Service</a>{' '}
            and{' '}
            <a href="/privacy" className="underline hover:text-gray-600">Privacy Policy</a>
          </p>
        </div>
      </div>
    );
  }

  // Authenticated — show the full dashboard
  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <DashboardPage />;
      case 'reviews': return <ReviewsPage />;
      case 'import': return <ImportPage />;
      case 'bulk-upload': return <BulkUploadPage />;
      case 'products': return <ProductsPage />;
      case 'widgets': return <WidgetsPage />;
      case 'settings': return <SettingsPage />;
      default: return <DashboardPage />;
    }
  };

  return (
    <div className="flex min-h-screen bg-gray-50/50">
      <Sidebar currentPage={currentPage} onPageChange={setCurrentPage} />

      <main className="flex-1 ml-[260px]">
        <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-gray-200/60">
          <div className="px-6 py-3">
            <Breadcrumb className="mb-0">
              <BreadcrumbList>
                {pageInfo.parent && (
                  <>
                    <BreadcrumbItem>
                      <BreadcrumbLink
                        href="#"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.preventDefault();
                          if (currentPage === 'reviews' || currentPage === 'import' || currentPage === 'bulk-upload') setCurrentPage('reviews');
                          else if (currentPage === 'products' || currentPage === 'widgets' || currentPage === 'settings') setCurrentPage('settings');
                        }}
                      >
                        {pageInfo.parent}
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator />
                  </>
                )}
                <BreadcrumbItem>
                  <BreadcrumbPage className="text-xs font-medium">{pageInfo.title}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <div className="flex items-center justify-between mt-0.5">
              <div>
                <h1 className="text-base font-bold">{pageInfo.title}</h1>
                <p className="text-[11px] text-muted-foreground">{pageInfo.desc}</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="capitalize">{storeDomain || storeName}</span>
                  <span className="text-gray-300">|</span>
                  <span className="capitalize font-medium">{storePlan}</span>
                </div>
                {currentPage === 'reviews' && (
                  <a
                    href="#"
                    className="text-xs text-emerald-600 hover:text-emerald-700 font-medium flex items-center gap-1"
                    onClick={(e) => { e.preventDefault(); }}
                  >
                    View Store Preview
                  </a>
                )}
              </div>
            </div>
          </div>
        </header>

        <div className="p-6">
          {renderPage()}
        </div>
      </main>

      <Toaster position="top-right" richColors />
    </div>
  );
}

function FeatureItem({ icon, label, desc }: { icon: React.ReactNode; label: string; desc: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex-shrink-0 mt-0.5">
        {icon}
      </div>
      <div>
        <p className="text-xs font-medium text-gray-700">{label}</p>
        <p className="text-[10px] text-gray-400">{desc}</p>
      </div>
    </div>
  );
}
