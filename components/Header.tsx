'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { SyncHealthStatus } from '@/lib/types';

interface HeaderProps {
  onRefresh: () => Promise<void>;
  isSyncing: boolean;
  health?: SyncHealthStatus;
  lastSyncTime?: string;
  userName?: string;
}

export function Header({ onRefresh, isSyncing, health, userName }: HeaderProps) {
  const [timeStr, setTimeStr] = useState<string>('');
  const [dateStr, setDateStr] = useState<string>('');

  useEffect(() => {
    function updateClock() {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString('en-MY', {
          timeZone: 'Asia/Kuala_Lumpur',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        })
      );
      setDateStr(
        now.toLocaleDateString('en-MY', {
          timeZone: 'Asia/Kuala_Lumpur',
          weekday: 'long',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })
      );
    }

    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  const getGreeting = () => {
    const hourStr = new Date().toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour: '2-digit',
      hour12: false,
    });
    const hour = parseInt(hourStr, 10);
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const hasError =
    health &&
    (health.appleCalendar.status === 'ERROR' ||
      health.appleReminders.status === 'ERROR' ||
      health.gmail.status === 'ERROR');

  const statusTooltip = hasError
    ? [
        health?.appleCalendar.status === 'ERROR' ? `Calendar: ${health.appleCalendar.message || 'Error'}` : null,
        health?.appleReminders.status === 'ERROR' ? `Reminders: ${health.appleReminders.message || 'Error'}` : null,
        health?.gmail.status === 'ERROR' ? `Gmail: ${health.gmail.message || 'Error'}` : null,
      ]
        .filter(Boolean)
        .join(' • ')
    : 'All integrations connected';

  return (
    <header className="border-b border-zinc-800/60 bg-[#0A0A0C]/85 backdrop-blur-md sticky top-0 z-30 px-4 md:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
      {/* Branding & Greeting */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-white text-zinc-950 flex items-center justify-center shadow-sm">
          <Sparkles className="w-4 h-4" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold tracking-tight text-white">Life OS</h1>
            <span
              className={`w-1.5 h-1.5 rounded-full ${hasError ? 'bg-amber-400' : 'bg-emerald-400/90'}`}
              title={statusTooltip}
            />
          </div>
          <p className="text-xs text-zinc-500">
            {getGreeting()}, <span className="text-zinc-300 font-medium">{userName || process.env.NEXT_PUBLIC_USER_NAME || 'Chris'}</span> · {dateStr || 'Loading...'}
          </p>
        </div>
      </div>

      {/* Live MYT Clock & Sync */}
      <div className="flex items-center gap-4 text-xs">
        <div className="font-mono text-zinc-400 tabular-nums">
          <span className="text-[10px] text-zinc-600 mr-1.5 uppercase tracking-wider">MYT</span>
          {timeStr || '00:00:00'}
        </div>

        <button
          onClick={onRefresh}
          disabled={isSyncing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 hover:border-zinc-700 font-medium transition-all active:scale-95 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-white' : 'text-zinc-400'}`} />
          <span>{isSyncing ? 'Syncing' : 'Sync'}</span>
        </button>
      </div>
    </header>
  );
}
