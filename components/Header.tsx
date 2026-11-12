'use client';

import React, { useState, useEffect } from 'react';
import { RefreshCw, CheckCircle2, AlertCircle, Calendar, CheckSquare, Mail, Sparkles } from 'lucide-react';
import { SyncHealthStatus } from '@/lib/types';

interface HeaderProps {
  onRefresh: () => Promise<void>;
  isSyncing: boolean;
  health?: SyncHealthStatus;
  lastSyncTime?: string;
  userName?: string;
}

export function Header({ onRefresh, isSyncing, health, lastSyncTime, userName }: HeaderProps) {
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
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <header className="border-b border-zinc-800/80 bg-zinc-950/60 backdrop-blur-md sticky top-0 z-30 px-4 md:px-8 py-3.5 flex flex-wrap items-center justify-between gap-4">
      {/* Branding & Greeting */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold tracking-tight text-white">LIFE OS</h1>
            <span className="text-[10px] font-medium tracking-wider uppercase px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/50">
              v1.0
            </span>
          </div>
          <p className="text-xs text-zinc-400">
            {getGreeting()}, <span className="text-zinc-200 font-medium">{userName || process.env.NEXT_PUBLIC_USER_NAME || 'Chris'}</span> • {dateStr || 'Loading...'}
          </p>
        </div>
      </div>

      {/* Health status & Live Clock */}
      <div className="flex items-center gap-4 text-xs">
        {/* Integration Status Badges */}
        <div className="hidden sm:flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-900/80 border border-zinc-800 text-zinc-400">
          <div className="flex items-center gap-1.5" title="Apple Calendar">
            <Calendar className="w-3.5 h-3.5 text-blue-400" />
            <span className={`w-1.5 h-1.5 rounded-full ${health?.appleCalendar.status === 'OK' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          </div>
          <span className="text-zinc-700">|</span>
          <div className="flex items-center gap-1.5" title="Apple Reminders">
            <CheckSquare className="w-3.5 h-3.5 text-amber-400" />
            <span className={`w-1.5 h-1.5 rounded-full ${health?.appleReminders.status === 'OK' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          </div>
          <span className="text-zinc-700">|</span>
          <div className="flex items-center gap-1.5" title="Gmail">
            <Mail className="w-3.5 h-3.5 text-red-400" />
            <span className={`w-1.5 h-1.5 rounded-full ${health?.gmail.status === 'OK' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          </div>
        </div>

        {/* Live MYT Clock */}
        <div className="px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-zinc-300">
          <span className="text-[10px] text-zinc-500 mr-1.5 uppercase tracking-wider">MYT</span>
          {timeStr || '00:00:00'}
        </div>

        {/* Sync Button */}
        <button
          onClick={onRefresh}
          disabled={isSyncing}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            isSyncing
              ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
              : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/80 hover:border-zinc-600 active:scale-95'
          }`}
          title={lastSyncTime ? `Last synced: ${new Date(lastSyncTime).toLocaleTimeString()}` : 'Sync all connected accounts'}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin text-indigo-400' : 'text-zinc-400'}`} />
          <span>{isSyncing ? 'Syncing...' : 'Sync'}</span>
        </button>
      </div>
    </header>
  );
}
