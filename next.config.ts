import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",

  typescript: {
    // Was `ignoreBuildErrors: true`.
    //
    // That setting is why several real defects shipped: a Prisma upsert against a
    // non-existent compound unique key, a `setResult` call that could store `undefined`
    // where an array was required, and — worst — five calls to `fetchReviews()` on the
    // Reviews page, a function that did not exist. Every one of those threw at runtime
    // while the build went green. tsc had been reporting all of them the whole time.
    //
    // The codebase now typechecks clean (`npx tsc --noEmit` -> 0 errors), so this can stay
    // off. If a future build fails here, that is the point: fix the type error rather than
    // re-enabling this.
    ignoreBuildErrors: false,
  },

  reactStrictMode: false,

  /**
   * Long-lived caching for the brand images and the self-hosted fonts.
   *
   * Next serves `public/` with `Cache-Control: public, max-age=0`, so every free-plan
   * product page view revalidated the attribution icon against the app server instead of
   * the shopper's cache — and on a cold instance the icon popped in late, or not at all.
   * The brand PNGs and the Archivo files are fixed artwork that only ever changes under a
   * new filename, which is exactly the contract `immutable` describes. The middleware
   * matcher already excludes both folders, so nothing downstream rewrites this.
   */
  async headers() {
    const immutable = [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }];
    return [
      { source: '/brand/:path*', headers: immutable },
      { source: '/fonts/:path*', headers: immutable },
    ];
  },
};

export default nextConfig;
