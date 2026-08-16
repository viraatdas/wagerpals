'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useUser } from '@stackframe/stack';
import Logo from './Logo';

const navItems = [
  {
    href: '/',
    label: 'Groups',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-4-4h-1M9 20H4v-2a4 4 0 014-4h1m6-4a4 4 0 11-8 0 4 4 0 018 0zm6 1a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    href: '/all-events',
    label: 'Events',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3M5 11h14M7 21h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    href: '/calendar',
    label: 'Calendar',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3M5 11h14M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01M7 21h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    href: '/create',
    label: 'Create',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14m7-7H5" />
      </svg>
    ),
  },
  {
    href: '/activity',
    label: 'Activity',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
  },
  {
    href: '/profile',
    label: 'Profile',
    icon: (
      <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.121 17.804A9 9 0 1118.879 6.196 9 9 0 015.12 17.804zM15 11a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
];

export default function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useUser({ or: "return-null" });
  const [walletBalance, setWalletBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!user) {
      setWalletBalance(null);
      return;
    }

    fetch(`/api/wallet?userId=${user.id}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => setWalletBalance(data?.wallet?.balance ?? null))
      .catch(() => setWalletBalance(null));
  }, [user]);

  const handleLogout = async () => {
    await user?.signOut();
    router.push('/auth/signin');
  };

  const isActive = (path: string) => {
    return path === '/' ? pathname === '/' : pathname.startsWith(path);
  };

  const desktopLinks = [
    { href: '/', label: 'Groups' },
    { href: '/all-events', label: 'All Events' },
    { href: '/calendar', label: 'Calendar' },
    { href: '/activity', label: 'Activity' },
    { href: '/users', label: 'Users' },
    { href: '/profile', label: 'Profile' },
  ];

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-gray-200 bg-white/90 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3.5">
          <div className="flex justify-between items-center gap-2 sm:gap-3">
            <Link href="/" className="flex min-w-0 items-center gap-2 flex-shrink whitespace-nowrap group">
              <Logo
                variant="lockup"
                animate="mount"
                markClassName="w-7 h-7 sm:w-8 sm:h-8 flex-shrink-0 transition-transform group-hover:scale-105"
              />
            </Link>

            <nav className="flex flex-shrink-0 items-center justify-end gap-2 md:gap-5 min-w-0">
              {user && (
                <Link
                  href="/profile?wallet=deposit#wallet"
                  className="tone-yes tone-surface press inline-flex h-10 max-w-[130px] sm:max-w-none items-center justify-center gap-1.5 overflow-hidden rounded-full border px-2.5 sm:px-3 whitespace-nowrap hover:brightness-95 transition-[filter]"
                  title="Deposit money into your wallet"
                >
                  <svg className="tone-text w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h.01M11 15h2M5 7h14a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2z" />
                  </svg>
                  <span className="tone-text hidden sm:inline text-xs font-semibold uppercase tracking-wide">Wallet</span>
                  <span className="numeral tone-text truncate text-sm">${walletBalance?.toFixed(2) || '0.00'}</span>
                </Link>
              )}

              {desktopLinks.map((link) => {
                const active = isActive(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`press relative hidden md:inline-flex items-center px-1 py-2 text-sm transition-colors whitespace-nowrap ${
                      active
                        ? 'tone-accent tone-text font-semibold'
                        : 'text-muted hover:text-foreground font-medium'
                    }`}
                  >
                    {link.label}
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none absolute inset-x-1 -bottom-0.5 h-0.5 origin-left rounded-full bg-brand-2 transition-transform duration-base ease-out-expo ${
                        active ? 'scale-x-100' : 'scale-x-0'
                      }`}
                    />
                  </Link>
                );
              })}

              <Link href="/create" className="hidden md:inline-flex btn-primary text-sm px-4 py-2 flex-shrink-0">
                Create Event
              </Link>

              {user && (
                <div className="hidden md:flex items-center gap-3 ml-1 pl-5 border-l border-gray-200">
                  <span className="text-sm font-medium text-muted truncate max-w-[120px]">
                    {user.displayName || user.primaryEmail || 'User'}
                  </span>
                  <button
                    onClick={handleLogout}
                    className="tone-no tone-text press text-xs font-semibold uppercase tracking-wide opacity-70 hover:opacity-100 transition-opacity whitespace-nowrap"
                  >
                    Sign Out
                  </button>
                </div>
              )}

              {user && (
                <div className="md:hidden flex items-center min-w-0">
                  <button
                    onClick={handleLogout}
                    className="tone-no tone-surface tone-text press inline-flex h-10 w-10 items-center justify-center rounded-full border text-xs font-semibold hover:brightness-95 transition-[filter]"
                    title={`${user.displayName || user.primaryEmail} - Sign Out`}
                    aria-label="Account sign out"
                  >
                    {(user.displayName || user.primaryEmail || 'U').slice(0, 1).toUpperCase()}
                  </button>
                </div>
              )}
            </nav>
          </div>
        </div>
      </header>

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white/95 backdrop-blur-xl mobile-bottom-nav">
        <div className="grid grid-cols-6 px-1 pt-1">
          {navItems.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`press relative flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] transition-colors ${
                  active ? 'tone-accent tone-text font-semibold' : 'text-muted hover:text-foreground font-medium'
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute top-0 inset-x-4 h-0.5 origin-left rounded-full bg-brand-2 transition-transform duration-base ease-out-expo ${
                    active ? 'scale-x-100' : 'scale-x-0'
                  }`}
                />
                <span className="h-5 w-5 [&>svg]:h-5 [&>svg]:w-5">
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
