'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function MobileOAuthCallback() {
  const searchParams = useSearchParams();

  useEffect(() => {
    // Get the OAuth code from Stack Auth
    const code = searchParams.get('code');
    const error = searchParams.get('error');
    
    if (code) {
      // Redirect to mobile app with the auth code
      const mobileUrl = `wagerpals://oauth-callback?code=${encodeURIComponent(code)}`;
      window.location.href = mobileUrl;
      
      // Fallback message if redirect doesn't work
      setTimeout(() => {
        document.body.innerHTML = `
          <div style="padding: 20px; text-align: center; font-family: system-ui;">
            <h2>Authentication Successful!</h2>
            <p>Redirecting to WagerPals app...</p>
            <p style="margin-top: 20px; color: #6b7280;">
              If the app doesn't open automatically,
              <a href="${mobileUrl}" style="color: #2563eb;">click here</a>
            </p>
          </div>
        `;
      }, 2000);
    } else if (error) {
      document.body.innerHTML = `
        <div style="padding: 20px; text-align: center; font-family: system-ui;">
          <h2>Authentication Failed</h2>
          <p style="color: #dc2626;">${error}</p>
          <p style="margin-top: 20px;">
            Please return to the app and try again.
          </p>
        </div>
      `;
    }
  }, [searchParams]);

  return (
    <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'system-ui' }}>
      <div style={{ maxWidth: '400px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>
          Completing Sign In...
        </h1>
        <div style={{
          width: '40px',
          height: '40px',
          border: '3px solid #2563eb',
          borderTopColor: 'transparent',
          borderRadius: '50%',
          margin: '20px auto',
          animation: 'spin 1s linear infinite'
        }} />
        <p style={{ color: '#6b7280', marginTop: '16px' }}>
          Redirecting to WagerPals app...
        </p>
      </div>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

