'use client';

export const dynamic = 'force-dynamic';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser } from '@stackframe/stack';
import WalletPanel from '@/components/WalletPanel';

export default function WalletPage() {
  const user = useUser({ or: 'return-null' });
  const router = useRouter();

  useEffect(() => {
    if (!user) {
      router.push('/auth/signin');
    }
  }, [user, router]);

  if (!user) {
    return null;
  }

  return (
    <div className="page-shell-narrow mobile-page animate-rise">
      <div className="mb-8">
        <p className="eyebrow mb-1">Wallet</p>
        <h1 className="display-2">Your balance</h1>
      </div>
      <WalletPanel />
      {/* The wallet is exactly where someone wonders where their stake went
          and why the withdraw ceiling is not the whole balance. Answer it in
          place rather than making them go looking. */}
      <p className="text-sm text-ink-muted mt-8">
        <Link href="/about" className="underline underline-offset-4 hover:text-ink">
          How escrow, settlement and withdrawals work
        </Link>
      </p>
    </div>
  );
}
