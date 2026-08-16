import type { Metadata, Viewport } from "next";
import { Inter, Bricolage_Grotesque } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import MobileAppBanner from "@/components/MobileAppBanner";
import { ClientProviders } from "@/components/ClientProviders";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// Display face. Wide, slightly quirky grotesque — gives headlines and the
// wordmark a voice that Inter alone can't carry, while staying legible at
// data-dense sizes. Variable weight so .display-* / .market-title can ask
// for 650 without loading another file.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
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
    <html lang="en" className={`${inter.variable} ${bricolage.variable}`}>
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
