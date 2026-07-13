'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function InviteContent() {
  const searchParams = useSearchParams();
  const title = searchParams.get('title') || 'Untitled Wager';
  const sideA = searchParams.get('sideA') || 'Side A';
  const sideB = searchParams.get('sideB') || 'Side B';
  const pick = searchParams.get('pick');
  const amount = searchParams.get('amount');

  const optionalParams = `${pick ? `&pick=${encodeURIComponent(pick)}` : ''}${amount ? `&amount=${encodeURIComponent(amount)}` : ''}`;
  const deepLink = `wagerpals://invite?title=${encodeURIComponent(title)}&sideA=${encodeURIComponent(sideA)}&sideB=${encodeURIComponent(sideB)}${optionalParams}`;
  const createWebLink = `/create?title=${encodeURIComponent(title)}&sideA=${encodeURIComponent(sideA)}&sideB=${encodeURIComponent(sideB)}${optionalParams}`;

  return (
    <div className="max-w-lg mx-auto px-4 py-12 animate-rise">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="font-display text-3xl font-semibold text-foreground mb-1">
          <span className="font-light">Wager</span>
          <span className="text-gradient font-bold">Pals</span>
        </h1>
        <p className="text-muted">You&apos;ve been invited to a wager!</p>
      </div>

      {/* Wager Card */}
      <div className="glass-strong rounded-3xl p-8 mb-8">
        <h2 className="font-display text-2xl font-semibold text-foreground text-center mb-6">
          {title}
        </h2>

        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1 glass-subtle rounded-2xl p-4 text-center">
            <p className="text-xs font-semibold text-muted-2 uppercase tracking-wide mb-1">Side A</p>
            <p className="text-lg font-semibold text-green-700 break-words">{sideA}</p>
          </div>
          <span className="text-sm font-bold text-muted-2">vs</span>
          <div className="flex-1 glass-subtle rounded-2xl p-4 text-center">
            <p className="text-xs font-semibold text-muted-2 uppercase tracking-wide mb-1">Side B</p>
            <p className="text-lg font-semibold text-red-600 break-words">{sideB}</p>
          </div>
        </div>

        <p className="text-center text-sm text-muted-2">
          {pick && amount
            ? `Suggested bet: $${amount} on ${pick}.`
            : 'Open the app or create this wager on the web to start betting.'}
        </p>
      </div>

      {/* Action Buttons */}
      <div className="space-y-3">
        <a
          href={deepLink}
          className="btn-primary block w-full py-4 rounded-2xl text-center text-lg"
        >
          Open in WagerPals App
        </a>

        <Link
          href={createWebLink}
          className="btn-glass block w-full py-4 rounded-2xl text-center text-lg"
        >
          Create on Web
        </Link>
      </div>

      {/* Footer hint */}
      <p className="text-center text-xs text-muted-2 mt-8">
        Don&apos;t have WagerPals?{' '}
        <Link href="/" className="text-brand-2 hover:underline">
          Learn more
        </Link>
      </p>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-lg mx-auto px-4 py-12">
          <p className="text-center text-muted">Loading invite...</p>
        </div>
      }
    >
      <InviteContent />
    </Suspense>
  );
}
