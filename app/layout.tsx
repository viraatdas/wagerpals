import type { Metadata, Viewport } from "next";
import { Archivo_Black, IBM_Plex_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";
import MobileAppBanner from "@/components/MobileAppBanner";
import { ClientProviders } from "@/components/ClientProviders";

// Body face. Plus Jakarta Sans carries everything that is language rather
// than quantity: body copy, names, comments, buttons. See DESIGN-SPEC.md
// §Typography — "regular/medium weight; avoid bold except for names."
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});
// Data face. IBM Plex Mono's tabular figures are the reason it is here:
// every stake, odds line, percentage and countdown lines up in a column
// instead of drifting the way proportional numerals do. This is what gives
// the board its ticker precision — see the .numeral / .stat-value classes
// below, and the global .font-mono rule that bakes in tabular-nums.
const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});
// Display face. Archivo Black is a single-weight (400) headline face —
// page titles, wordmark, section headers. Sparingly, and never body copy;
// see DESIGN-SPEC.md §Typography.
const archivoBlack = Archivo_Black({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-display",
  display: "swap",
});

const APP_TITLE = "WagerPals — bet on anything with friends";
const APP_DESCRIPTION =
  "Bet on anything with friends. Real stakes, real fun.";

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
  themeColor: "#FAF7F0",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${plusJakartaSans.variable} ${ibmPlexMono.variable} ${archivoBlack.variable}`}>
      <body className="font-sans antialiased text-foreground">
        <ClientProviders>
          <ServiceWorkerRegistration />
          <a href="#main" className="skip-link">
            Skip to content
          </a>
          <div className="min-h-screen flex flex-col">
            <MobileAppBanner />
            <Header />
            {/*
              Bottom clearance for Header.tsx's fixed mobile bottom-tab bar
              (the `<nav className="md:hidden fixed bottom-0 ...">` there),
              applied once here rather than per-page. Sized to match that
              bar's actual footprint: 1px top border + 4px (pt-1) + 56px
              (each tab's min-h-[56px]) + its own bottom padding
              (max(safe-area, 8px)) = 61px + max(safe-area, 8px). The bar
              is `md:hidden`, so the extra clearance is scoped to the same
              breakpoint; at md and up this falls back to the ordinary
              safe-area inset only.
            */}
            <main
              id="main"
              className="flex-1 pb-[calc(61px+max(env(safe-area-inset-bottom),8px))] md:pb-[env(safe-area-inset-bottom)]"
            >
              {children}
            </main>
          </div>
        </ClientProviders>
      </body>
    </html>
  );
}
