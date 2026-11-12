'use client';

import React from 'react';
import { Target, CheckCircle2, Circle, Calendar, CheckSquare, Mail } from 'lucide-react';
import { DailyBriefing } from '@/lib/types';

interface TopPrioritiesWidgetProps {
  briefing: DailyBriefing | null;
  onToggleTask?: (title: string) => void;
}

export function TopPrioritiesWidget({ briefing }: TopPrioritiesWidgetProps) {
  const priorities = briefing?.topPriorities || [];

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'CALENDAR':
        return <Calendar className="w-3.5 h-3.5 text-blue-400" />;
      case 'REMINDER':
        return <CheckSquare className="w-3.5 h-3.5 text-amber-400" />;
      case 'GMAIL':
        return <Mail className="w-3.5 h-3.5 text-red-400" />;
      default:
        return <Target className="w-3.5 h-3.5 text-indigo-400" />;
    }
  };

  return (
    <div className="rounded-2xl p-5 md:p-6 bg-zinc-900/60 border border-zinc-800/80 shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-indigo-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Top 3 Priorities Today
          </h3>
        </div>
        <span className="text-[11px] text-zinc-500 font-mono">MUST EXECUTE</span>
      </div>

      {priorities.length === 0 ? (
        <div className="py-6 text-center text-xs text-zinc-500">
          No urgent blockers identified for today.
        </div>
      ) : (
        <div className="space-y-3">
          {priorities.map(p => (
            <div
              key={p.rank}
              className="flex items-start gap-3.5 p-3.5 rounded-xl bg-zinc-950/70 border border-zinc-800/70 hover:border-zinc-700/80 transition-all group"
            >
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-900 border border-zinc-700 text-xs font-semibold text-zinc-300 shrink-0 mt-0.5">
                {p.rank}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h4 className="text-sm font-medium text-white tracking-tight">
                    {p.title}
                  </h4>
                  <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-400 uppercase tracking-wider">
                    {getSourceIcon(p.source)}
                    <span>{p.source}</span>
                  </div>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  {p.reason}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
