'use client';

import { Event, NetResult, Payment } from '@/lib/types';
import { calculatePayments, formatAmount } from '@/lib/utils';

interface ResolutionBannerProps {
  event: Event;
  netResults: NetResult[];
  isPublic?: boolean;
}

export default function ResolutionBanner({ event, netResults, isPublic = false }: ResolutionBannerProps) {
  if (!event.resolution) return null;

  const payments = calculatePayments([...netResults]);
  const sortedResults = [...netResults].sort((a, b) => b.net - a.net);

  return (
    <div className="glass-strong border border-green-200 rounded-2xl p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-xl font-display font-semibold text-foreground inline-flex items-center gap-2">
            <span className="text-green-600">✓</span> Event Resolved
          </h3>
          <p className="text-muted mt-2">
            Winning side: <span className="font-semibold text-green-700">{event.resolution.winning_side}</span>
          </p>
        </div>
        <div className="chip chip-yes">
          Final
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h4 className="text-sm font-semibold text-muted mb-2 pb-2 border-b border-gray-200">Net Results</h4>
          <div className="space-y-1.5">
            {sortedResults.map((result) => (
              <div
                key={result.user_id}
                className="flex justify-between items-center py-2 px-3 glass-subtle rounded-xl"
              >
                <span className="text-foreground">@{result.username}</span>
                <span
                  className={`font-semibold tabular-nums ${
                    result.net > 0
                      ? 'text-green-700'
                      : result.net < 0
                      ? 'text-red-700'
                      : 'text-muted'
                  }`}
                >
                  {formatAmount(result.net, isPublic)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {payments.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-muted mb-2 pb-2 border-b border-gray-200">Payments</h4>
            <div className="space-y-1.5">
              {payments.map((payment, i) => (
                <div
                  key={i}
                  className="py-2 px-3 glass-subtle rounded-xl text-sm text-muted"
                >
                  <span className="font-medium text-foreground">{payment.from}</span>
                  {' → '}
                  <span className="font-medium text-foreground">{payment.to}</span>
                  {': '}
                  <span className="font-semibold text-green-700 tabular-nums">{isPublic ? `${payment.amount.toFixed(2)} pts` : `$${payment.amount.toFixed(2)}`}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

