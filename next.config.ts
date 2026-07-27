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
};

export default nextConfig;
