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
 * The client ID, which App Bridge needs in a meta tag.
 *
 * Safe to render into the page: it is the app's public identifier, the same value that
 * appears in every OAuth URL. The secret it pairs with never leaves the server.
 *
 * generateMetadata rather than a static `metadata` object because the value comes from the
 * environment at request time — a static export would bake in whatever was set at build
 * time, which in a Docker build is nothing.
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
