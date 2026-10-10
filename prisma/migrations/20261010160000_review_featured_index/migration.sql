-- An index for the Review highlights box: a store's featured, published reviews, newest first.
--
-- The highlights request runs on product pages beside Add to cart. No existing index leads
-- with isFeatured, so finding a store's few featured reviews meant reading every review the
-- store has. Additive and idempotent like every migration here; the name is the one Prisma
-- generates for @@index([storeId, isFeatured, isPublished, reviewDate]).

CREATE INDEX IF NOT EXISTS "Review_storeId_isFeatured_isPublished_reviewDate_idx"
  ON "Review"("storeId", "isFeatured", "isPublished", "reviewDate");
