'use client';

import React, { useState } from 'react';
import { Sparkles, Volume2, RefreshCw, AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { DailyBriefing } from '@/lib/types';

interface DailyBriefingCardProps {
  briefing: DailyBriefing | null;
  isLoading: boolean;
}

export function DailyBriefingCard({ briefing, isLoading }: DailyBriefingCardProps) {
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

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
    <div className="relative overflow-hidden rounded-2xl p-6 md:p-7 bg-gradient-to-b from-zinc-900/90 via-zinc-900/60 to-zinc-950/80 border border-zinc-800/90 shadow-2xl">
      {/* Decorative subtle ambient glow */}
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-80 h-80 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
              AI Daily Briefing
            </h2>
            <span className="text-[11px] text-zinc-500">
              Generated at {briefing ? new Date(briefing.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '8:00 AM'} MYT
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

          {/* Audio briefing readout */}
          <button
            onClick={handleSpeak}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              isPlayingAudio
                ? 'bg-indigo-600 text-white animate-pulse'
                : 'bg-zinc-800/80 hover:bg-zinc-750 text-zinc-300 border border-zinc-700/60'
            }`}
            title="Read briefing aloud"
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>{isPlayingAudio ? 'Speaking...' : 'Listen'}</span>
          </button>
        </div>
      </div>

      {/* Headline */}
      <h3 className="text-lg md:text-xl font-medium tracking-tight text-white mb-5 leading-snug">
        {briefing?.headline || 'Reviewing your day...'}
      </h3>

      {/* 3 Pillars Overview Grid */}
      <div className="grid md:grid-cols-3 gap-4 mb-5">
        {/* Agenda overview */}
        <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800/80 flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1.5">
              Today's Agenda
            </span>
            <p className="text-xs text-zinc-300 leading-relaxed">
              {briefing?.agendaSummary || 'No scheduled calendar conflicts.'}
            </p>
          </div>
        </div>

        {/* Priority emails */}
        <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800/80 flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1.5">
              Email Intelligence
            </span>
            <p className="text-xs text-zinc-300 leading-relaxed">
              {briefing?.emailHighlights || 'Priority correspondence reviewed.'}
            </p>
          </div>
        </div>

        {/* Suggested Preparation */}
        <div className="p-4 rounded-xl bg-zinc-950/60 border border-zinc-800/80 flex flex-col justify-between">
          <div>
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1.5">
              Strategic Focus
            </span>
            <p className="text-xs text-zinc-300 leading-relaxed">
              {briefing?.suggestedPreparation || 'Review obligations and focus on primary tasks.'}
            </p>
          </div>
        </div>
      </div>

      {/* Overdue / Warning banner (if any) */}
      {briefing?.warningsOrOverdue && briefing.warningsOrOverdue.length > 0 && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
          <div>
            <span className="font-semibold">Attention: </span>
            {briefing.warningsOrOverdue.join(' • ')}
          </div>
        </div>
      )}
    </div>
  );
}
