import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, Oswald } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import MobileAppBanner from "@/components/MobileAppBanner";
import { ClientProviders } from "@/components/ClientProviders";

// UI face. Humanist rather than neutral-grotesque: this product's content is
// people arguing with each other, and Plex has a spoken warmth Inter doesn't.
// Carries everything that is language rather than quantity.
const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});
// Display face. Condensed and chunky with tabular lining figures — reserved for
// quantities and verdicts (stakes, odds, side counts, countdown, SETTLED), so a
// column of money aligns and the numbers read before the labels. See DESIGN.md.
const oswald = Oswald({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const APP_TITLE = "WagerPals - Polymarket for friends";
const APP_DESCRIPTION =
  "A public, lightweight place where friends create events and share a ledger of bets";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://wagerpals.io"),
  title: APP_TITLE,
  description: APP_DESCRIPTION,
  applicationName: "WagerPals",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "WagerPals",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icons/icon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/icon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-48x48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/wagerpals-mark.svg", type: "image/svg+xml" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    siteName: "WagerPals",
    title: APP_TITLE,
    description: APP_DESCRIPTION,
    url: "/",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "WagerPals — bet with your friends",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: APP_TITLE,
    description: APP_DESCRIPTION,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${plex.variable} ${oswald.variable}`}>
      <body className="font-sans antialiased text-foreground">
        <ClientProviders>
          <ServiceWorkerRegistration />
          <a href="#main" className="skip-link">
            Skip to content
          </a>
          <div className="min-h-screen flex flex-col">
            <MobileAppBanner />
            <Header />
            <main id="main" className="flex-1">
              {children}
            </main>
          </div>
        </ClientProviders>
      </body>
    </html>
  );
}
