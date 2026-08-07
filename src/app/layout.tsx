import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "next-themes";
import { shopifyClientId } from "@/lib/client-id";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * A display serif, used on exactly three surfaces: the setup guide headline, the welcome
 * screen hero, and empty-state titles.
 *
 * Every Shopify review app is set in a geometric sans, so a sans headline reads as
 * "another app in the category" no matter how well it is spaced. One well-chosen serif at
 * large sizes is the cheapest possible signal that someone made deliberate choices here —
 * and confining it to headlines keeps the data-dense screens legible, which is where a
 * serif would actually hurt.
 */
const instrumentSerif = Instrument_Serif({
  variable: "--font-display",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

/**
 * Render every page at request time, not at build time.
 *
 * This is not a performance preference — it is what makes the App Bridge meta tag below
 * work at all. `generateMetadata` is not automatically dynamic: with no dynamic APIs in
 * the tree, Next prerenders this layout during `next build` and bakes the result into the
 * image. The client ID is an Azure app setting, not a Docker build argument, so at build
 * time it is undefined — and the meta tag would be emitted empty and frozen that way.
 *
 * The symptom was quiet and easy to misread: the App Bridge script loaded fine, so the
 * page looked correct, but with no client ID App Bridge never initialised, `window.shopify`
 * stayed undefined, and no session token was ever minted. Every request silently fell back
 * to the cookie — exactly the state Shopify's pre-submission check rejects.
 *
 * Nothing here should be statically cached in any case: this is an embedded admin app,
 * every page is per-merchant, and there is no anonymous traffic to serve from a CDN.
 */
export const dynamic = 'force-dynamic';

/**
 * The client ID, which App Bridge needs in a meta tag.
 *
 * Safe to render into the page: it is the app's public identifier, the same value that
 * appears in every OAuth URL. The secret it pairs with never leaves the server.
 *
 * Read through `shopifyClientId()` rather than `process.env` directly. The first attempt at
 * this tag read an unprefixed `SHOPIFY_API_KEY` that is not what the deployment actually
 * sets, so it resolved to an empty string — and Next omits a meta tag with empty content
 * entirely. The page looked fine and App Bridge silently never initialised.
 *
 * The warning below exists because that failure mode leaves no other trace. An embedded app
 * without this tag cannot mint session tokens, which is the one thing App Store review
 * checks for.
 */
export async function generateMetadata(): Promise<Metadata> {
  const clientId = shopifyClientId();
  if (!clientId && process.env.NODE_ENV === 'production') {
    console.warn(
      '[layout] No Shopify client ID in the environment — the App Bridge meta tag will be ' +
        'omitted and session tokens will not work. Set SHOPIFY_API_KEY.'
    );
  }

  return {
    title: "ReviewMaster — The Ultimate Shopify Review App",
    description:
      "The most powerful and customizable review app for Shopify stores. Import reviews, showcase them beautifully, and build trust with your customers.",
    icons: {
      // First-party. This pointed at z-cdn.chatglm.cn — an unrelated third-party CDN,
      // in the <head> of every page, on every load. A reviewer opening devtools sees a
      // request to a domain that has nothing to do with this app, and it is a live
      // dependency on someone else's uptime for the app's own icon.
      icon: "/icon.svg",
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/*
        App Bridge, written straight into the head rather than through next/script.

        Shopify's requirement is literal: the meta tag, then the script, both in the <head>
        of every document. `<Script strategy="beforeInteractive">` does not do that in the
        App Router. It emits a `<link rel="preload">` in the head and pushes the real URL
        into a `self.__next_s` queue in the body, which Next's own runtime drains after
        hydration starts. So App Bridge arrived late, `window.shopify` was undefined for the
        first render, and every initial data fetch went out with no session token and fell
        back to the cookie — which is exactly what the auth telemetry recorded.

        A plain non-async <script> is not hoisted by React, so it stays where it is written
        and runs synchronously, before any application code. The meta tag precedes it
        because App Bridge reads the client ID at execution time; the tag arriving after
        would leave it configured with nothing.

        The Metadata API cannot express this — it controls the tags but not their position
        relative to a script — so the meta tag lives here rather than in generateMetadata.

        Harmless outside the Shopify admin: with no parent frame to talk to, `window.shopify`
        never becomes usable and apiFetch falls back to the session cookie.
      */}
      <head>
        <meta name="shopify-api-key" content={shopifyClientId()} />
        {/* Synchronous on purpose — see above. Deferring it is what broke session tokens. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
