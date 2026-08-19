'use client';

import { useEffect, useState, memo } from 'react';

interface CountdownProps {
  endTime: number;
  /** Optional presentational variant. Defaults preserve existing call sites. */
  variant?: 'inline' | 'pill';
}

function Countdown({ endTime, variant = 'inline' }: CountdownProps) {
  const [timeLeft, setTimeLeft] = useState('');
  const [isUrgent, setIsUrgent] = useState(false);
  const [isEnded, setIsEnded] = useState(false);

  useEffect(() => {
    const updateCountdown = () => {
      const now = Date.now();
      const diff = endTime - now;

      if (diff <= 0) {
        setTimeLeft('Event ended');
        setIsUrgent(false);
        setIsEnded(true);
        return 0;
      }

      setIsEnded(false);
      setIsUrgent(diff <= 60 * 60 * 1000);

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

  const toneClass = isEnded ? 'tone-pending tone-text' : isUrgent ? 'tone-pending tone-text animate-urgent' : '';

  if (variant === 'pill') {
    return (
      <span className={`pill ${isEnded ? 'tone-pending' : isUrgent ? 'tone-pending' : 'tone-yes'} ${isUrgent ? 'animate-urgent' : ''}`}>
        <span className="tone-dot" />
        <span className="font-mono">{timeLeft}</span>
      </span>
    );
  }

  return (
    <span className={`font-mono ${toneClass}`}>{timeLeft}</span>
  );
}

export default memo(Countdown);
