'use client';

export const dynamic = 'force-dynamic';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
    </div>
  );
}
