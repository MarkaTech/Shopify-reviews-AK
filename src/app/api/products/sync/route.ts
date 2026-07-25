import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { withAuth, unauthorizedResponse } from '@/lib/auth';
import { fetchShopifyProducts } from '@/lib/shopify';

const SAMPLE_PRODUCTS = [
  { title: "Premium Leather Crossbody Bag", price: 89.99, vendor: "LuxCraft", productType: "Bags & Accessories" },
  { title: "Organic Matcha Powder - Ceremonial Grade", price: 34.99, vendor: "TeaLeaf Co", productType: "Food & Beverage" },
  { title: "Minimalist Wall Clock - Modern Design", price: 45.00, vendor: "HomeDecor Plus", productType: "Home Decor" },
  { title: "Bluetooth Fitness Tracker Band", price: 59.99, vendor: "FitTech", productType: "Electronics" },
  { title: "Stainless Steel Water Bottle - 32oz", price: 24.99, vendor: "EcoLife", productType: "Kitchen" },
  { title: "Women's Running Shoes - Lightweight", price: 119.99, vendor: "ActiveGear", productType: "Footwear" },
  { title: "Bamboo Cutting Board Set", price: 28.99, vendor: "ChefPro", productType: "Kitchen" },
  { title: "Wireless Charging Pad - Fast Charge", price: 29.99, vendor: "TechPro", productType: "Electronics" },
  { title: "Natural Beeswax Candles - Set of 6", price: 22.50, vendor: "HomeEssentials", productType: "Home Decor" },
  { title: "Men's Casual Oxford Shirt", price: 54.99, vendor: "StyleHouse", productType: "Fashion" },
];

export async function POST(request: Request) {
  try {
    const { storeId, shop, accessToken } = await withAuth(request);

    // Try real Shopify API first
    if (accessToken && shop) {
      try {
        const shopifyProducts = await fetchShopifyProducts(shop, accessToken, 25);
        let synced = 0;

        for (const sp of shopifyProducts) {
          const existing = await db.product.findFirst({
            where: { storeId, shopifyId: String(sp.id) },
          });
          if (existing) continue;

          await db.product.create({
            data: {
              storeId,
              shopifyId: String(sp.id),
              title: sp.title,
              handle: sp.handle,
              description: sp.body_html || null,
              image: sp.image?.src || null,
              price: sp.variants?.[0]?.price ? parseFloat(sp.variants[0].price) : null,
              vendor: sp.vendor || null,
              productType: sp.product_type || null,
              tags: sp.tags || null,
            },
          });
          synced++;
        }

        return NextResponse.json({ synced, total: shopifyProducts.length, source: 'shopify' });
      } catch (err) {
        console.error('Shopify API sync failed, falling back to sample data:', err);
      }
    }

    // Fallback: sample products for development
    const products = await Promise.all(
      SAMPLE_PRODUCTS.map(async (p, i) => {
        const handle = p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-');
        const existing = await db.product.findFirst({ where: { storeId, handle } });
        if (existing) return null;

        return db.product.create({
          data: {
            storeId,
            shopifyId: `shopify_${Date.now()}_${i}`,
            title: p.title,
            handle,
            description: `High-quality ${p.title.toLowerCase()} from ${p.vendor}.`,
            image: `https://picsum.photos/seed/sync${i + 100}/400/400`,
            price: p.price,
            vendor: p.vendor,
            productType: p.productType,
            tags: JSON.stringify([p.productType.toLowerCase(), p.vendor.toLowerCase(), 'new']),
          },
        });
      })
    );

    const synced = products.filter(Boolean).length;
    return NextResponse.json({ synced, total: SAMPLE_PRODUCTS.length, source: 'sample' });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes('Unauthorized')) return unauthorizedResponse();
    console.error('Error syncing products:', error);
    return NextResponse.json({ error: 'Failed to sync products' }, { status: 500 });
  }
}
