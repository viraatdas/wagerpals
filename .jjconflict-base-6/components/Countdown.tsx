'use client';

import { useEffect, useState, memo } from 'react';

interface CountdownProps {
  endTime: number;
}

function Countdown({ endTime }: CountdownProps) {
  const [timeLeft, setTimeLeft] = useState('');

  useEffect(() => {
    const updateCountdown = () => {
      const now = Date.now();
      const diff = endTime - now;

      if (diff <= 0) {
        setTimeLeft('Event ended');
        return 0;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (days > 0) {
        setTimeLeft(`${days}d ${hours}h ${minutes}m`);
      } else if (hours > 0) {
        setTimeLeft(`${hours}h ${minutes}m ${seconds}s`);
      } else {
        setTimeLeft(`${minutes}m ${seconds}s`);
      }

      return diff;
    };

    const diff = updateCountdown();
    if (diff === 0) return;

    // Adaptive interval: update less frequently when far from deadline
    const interval = diff > 24 * 60 * 60 * 1000 ? 60000  // > 1 day: every minute
                   : diff > 60 * 60 * 1000 ? 30000         // > 1 hour: every 30s
                   : 1000;                                   // < 1 hour: every second

    const timer = setInterval(updateCountdown, interval);
    return () => clearInterval(timer);
  }, [endTime]);

  return <span className="tabular-nums">{timeLeft}</span>;
}

export default memo(Countdown);

