'use client';

import React, { useState } from 'react';
import { Sparkles, Volume2, RefreshCw, AlertTriangle, ChevronDown, ChevronUp, Calendar, CheckSquare, Mail, Target } from 'lucide-react';
import { DailyBriefing } from '@/lib/types';

function formatBulletText(text?: string): string {
  if (!text) return '';
  return text
    .replace(/\s*•\s*/g, '\n• ')
    .replace(/^\n/, '')
    .trim();
}

interface DailyBriefingCardProps {
  briefing: DailyBriefing | null;
  isLoading: boolean;
}

export function DailyBriefingCard({ briefing, isLoading }: DailyBriefingCardProps) {
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'CALENDAR':
        return <Calendar className="w-3 h-3 text-blue-400" />;
      case 'REMINDER':
        return <CheckSquare className="w-3 h-3 text-amber-400" />;
      case 'GMAIL':
        return <Mail className="w-3 h-3 text-red-400" />;
      default:
        return <Target className="w-3 h-3 text-indigo-400" />;
    }
  };

  const handleSpeak = () => {
    if (!briefing || !window.speechSynthesis) return;

    if (isPlayingAudio) {
      window.speechSynthesis.cancel();
      setIsPlayingAudio(false);
      return;
    }

    const textToRead = `${briefing.headline}. Here are your priorities for today: ${briefing.topPriorities
      .map(p => `Priority ${p.rank}: ${p.title}. ${p.reason}`)
      .join(' ')}. Schedule: ${briefing.agendaSummary}. Communication: ${briefing.emailHighlights}`;

    const utterance = new SpeechSynthesisUtterance(textToRead);
    utterance.rate = 1.05;
    utterance.onend = () => setIsPlayingAudio(false);
    utterance.onerror = () => setIsPlayingAudio(false);

    setIsPlayingAudio(true);
    window.speechSynthesis.speak(utterance);
  };

  if (!briefing && isLoading) {
    return (
      <div className="rounded-2xl p-6 bg-zinc-900/60 border border-zinc-800 animate-pulse">
        <div className="h-4 bg-zinc-800 rounded w-1/4 mb-4" />
        <div className="h-6 bg-zinc-800 rounded w-3/4 mb-6" />
        <div className="grid md:grid-cols-3 gap-4">
          <div className="h-24 bg-zinc-850 rounded-xl" />
          <div className="h-24 bg-zinc-850 rounded-xl" />
          <div className="h-24 bg-zinc-850 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl p-4 md:p-5 bg-gradient-to-b from-zinc-900/90 via-zinc-900/60 to-zinc-950/80 border border-zinc-800/90 shadow-xl">
      {/* Decorative subtle ambient glow */}
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-72 h-72 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
              AI Daily Briefing
            </h2>
            <span className="text-[11px] text-zinc-500">
              Updated {briefing ? new Date(briefing.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '8:00 AM'} MYT
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isLoading && (
            <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>Updating...</span>
            </span>
          )}

          <button
            onClick={handleSpeak}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
              isPlayingAudio
                ? 'bg-indigo-600 text-white animate-pulse'
                : 'bg-zinc-800/80 hover:bg-zinc-750 text-zinc-300 border border-zinc-700/60'
            }`}
            title="Read briefing aloud"
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>{isPlayingAudio ? 'Speaking...' : 'Listen'}</span>
          </button>

          <button
            onClick={() => setIsExpanded(prev => !prev)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-800/80 hover:bg-zinc-750 text-zinc-400 hover:text-zinc-200 border border-zinc-700/60 transition-all"
            title={isExpanded ? 'Collapse details' : 'Expand details'}
          >
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isExpanded ? 'Compact' : 'Expand'}</span>
          </button>
        </div>
      </div>

      {/* Headline */}
      <h3 className="text-base md:text-lg font-medium tracking-tight text-white mb-3 leading-snug">
        {briefing?.headline || 'Reviewing your day...'}
      </h3>

      {/* Compact Merged Top 3 Priorities */}
      {briefing?.topPriorities && briefing.topPriorities.length > 0 && (
        <div className="grid md:grid-cols-3 gap-2.5 mb-3">
          {briefing.topPriorities.slice(0, 3).map(p => (
            <div
              key={p.rank}
              className="flex items-start gap-2.5 p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800/80"
            >
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-[10px] font-bold text-indigo-300 shrink-0 mt-0.5">
                {p.rank}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-white truncate">{p.title}</span>
                  <span className="shrink-0" title={p.source}>{getSourceIcon(p.source)}</span>
                </div>
                <p className="text-[11px] text-zinc-400 line-clamp-1 mt-0.5">{p.reason}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Expandable 3 Pillars Overview Grid */}
      {isExpanded && (
        <div className="grid md:grid-cols-3 gap-3 mb-3">
          <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
              Today&apos;s Agenda
            </span>
            <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-line">
              {formatBulletText(briefing?.agendaSummary) || 'No scheduled calendar conflicts.'}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
              Email Intelligence
            </span>
            <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-line">
              {formatBulletText(briefing?.emailHighlights) || 'Priority correspondence reviewed.'}
            </p>
          </div>

          <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800/80">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1">
              Strategic Focus
            </span>
            <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-line">
              {briefing?.suggestedPreparation || 'Review obligations and focus on primary tasks.'}
            </p>
          </div>
        </div>
      )}

      {/* Overdue / Warning banner (if any) */}
      {briefing?.warningsOrOverdue && briefing.warningsOrOverdue.length > 0 && (
        <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
          <div>
            <span className="font-semibold">Attention: </span>
            {briefing.warningsOrOverdue.join(' • ')}
          </div>
        </div>
      )}
    </div>
  );
}
