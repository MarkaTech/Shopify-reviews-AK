import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

// ─── Helpers ───────────────────────────────────────────────────────────────────

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomFloat(min: number, max: number, decimals = 2) {
  const val = Math.random() * (max - min) + min
  return Number(val.toFixed(decimals))
}

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function weightedPick<T extends { weight: number; value: T[] }>(
  options: { weight: number; value: unknown }[],
): unknown {
  const totalWeight = options.reduce((sum, o) => sum + o.weight, 0)
  let r = Math.random() * totalWeight
  for (const option of options) {
    r -= option.weight
    if (r <= 0) return option.value
  }
  return options[options.length - 1].value
}

function daysAgo(days: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - days)
  d.setHours(randomInt(6, 23), randomInt(0, 59), randomInt(0, 59))
  return d
}

function sentimentFromRating(rating: number): string {
  if (rating >= 4) return 'positive'
  if (rating === 3) return 'neutral'
  return 'negative'
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// ─── Data Pools ───────────────────────────────────────────────────────────────

const REVIEWER_NAMES = [
  'Sarah Mitchell',
  'James Rodriguez',
  'Emily Chen',
  'Michael Okafor',
  'Olivia Thompson',
  'Daniel Kim',
  'Isabella Santos',
  'Ethan Williams',
  'Ava Patel',
  'Liam Johnson',
  'Sophia Nakamura',
  'Noah Garcia',
  'Mia Anderson',
  'Lucas Martinez',
  'Charlotte Brown',
  'Alexander Lee',
  'Amelia Davis',
  'Benjamin Taylor',
  'Harper Wilson',
  'Henry Moore',
  'Evelyn Jackson',
  'Sebastian White',
  'Aria Harris',
  'Jack Robinson',
  'Chloe Clark',
  'Owen Lewis',
  'Penelope Walker',
  'William Hall',
  'Layla Young',
  'Mateo King',
  'Zoey Wright',
  'Elijah Scott',
]

const REVIEW_BODIES = [
  // 5-star reviews
  "Absolutely love this product! Exceeded all my expectations. The quality is outstanding and it arrived much faster than I anticipated. Will definitely be ordering more.",
  "Perfect in every way. I've been searching for something like this for months and I'm so glad I finally found it. Works exactly as described and looks even better in person.",
  "This is exactly what I needed. The build quality is excellent, and you can tell a lot of thought went into the design. Five stars all the way!",
  "I'm genuinely impressed. Usually products like this disappoint, but this one delivers on every promise. The packaging was great too — very premium feel.",
  "Best purchase I've made this year. My friends keep asking me where I got it because they want one too. Highly recommended to anyone on the fence.",
  "Outstanding value for the price. I've tried similar products from competitors and none come close. The attention to detail is remarkable.",
  "Couldn't be happier with my purchase. The seller was responsive to my questions and the product itself is top-notch. A+ experience all around.",

  // 4-star reviews
  "Really good product overall. The only reason I'm not giving 5 stars is because the color is slightly different from what's shown in the pictures. Still great though!",
  "Solid quality and does what it's supposed to do. Shipping took a bit longer than expected, but the product itself is well worth the wait.",
  "Very pleased with this purchase. Works well and looks nice. Minor improvement could be made to the instructions, but once figured out it's fantastic.",
  "Good product for the price point. There are slightly better options out there if you're willing to pay more, but for this price range it's hard to beat.",
  "I like it a lot. The quality is good and it serves its purpose well. Took off one star because the sizing runs a little small — consider ordering a size up.",

  // 3-star reviews
  "It's okay. Not great, not terrible. Does what it says but nothing more. I was expecting a bit more quality for the price but it's acceptable.",
  "Average product. It works, but I've seen better. The materials feel a bit cheap and the fit isn't perfect. Would probably look for alternatives next time.",
  "Mixed feelings about this one. Some aspects are really well done, but others feel like an afterthought. Gets the job done though.",
  "Decent for the price. I wasn't blown away but I wasn't disappointed either. If you need something basic and functional, this will work fine.",
  "It's alright. The product works as advertised but there's nothing special about it. I might have gotten my expectations too high from reading other reviews.",

  // 2-star reviews
  "Not what I expected based on the description. The quality is noticeably lower than what the photos suggest. It functions but I wouldn't buy it again.",
  "Somewhat disappointed. The product arrived on time but the build quality is lacking. One of the parts already feels loose after just a week of use.",
  "Below average. I've had better experiences with similar products. The instructions were confusing and the end result doesn't match the listing photos.",
  "I wanted to like this more than I do. The concept is good but the execution falls short. Feels like it was rushed to market without proper testing.",

  // 1-star reviews
  "Very disappointed with this purchase. The product broke within the first week and the materials felt incredibly cheap. Save your money and look elsewhere.",
  "Terrible quality. Nothing like what was advertised. I tried contacting support but haven't heard back. This is the worst online shopping experience I've had.",
  "Do not recommend. Arrived damaged and the replacement process was a nightmare. The product itself feels flimsy and poorly constructed. Returning immediately.",

  // Extra variety
  "Great product, fast shipping, no complaints at all!",
  "Nice enough for the price. A few rough edges here and there but overall a good buy. Would recommend with some caveats.",
  "Solid 4/5. Would be 5/5 if the packaging was a bit more eco-friendly. Product itself is fantastic though.",
  "Exactly what I was looking for. Simple, effective, and well-made.",
  "Pretty good! Not life-changing but definitely a solid product that does what it promises.",
  "After weeks of research I finally pulled the trigger on this and I'm glad I did. It's become part of my daily routine.",
]

const REVIEWER_LOCATIONS = [
  'New York, NY',
  'Los Angeles, CA',
  'Chicago, IL',
  'Houston, TX',
  'Phoenix, AZ',
  'Philadelphia, PA',
  'San Antonio, TX',
  'San Diego, CA',
  'Dallas, TX',
  'San Jose, CA',
  'Austin, TX',
  'Seattle, WA',
  'Denver, CO',
  'Portland, OR',
  'Miami, FL',
  'Atlanta, GA',
  'Boston, MA',
  'Nashville, TN',
  'Minneapolis, MN',
  'Charlotte, NC',
]

const SOURCES_POOL = [
  { source: 'direct', weight: 35 },
  { source: 'amazon', weight: 20 },
  { source: 'ebay', weight: 15 },
  { source: 'etsy', weight: 10 },
  { source: 'walmart', weight: 8 },
  { source: 'alibaba', weight: 7 },
  { source: 'shopify', weight: 5 },
]

const RATING_POOL = [
  { rating: 5, weight: 35 },
  { rating: 4, weight: 25 },
  { rating: 3, weight: 20 },
  { rating: 2, weight: 12 },
  { rating: 1, weight: 8 },
]

const REVIEW_REPLIES = [
  "Thank you so much for the wonderful review! We're thrilled you love your purchase. Don't hesitate to reach out if you need anything.",
  "We really appreciate your feedback! We're always working to improve our products and your input helps a lot.",
  "Thanks for taking the time to write this review. We're glad you had a positive experience!",
  "We hear you on that concern and we're actively working on improvements. Thanks for the honest feedback.",
  "Thank you for your kind words! It means the world to our small team. Enjoy your purchase!",
  "We appreciate your review and we're sorry to hear about the issue. Please reach out to our support team so we can make it right.",
  "So happy to hear this! We put a lot of love into our products and it shows when customers enjoy them.",
  "Thank you for the detailed review — we love hearing from our customers. Stay tuned for new products coming soon!",
]

const REVIEW_TITLES_5 = [
  'Absolutely perfect!',
  'Best purchase ever',
  'Exceeded my expectations',
  'Love it love it love it',
  'Outstanding quality',
  'Highly recommend!',
  'Worth every penny',
]

const REVIEW_TITLES_4 = [
  'Really good product',
  'Great overall',
  'Very satisfied',
  'Solid choice',
  'Almost perfect',
  'Happy with my purchase',
]

const REVIEW_TITLES_3 = [
  'It\'s okay',
  'Decent product',
  'Average at best',
  'Mixed feelings',
  'Does the job',
  'Nothing special',
]

const REVIEW_TITLES_2 = [
  'Not what I expected',
  'Somewhat disappointed',
  'Below average',
  'Could be better',
  'Needs improvement',
]

const REVIEW_TITLES_1 = [
  'Very disappointed',
  'Do not recommend',
  'Terrible quality',
  'Waste of money',
  'Broken on arrival',
]

// ─── Product Definitions ──────────────────────────────────────────────────────

const PRODUCTS = [
  {
    title: 'Classic Cotton Crew Neck T-Shirt',
    handle: 'classic-cotton-crew-neck-tshirt',
    description: 'Premium 100% organic cotton crew neck t-shirt. Soft, breathable, and perfect for everyday wear. Pre-shrunk fabric with reinforced stitching for lasting comfort.',
    vendor: 'StyleHouse',
    productType: 'T-Shirts',
    tags: ['fashion', 'basics', 'cotton', 'unisex', 'organic'],
    priceRange: [19.99, 34.99],
  },
  {
    title: 'Wireless Bluetooth Noise-Cancelling Headphones',
    handle: 'wireless-bluetooth-noise-cancelling-headphones',
    description: 'Immerse yourself in crystal-clear audio with our premium wireless headphones. Active noise cancellation, 30-hour battery life, and ultra-comfortable memory foam ear cushions.',
    vendor: 'TechPro',
    productType: 'Headphones',
    tags: ['electronics', 'audio', 'wireless', 'bluetooth', 'noise-cancelling'],
    priceRange: [79.99, 149.99],
  },
  {
    title: 'Ceramic Pour-Over Coffee Maker Set',
    handle: 'ceramic-pour-over-coffee-maker-set',
    description: 'Handcrafted ceramic dripper with borosilicate glass carafe. Includes reusable stainless steel filter and bamboo stand. Brew barista-quality coffee at home.',
    vendor: 'HomeEssentials',
    productType: 'Coffee & Tea',
    tags: ['home', 'kitchen', 'coffee', 'ceramic', 'handmade'],
    priceRange: [29.99, 49.99],
  },
  {
    title: 'Vitamin C Brightening Serum',
    handle: 'vitamin-c-brightening-serum',
    description: 'Advanced 20% Vitamin C serum with hyaluronic acid and vitamin E. Reduces dark spots, boosts collagen, and leaves skin radiant. Dermatologist-tested, paraben-free.',
    vendor: 'GlowBotanica',
    productType: 'Skincare',
    tags: ['beauty', 'skincare', 'serum', 'vitamin-c', 'organic'],
    priceRange: [24.99, 39.99],
  },
  {
    title: 'Yoga Mat - Premium Non-Slip Exercise Mat',
    handle: 'yoga-mat-premium-non-slip-exercise-mat',
    description: 'Extra thick 6mm eco-friendly TPE yoga mat. Superior grip, perfect cushioning, and includes carrying strap. Ideal for yoga, pilates, and floor exercises.',
    vendor: 'ActiveGear',
    productType: 'Exercise Mats',
    tags: ['sports', 'yoga', 'fitness', 'eco-friendly', 'non-slip'],
    priceRange: [29.99, 49.99],
  },
  {
    title: 'Slim Fit Stretch Denim Jeans',
    handle: 'slim-fit-stretch-denim-jeans',
    description: 'Modern slim fit jeans with comfort stretch technology. Premium denim fabric with classic 5-pocket design. Available in multiple washes.',
    vendor: 'StyleHouse',
    productType: 'Jeans',
    tags: ['fashion', 'denim', 'jeans', 'slim-fit', 'stretch'],
    priceRange: [49.99, 89.99],
  },
  {
    title: 'Smart LED Desk Lamp with USB Charging',
    handle: 'smart-led-desk-lamp-with-usb-charging',
    description: 'Touch-controlled LED desk lamp with 5 color temperatures and 10 brightness levels. Built-in USB-C charging port and 1-hour auto-off timer. Sleek aluminum design.',
    vendor: 'TechPro',
    productType: 'Lighting',
    tags: ['electronics', 'lighting', 'desk-lamp', 'usb', 'smart-home'],
    priceRange: [39.99, 69.99],
  },
  {
    title: 'Handwoven Cotton Throw Blanket',
    handle: 'handwoven-cotton-throw-blanket',
    description: 'Artisan-made cotton throw blanket with bohemian fringe detail. Perfect for couch, bedroom, or outdoor use. Machine washable, 50" x 60".',
    vendor: 'HomeEssentials',
    productType: 'Blankets & Throws',
    tags: ['home', 'decor', 'blanket', 'handmade', 'bohemian'],
    priceRange: [34.99, 59.99],
  },
  {
    title: 'Organic Rosehip Face Oil',
    handle: 'organic-rosehip-face-oil',
    description: 'Cold-pressed organic rosehip seed oil rich in vitamins A and C. Deeply moisturizes, reduces fine lines, and improves skin texture. Suitable for all skin types.',
    vendor: 'GlowBotanica',
    productType: 'Skincare',
    tags: ['beauty', 'skincare', 'face-oil', 'organic', 'rosehip'],
    priceRange: [19.99, 34.99],
  },
  {
    title: 'Resistance Bands Set - 5 Levels',
    handle: 'resistance-bands-set-5-levels',
    description: 'Complete set of 5 latex resistance bands with varying strengths. Includes door anchor, ankle straps, and carrying bag. Perfect for home workouts and physical therapy.',
    vendor: 'ActiveGear',
    productType: 'Exercise Equipment',
    tags: ['sports', 'fitness', 'resistance-bands', 'home-workout', 'physical-therapy'],
    priceRange: [14.99, 29.99],
  },
  {
    title: 'Linen Blend Summer Blazer',
    handle: 'linen-blend-summer-blazer',
    description: 'Lightweight linen-blend blazer perfect for warm weather. Relaxed fit with patch pockets and single-button closure. Can be dressed up or down effortlessly.',
    vendor: 'StyleHouse',
    productType: 'Blazers',
    tags: ['fashion', 'blazer', 'linen', 'summer', 'men'],
    priceRange: [79.99, 129.99],
  },
  {
    title: 'Portable Bluetooth Speaker - Waterproof',
    handle: 'portable-bluetooth-speaker-waterproof',
    description: 'Compact yet powerful Bluetooth 5.0 speaker with IPX7 waterproof rating. 12-hour battery, built-in microphone, and rich 360° sound. Perfect for outdoors.',
    vendor: 'TechPro',
    productType: 'Speakers',
    tags: ['electronics', 'speaker', 'bluetooth', 'waterproof', 'portable'],
    priceRange: [34.99, 59.99],
  },
  {
    title: 'Succulent Garden Kit - DIY Planter Box',
    handle: 'succulent-garden-kit-diy-planter-box',
    description: 'Everything you need to create a beautiful mini succulent garden. Includes wooden planter box, 4 succulent varieties, soil mix, and decorative pebbles.',
    vendor: 'HomeEssentials',
    productType: 'Planters & Garden',
    tags: ['home', 'garden', 'succulents', 'diy', 'planter'],
    priceRange: [24.99, 44.99],
  },
  {
    title: 'Retinol Night Cream - Anti-Aging',
    handle: 'retinol-night-cream-anti-aging',
    description: 'Advanced retinol night cream with peptides and niacinamide. Reduces wrinkles, evens skin tone, and hydrates overnight. Fragrance-free and non-comedogenic.',
    vendor: 'GlowBotanica',
    productType: 'Skincare',
    tags: ['beauty', 'skincare', 'retinol', 'anti-aging', 'night-cream'],
    priceRange: [29.99, 54.99],
  },
  {
    title: 'Adjustable Dumbbell Set 5-52.5 lbs',
    handle: 'adjustable-dumbbell-set-5-52-5-lbs',
    description: 'Space-saving adjustable dumbbell set that replaces 15 sets of weights. Quick-change dial system, durable steel construction, and ergonomic grip.',
    vendor: 'ActiveGear',
    productType: 'Weights & Dumbbells',
    tags: ['sports', 'fitness', 'weights', 'dumbbells', 'home-gym'],
    priceRange: [199.99, 299.99],
  },
]

// ─── Main Seed Function ──────────────────────────────────────────────────────

async function main() {
  console.log('🗑️  Clearing existing data...')

  // Delete in correct order due to foreign key relations
  await db.analyticsEvent.deleteMany()
  await db.review.deleteMany()
  await db.product.deleteMany()
  await db.importJob.deleteMany()
  await db.widgetConfig.deleteMany()
  await db.storeSetting.deleteMany()
  await db.subscriptionPlan.deleteMany()
  await db.store.deleteMany()

  console.log('✅ All data cleared.\n')

  // ── 1. Create Store ────────────────────────────────────────────────────────

  console.log('🏪 Creating store...')
  const store = await db.store.create({
    data: {
      name: 'My Shopify Store',
      domain: 'mystore.myshopify.com',
      shopifyUrl: 'https://mystore.myshopify.com',
      plan: 'pro',
      isActive: true,
    },
  })
  console.log(`   Created store: ${store.name} (${store.id})\n`)

  // ── 2. Create Products ────────────────────────────────────────────────────

  console.log('📦 Creating products...')
  const products: Record<string, { id: string; title: string }> = {}

  for (let i = 0; i < PRODUCTS.length; i++) {
    const p = PRODUCTS[i]
    const product = await db.product.create({
      data: {
        storeId: store.id,
        shopifyId: `shopify_${i + 1}_${Date.now()}`,
        title: p.title,
        handle: p.handle,
        description: p.description,
        image: `https://picsum.photos/seed/product${i + 1}/400/400`,
        price: randomFloat(p.priceRange[0], p.priceRange[1]),
        vendor: p.vendor,
        productType: p.productType,
        tags: JSON.stringify(p.tags),
        isVisible: true,
      },
    })
    products[p.title] = { id: product.id, title: product.title }
    console.log(`   [${i + 1}/15] ${product.title} — $${product.price}`)
  }
  console.log(`   ✅ Created ${Object.keys(products).length} products.\n`)

  // ── 3. Create Reviews ──────────────────────────────────────────────────────

  console.log('⭐ Creating reviews...')

  const productIds = Object.values(products).map((p) => p.id)
  let featuredCount = 0
  let pinnedCount = 0

  // We need to select which reviews will be featured and pinned beforehand
  // so we can set them deterministically
  const FEATURED_INDICES = new Set([3, 11, 24, 38, 52, 67, 78, 85, 91, 97])
  const PINNED_INDICES = new Set([7, 42, 73])

  for (let i = 0; i < 105; i++) {
    // Pick rating based on weighted distribution
    let rating = 5
    const r = Math.random() * 100
    if (r < 8) rating = 1
    else if (r < 20) rating = 2
    else if (r < 40) rating = 3
    else if (r < 65) rating = 4
    else rating = 5

    // Pick source based on weighted distribution
    let source = 'direct'
    const s = Math.random() * 100
    if (s < 5) source = 'shopify'
    else if (s < 12) source = 'alibaba'
    else if (s < 20) source = 'walmart'
    else if (s < 30) source = 'etsy'
    else if (s < 45) source = 'ebay'
    else if (s < 65) source = 'amazon'
    else source = 'direct'

    const reviewerName = randomPick(REVIEWER_NAMES)
    const isFeatured = FEATURED_INDICES.has(i)
    const isPinned = PINNED_INDICES.has(i)
    const hasImages = Math.random() < 0.20
    const hasVideo = Math.random() < 0.05 && !hasImages
    const isVerified = Math.random() < 0.40
    const hasReply = Math.random() < 0.15

    const daysAgoNum = Math.floor(Math.random() * 90) + 1
    const reviewDate = daysAgo(daysAgoNum)

    // Pick a review body appropriate for the rating
    let bodyPool: string[]
    if (rating === 5) bodyPool = REVIEW_BODIES.slice(0, 7)
    else if (rating === 4) bodyPool = REVIEW_BODIES.slice(7, 12)
    else if (rating === 3) bodyPool = REVIEW_BODIES.slice(12, 17)
    else if (rating === 2) bodyPool = REVIEW_BODIES.slice(17, 21)
    else bodyPool = REVIEW_BODIES.slice(21, 24)

    // Sometimes use the extra variety bodies for 4-5 star
    if (rating >= 4 && Math.random() < 0.3) {
      bodyPool = [...bodyPool, ...REVIEW_BODIES.slice(24, 29)]
    }

    const body = randomPick(bodyPool)

    // Pick title based on rating
    let titlePool: string[]
    if (rating === 5) titlePool = REVIEW_TITLES_5
    else if (rating === 4) titlePool = REVIEW_TITLES_4
    else if (rating === 3) titlePool = REVIEW_TITLES_3
    else if (rating === 2) titlePool = REVIEW_TITLES_2
    else titlePool = REVIEW_TITLES_1

    const title = Math.random() < 0.7 ? randomPick(titlePool) : null

    // Spread reviews across products but with some concentration
    // 70% of reviews go to first 5 products, rest spread evenly
    let productId: string
    if (Math.random() < 0.5) {
      productId = randomPick(productIds.slice(0, 5))
    } else {
      productId = randomPick(productIds)
    }

    const images = hasImages
      ? JSON.stringify([
          `https://picsum.photos/seed/review${i + 1}a/400/400`,
          ...(Math.random() < 0.4 ? [`https://picsum.photos/seed/review${i + 1}b/400/400`] : []),
        ])
      : null

    const videoUrl = hasVideo
      ? `https://www.youtube.com/watch?v=dQw4w9WgXcQ&review=${i + 1}`
      : null

    const reply = hasReply ? randomPick(REVIEW_REPLIES) : null
    const repliedAt = reply ? daysAgo(Math.max(0, daysAgoNum - randomInt(1, 5))) : null

    const helpfulCount = rating >= 4 ? randomInt(0, 25) : randomInt(0, 10)
    const notHelpfulCount = randomInt(0, 3)

    await db.review.create({
      data: {
        storeId: store.id,
        productId,
        reviewableType: 'product',
        reviewableId: productId,
        reviewerName,
        reviewerEmail: `${slugify(reviewerName.toLowerCase().split(' ')[0])}${randomInt(10, 99)}@example.com`,
        reviewerLocation: Math.random() < 0.6 ? randomPick(REVIEWER_LOCATIONS) : null,
        verifiedPurchase: isVerified,
        rating,
        title,
        body,
        images,
        videoUrl,
        source,
        sourceUrl:
          source !== 'direct'
            ? `https://www.${source}..com/product/review/${randomInt(1000, 99999)}`
            : null,
        sentiment: sentimentFromRating(rating),
        isFeatured,
        isPublished: Math.random() < 0.95, // 5% unpublished
        isPinned,
        reply,
        repliedAt,
        helpfulCount,
        notHelpfulCount,
        seoTitle: Math.random() < 0.2 ? `${rating}-star review of product by ${reviewerName}` : null,
        seoDescription: Math.random() < 0.1 ? body.slice(0, 160) : null,
        reviewDate,
      },
    })

    if (isFeatured) featuredCount++
    if (isPinned) pinnedCount++
  }
  console.log(`   ✅ Created 105 reviews (${featuredCount} featured, ${pinnedCount} pinned).\n`)

  // ── 4. Create Import Jobs ──────────────────────────────────────────────────

  console.log('📋 Creating import jobs...')
  const now = new Date()

  const importJobs = [
    {
      source: 'amazon',
      status: 'completed',
      totalReviews: 245,
      importedReviews: 240,
      failedReviews: 5,
      errorMessage: null,
      config: JSON.stringify({ marketplace: 'US', autoApprove: true, importImages: true }),
      startedAt: daysAgo(14),
      completedAt: daysAgo(14),
    },
    {
      source: 'csv',
      status: 'completed',
      totalReviews: 89,
      importedReviews: 89,
      failedReviews: 0,
      errorMessage: null,
      config: JSON.stringify({ filename: 'reviews_export.csv', delimiter: ',', encoding: 'utf-8' }),
      startedAt: daysAgo(7),
      completedAt: daysAgo(7),
    },
    {
      source: 'ebay',
      status: 'completed',
      totalReviews: 150,
      importedReviews: 147,
      failedReviews: 3,
      errorMessage: null,
      config: JSON.stringify({ marketplace: 'US', importImages: true, batchSize: 50 }),
      startedAt: daysAgo(5),
      completedAt: daysAgo(5),
    },
    {
      source: 'etsy',
      status: 'completed',
      totalReviews: 68,
      importedReviews: 68,
      failedReviews: 0,
      errorMessage: null,
      config: JSON.stringify({ shopName: 'my-etsy-shop', importImages: true }),
      startedAt: daysAgo(3),
      completedAt: daysAgo(3),
    },

  ]

  for (const job of importJobs) {
    await db.importJob.create({
      data: {
        storeId: store.id,
        source: job.source,
        status: job.status,
        totalReviews: job.totalReviews,
        importedReviews: job.importedReviews,
        failedReviews: job.failedReviews,
        errorMessage: job.errorMessage,
        config: job.config,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      },
    })
    console.log(`   Created import job: ${job.source} — ${job.status}`)
  }
  console.log(`   ✅ Created ${importJobs.length} import jobs.\n`)

  // ── 5. Create Widget Configs ──────────────────────────────────────────────

  console.log('🧩 Creating widget configurations...')

  const widgets = [
    {
      name: 'Product Page Carousel',
      widgetType: 'carousel',
      placement: 'product_page',
      config: JSON.stringify({
        displayMode: 'carousel',
        maxReviews: 20,
        minRating: 1,
        showPhotos: true,
        showVideos: true,
        showRating: true,
        showDate: true,
        showVerifiedBadge: true,
        showSourceBadge: true,
        showHelpful: true,
        showReply: true,
        sortBy: 'newest',
        autoPlay: false,
        slidesPerView: 3,
        showPagination: true,
        showNavigation: true,
        enableLazyLoad: true,
        animationSpeed: 300,
        gap: 16,
        borderRadius: 8,
        padding: 24,
        backgroundColor: '#ffffff',
        textColor: '#111827',
        borderColor: '#e5e7eb',
        starColor: '#FBBF24',
        ratingFilter: true,
        searchEnabled: true,
        photoGalleryEnabled: true,
      }),
    },
    {
      name: 'Homepage Testimonials',
      widgetType: 'testimonial',
      placement: 'home_page',
      config: JSON.stringify({
        displayMode: 'testimonial',
        maxReviews: 6,
        minRating: 4,
        showPhotos: true,
        showVideos: false,
        showRating: true,
        showDate: false,
        showVerifiedBadge: true,
        showSourceBadge: false,
        showHelpful: false,
        showReply: false,
        sortBy: 'featured',
        layout: 'masonry',
        columns: 3,
        columnsMobile: 1,
        avatarSize: 48,
        showReviewerName: true,
        showReviewerLocation: true,
        quoteStyle: true,
        borderColor: '#e5e7eb',
        backgroundColor: '#f9fafb',
        textColor: '#111827',
        starColor: '#FBBF24',
        headingText: 'What Our Customers Say',
        headingSize: 'large',
        showAllReviewsLink: true,
        animation: 'fadeIn',
        borderRadius: 12,
        padding: 32,
      }),
    },
    {
      name: 'Collection Grid',
      widgetType: 'grid',
      placement: 'collection_page',
      config: JSON.stringify({
        displayMode: 'grid',
        maxReviews: 12,
        minRating: 3,
        showPhotos: true,
        showVideos: true,
        showRating: true,
        showDate: true,
        showVerifiedBadge: true,
        showSourceBadge: true,
        showHelpful: true,
        showReply: true,
        sortBy: 'newest',
        columns: 2,
        columnsTablet: 2,
        columnsMobile: 1,
        cardStyle: 'modern',
        showExcerpt: true,
        excerptLength: 150,
        showExpandButton: true,
        ratingFilter: true,
        searchEnabled: true,
        photoGalleryEnabled: true,
        backgroundColor: '#ffffff',
        textColor: '#111827',
        borderColor: '#e5e7eb',
        starColor: '#FBBF24',
        borderRadius: 8,
        padding: 16,
        gap: 16,
        enableLazyLoad: true,
        loadMore: true,
        loadMoreCount: 6,
      }),
    },
  ]

  for (const widget of widgets) {
    await db.widgetConfig.create({
      data: {
        storeId: store.id,
        name: widget.name,
        widgetType: widget.widgetType,
        placement: widget.placement,
        isActive: true,
        config: widget.config,
        schemaName: `reviews_${widget.widgetType}_block`,
      },
    })
    console.log(`   Created widget: ${widget.name} (${widget.widgetType})`)
  }
  console.log(`   ✅ Created ${widgets.length} widget configurations.\n`)

  // ── 6. Create Store Settings ──────────────────────────────────────────────

  console.log('⚙️  Creating store settings...')

  const settings: Record<string, string> = {
    auto_publish: 'true',
    require_approval: 'false',
    email_notifications: 'true',
    show_verified_badge: 'true',
    show_source_badge: 'true',
    min_review_length: '10',
    allow_anonymous: 'false',
    show_ratings_summary: 'true',
    enable_photo_reviews: 'true',
    enable_video_reviews: 'true',
    review_form_position: 'below_reviews',
    widget_theme: 'modern',
    primary_color: '#4F46E5',
    star_color: '#FBBF24',
    custom_css: '',
  }

  for (const [key, value] of Object.entries(settings)) {
    await db.storeSetting.create({
      data: {
        storeId: store.id,
        key,
        value,
      },
    })
    console.log(`   Set ${key} = ${value}`)
  }
  console.log(`   ✅ Created ${Object.keys(settings).length} store settings.\n`)

  // ── 7. Create Subscription Plans ───────────────────────────────────────────

  console.log('💰 Creating subscription plans...')

  const plans = [
    {
      name: 'Free',
      price: 0,
      interval: 'month',
      features: JSON.stringify([
        'Up to 50 reviews',
        'Basic review widget',
        'Email notifications',
        'Review form',
        'Star rating display',
      ]),
      limits: JSON.stringify({
        maxReviews: 50,
        maxWidgets: 1,
        maxImportJobs: 0,
        bulkUpload: false,
        customBranding: false,
        apiAccess: false,
        prioritySupport: false,
      }),
      sortOrder: 0,
    },
    {
      name: 'Pro',
      price: 29,
      interval: 'month',
      features: JSON.stringify([
        'Unlimited reviews',
        'All widget types',
        'All import sources',
        'Bulk CSV upload',
        'Photo & video reviews',
        'Review moderation',
        'Custom widgets',
        'SEO optimization',
        'Advanced analytics',
      ]),
      limits: JSON.stringify({
        maxReviews: -1,
        maxWidgets: 10,
        maxImportJobs: 50,
        bulkUpload: true,
        customBranding: false,
        apiAccess: false,
        prioritySupport: false,
      }),
      sortOrder: 1,
    },
    {
      name: 'Enterprise',
      price: 99,
      interval: 'month',
      features: JSON.stringify([
        'Everything in Pro',
        'Priority support',
        'Custom branding',
        'API access',
        'White-label widgets',
        'Advanced moderation tools',
        'Team accounts',
        'SSO integration',
        'Custom integrations',
        'Dedicated account manager',
      ]),
      limits: JSON.stringify({
        maxReviews: -1,
        maxWidgets: -1,
        maxImportJobs: -1,
        bulkUpload: true,
        customBranding: true,
        apiAccess: true,
        prioritySupport: true,
      }),
      sortOrder: 2,
    },
  ]

  for (const plan of plans) {
    await db.subscriptionPlan.create({
      data: {
        name: plan.name,
        price: plan.price,
        interval: plan.interval,
        features: plan.features,
        limits: plan.limits,
        isActive: true,
        sortOrder: plan.sortOrder,
      },
    })
    console.log(`   Created plan: ${plan.name} — $${plan.price}/${plan.interval}`)
  }
  console.log(`   ✅ Created ${plans.length} subscription plans.\n`)

  // ── Summary ───────────────────────────────────────────────────────────────

  const storeStats = {
    products: await db.product.count({ where: { storeId: store.id } }),
    reviews: await db.review.count({ where: { storeId: store.id } }),
    importJobs: await db.importJob.count({ where: { storeId: store.id } }),
    widgets: await db.widgetConfig.count({ where: { storeId: store.id } }),
    settings: await db.storeSetting.count({ where: { storeId: store.id } }),
    plans: await db.subscriptionPlan.count(),
    featuredReviews: await db.review.count({ where: { storeId: store.id, isFeatured: true } }),
    pinnedReviews: await db.review.count({ where: { storeId: store.id, isPinned: true } }),
    verifiedReviews: await db.review.count({ where: { storeId: store.id, verifiedPurchase: true } }),
    reviewsWithImages: await db.review.count({ where: { storeId: store.id, images: { not: null } } }),
    reviewsWithReplies: await db.review.count({ where: { storeId: store.id, reply: { not: null } } }),
  }

  console.log('═══════════════════════════════════════════════════════════════════')
  console.log('  🌱 SEEDING COMPLETE')
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log(`  Store:          ${store.name}`)
  console.log(`  Products:       ${storeStats.products}`)
  console.log(`  Reviews:        ${storeStats.reviews}`)
  console.log(`  └ Featured:     ${storeStats.featuredReviews}`)
  console.log(`  └ Pinned:       ${storeStats.pinnedReviews}`)
  console.log(`  └ Verified:     ${storeStats.verifiedReviews}`)
  console.log(`  └ With Images:  ${storeStats.reviewsWithImages}`)
  console.log(`  └ With Replies: ${storeStats.reviewsWithReplies}`)
  console.log(`  Import Jobs:    ${storeStats.importJobs}`)
  console.log(`  Widgets:        ${storeStats.widgets}`)
  console.log(`  Settings:       ${storeStats.settings}`)
  console.log(`  Plans:          ${storeStats.plans}`)
  console.log('═══════════════════════════════════════════════════════════════════')
}

main()
  .then(async () => {
    await db.$disconnect()
  })
  .catch(async (e) => {
    console.error('❌ Seeding failed:', e)
    await db.$disconnect()
    process.exit(1)
  })
