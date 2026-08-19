'use client';

import { Event, NetResult, Payment } from '@/lib/types';
import { calculatePayments } from '@/lib/utils';
import WAmount from './WMark';

interface ResolutionBannerProps {
  event: Event;
  netResults: NetResult[];
}

export default function ResolutionBanner({ event, netResults }: ResolutionBannerProps) {
  if (!event.resolution) return null;

  // Currency is the EVENT's own payment_type, not the group's public/private
  // flag — a private group can still run a free (W) event alongside its
  // cash ones, and vice versa (see W-CURRENCY-SPEC.md).
  const isCash = event.payment_type === 'cash';

  const payments = calculatePayments([...netResults]);
  const sortedResults = [...netResults].sort((a, b) => b.net - a.net);

  return (
    <div className="card-focal tone-win rail p-6 mb-6 animate-reveal">
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <span className="eyebrow tone-text tone-win">Settled</span>
          <p className="display-3 mt-1">
            <span className="font-mono tabular-nums tone-text">{event.resolution.winning_side}</span> won
          </p>
        </div>
        <span className="pill pill-solid tone-win shrink-0">Final</span>
      </div>

      <div className="rule mb-5" />

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <div className="section-head mb-3">
            <h4 className="eyebrow">Net results</h4>
          </div>
          <div className="space-y-1.5">
            {sortedResults.map((result) => (
              <div
                key={result.user_id}
                className={`flex justify-between items-center gap-3 py-2 px-3 rounded-xl panel ${
                  result.net > 0 ? 'tone-gold' : result.net < 0 ? 'tone-loss' : 'tone-neutral'
                }`}
              >
                <span className="text-foreground truncate min-w-0">@{result.username}</span>
                <span className="numeral tone-text text-base shrink-0">
                  {isCash ? (
                    (result.net >= 0 ? '+' : '-') + `$${Math.abs(result.net).toFixed(2)}`
                  ) : (
                    <span className="inline-flex items-baseline gap-0.5">
                      {result.net >= 0 ? '+' : '-'}
                      <WAmount value={Math.abs(result.net)} />
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        {payments.length > 0 && (
          <div>
            <div className="section-head mb-3">
              <h4 className="eyebrow">Payments</h4>
            </div>
            <div className="space-y-1.5">
              {payments.map((payment, i) => (
                <div
                  key={i}
                  className="panel py-2 px-3 rounded-xl text-sm text-muted"
                >
                  <span className="font-medium text-foreground break-words">{payment.from}</span>
                  {' → '}
                  <span className="font-medium text-foreground break-words">{payment.to}</span>
                  {': '}
                  <span className="numeral tone-text tone-gold text-base">
                    {isCash ? `$${payment.amount.toFixed(2)}` : <WAmount value={payment.amount} />}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
