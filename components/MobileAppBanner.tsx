'use client';

import { useState, useEffect } from 'react';

// TestFlight link - update this with your actual link from App Store Connect
const TESTFLIGHT_LINK = 'https://testflight.apple.com/join/XXXXXXXX';
// Don't advertise the app until a real invite link is configured — otherwise
// the banner renders a dead "Download on TestFlight" button to every visitor.
const HAS_TESTFLIGHT_LINK = !TESTFLIGHT_LINK.includes('XXXX');

export default function MobileAppBanner() {
  const [isMobile, setIsMobile] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  useEffect(() => {
    // Check if user is on mobile device
    const checkMobile = () => {
      const userAgent = navigator.userAgent || navigator.vendor || (window as any).opera;
      const isMobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(
        userAgent.toLowerCase()
      );
      const isIOSDevice = /iphone|ipad|ipod/i.test(userAgent.toLowerCase());
      // Also check screen width for tablets that might not be detected by user agent
      const isSmallScreen = window.innerWidth < 768;
      setIsMobile(isMobileDevice || isSmallScreen);
      setIsIOS(isIOSDevice);
    };

    // Check if banner was previously dismissed in this session
    const dismissed = sessionStorage.getItem('mobileAppBannerDismissed');
    if (dismissed) {
      setIsDismissed(true);
    }

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleDismiss = () => {
    setIsDismissed(true);
    sessionStorage.setItem('mobileAppBannerDismissed', 'true');
  };

  if (!isMobile || isDismissed || !HAS_TESTFLIGHT_LINK) {
    return null;
  }

  return (
    <div className="border-b border-line bg-card text-ink px-4 py-2.5 relative">
      <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="text-info-ink flex-shrink-0">
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
              />
            </svg>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 min-w-0">
            <p className="text-sm font-medium truncate">
              {isIOS ? 'Get the iOS app' : 'Native app available for iOS'}
            </p>
            {isIOS && (
              <a
                href={TESTFLIGHT_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="press inline-flex items-center gap-1 px-3 py-1 bg-emerald text-on-emerald rounded-control text-xs font-semibold hover:brightness-95 transition-[filter] flex-shrink-0"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                </svg>
                TestFlight
              </a>
            )}
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="press flex-shrink-0 p-1 text-ink-muted hover:text-ink hover:bg-line/40 rounded-control transition-colors"
          aria-label="Dismiss banner"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

