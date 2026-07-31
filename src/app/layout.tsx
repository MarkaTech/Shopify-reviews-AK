import type { Metadata } from "next";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ThemeProvider } from "next-themes";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Render every page at request time, not at build time.
 *
 * This is not a performance preference — it is what makes the App Bridge meta tag below
 * work at all. `generateMetadata` is not automatically dynamic: with no dynamic APIs in
 * the tree, Next prerenders this layout during `next build` and bakes the result into the
 * image. `SHOPIFY_API_KEY` is an Azure app setting, not a Docker build argument, so at
 * build time it is undefined — and the meta tag was emitted empty and frozen that way.
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
 */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "ReviewMaster — The Ultimate Shopify Review App",
    description:
      "The most powerful and customizable review app for Shopify stores. Import reviews, showcase them beautifully, and build trust with your customers.",
    icons: {
      icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
    },
    other: {
      "shopify-api-key": process.env.SHOPIFY_API_KEY || "",
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
        Shopify App Bridge.

        Loaded from Shopify's CDN rather than npm on purpose — the script is versionless and
        self-updating, which is how Shopify ships breaking changes to the embedded admin
        without every app needing a release.

        `beforeInteractive` matters: App Bridge must be present before any component tries
        to mint a session token, and it installs a fetch interceptor that adds the
        Authorization header to same-origin requests. Loading it late means the first few
        requests on a cold page go out unauthenticated.

        Harmless outside the Shopify admin: with no parent frame to talk to, the `shopify`
        global simply never becomes usable, and apiFetch falls back to the session cookie.
      */}
      <Script
        src="https://cdn.shopify.com/shopifycloud/app-bridge.js"
        strategy="beforeInteractive"
      />
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
