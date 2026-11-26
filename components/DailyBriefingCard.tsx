'use client';

import React, { useState, useEffect } from 'react';
import { Sparkles, Volume2, RefreshCw, AlertTriangle, ChevronDown, ChevronUp, Calendar, CheckSquare, Mail, Target } from 'lucide-react';
import { DailyBriefing } from '@/lib/types';
import { getClientTimeZoneInfo } from '@/lib/client';

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
  const [tzLabel, setTzLabel] = useState('MYT');

  useEffect(() => {
    setTzLabel(getClientTimeZoneInfo().tzLabel);
  }, []);

  const getSourceIcon = (source: string) => {
    switch (source) {
      case 'CALENDAR':
        return <Calendar className="w-3 h-3 text-zinc-400" />;
      case 'REMINDER':
        return <CheckSquare className="w-3 h-3 text-zinc-400" />;
      case 'GMAIL':
        return <Mail className="w-3 h-3 text-zinc-400" />;
      default:
        return <Target className="w-3 h-3 text-zinc-400" />;
    }
  };

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleSpeak = () => {
    if (!briefing || !window.speechSynthesis) return;

    if (isPlayingAudio) {
      window.speechSynthesis.cancel();
      setIsPlayingAudio(false);
      return;
    }

    const cleanForSpeech = (s?: string) => (s || '').replace(/[•\-*]+/g, ' ').replace(/\s+/g, ' ').trim();
    const textToRead = `${cleanForSpeech(briefing.headline)}. Here are your priorities for today: ${briefing.topPriorities
      .map(p => `Priority ${p.rank}: ${cleanForSpeech(p.title)}. ${cleanForSpeech(p.reason)}`)
      .join(' ')}. Schedule: ${cleanForSpeech(briefing.agendaSummary)}. Communication: ${cleanForSpeech(briefing.emailHighlights)}`;

    const utterance = new SpeechSynthesisUtterance(textToRead);
    utterance.rate = 1.05;
    utterance.onend = () => setIsPlayingAudio(false);
    utterance.onerror = () => setIsPlayingAudio(false);

    setIsPlayingAudio(true);
    window.speechSynthesis.speak(utterance);
  };

  if (!briefing && isLoading) {
    return (
      <div className="rounded-2xl p-5 bg-[#111114] border border-zinc-800/70 animate-pulse">
        <div className="h-4 bg-zinc-800/80 rounded w-1/4 mb-3" />
        <div className="h-6 bg-zinc-800/80 rounded w-2/3 mb-4" />
        <div className="grid md:grid-cols-3 gap-4">
          <div className="h-16 bg-zinc-900/80 rounded-lg" />
          <div className="h-16 bg-zinc-900/80 rounded-lg" />
          <div className="h-16 bg-zinc-900/80 rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-5 bg-[#111114] border border-zinc-800/70">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-zinc-300" />
          <h2 className="text-sm font-medium text-white tracking-tight">Daily Briefing</h2>
          <span className="text-xs text-zinc-500">
            · {briefing ? new Date(briefing.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '8:00 AM'} {tzLabel}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {isLoading && (
            <span className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium text-zinc-300 bg-zinc-900 border border-zinc-800">
              <RefreshCw className="w-3 h-3 animate-spin" />
              <span>Updating</span>
            </span>
          )}

          <button
            onClick={handleSpeak}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              isPlayingAudio
                ? 'bg-white text-zinc-950'
                : 'text-zinc-400 hover:text-white hover:bg-zinc-800/70'
            }`}
            title="Read briefing aloud"
          >
            <Volume2 className="w-3.5 h-3.5" />
            <span>{isPlayingAudio ? 'Speaking' : 'Listen'}</span>
          </button>

          <button
            onClick={() => setIsExpanded(prev => !prev)}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-zinc-400 hover:text-white hover:bg-zinc-800/70 transition-colors"
            title={isExpanded ? 'Collapse details' : 'Expand details'}
          >
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{isExpanded ? 'Compact' : 'Expand'}</span>
          </button>
        </div>
      </div>

      {/* Headline */}
      <h3 className="text-base md:text-lg font-medium tracking-tight text-white mb-4 leading-snug">
        {briefing?.headline || 'Reviewing your day...'}
      </h3>

      {/* Top 3 Priorities — clean hairline-separated strip */}
      {briefing?.topPriorities && briefing.topPriorities.length > 0 && (
        <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-zinc-800/70 border-t border-zinc-800/70 pt-3.5 mb-3.5">
          {briefing.topPriorities.slice(0, 3).map((p, idx) => (
            <div
              key={`${p.rank}-${idx}`}
              className={`flex items-start gap-2.5 py-2 md:py-0 ${
                idx === 0 ? 'md:pr-4' : idx === 1 ? 'md:px-4' : 'md:pl-4'
              }`}
            >
              <span className="text-[11px] font-mono text-zinc-500 mt-0.5 shrink-0">
                0{p.rank}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-medium text-zinc-100 truncate">{p.title}</span>
                  <span className="shrink-0" title={p.source}>{getSourceIcon(p.source)}</span>
                </div>
                <p className="text-[11px] text-zinc-500 line-clamp-1 mt-0.5">{p.reason}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Expandable 3 Pillars — clean hairline-separated columns */}
      {isExpanded && (
        <div className="grid md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-zinc-800/70 border-t border-zinc-800/70 pt-3.5">
          <div className="py-2.5 md:py-0 md:pr-4">
            <span className="text-[11px] font-medium text-zinc-500 block mb-1.5">
              Agenda
            </span>
            <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-line">
              {formatBulletText(briefing?.agendaSummary) || 'No scheduled calendar conflicts.'}
            </p>
          </div>

          <div className="py-2.5 md:py-0 md:px-4">
            <span className="text-[11px] font-medium text-zinc-500 block mb-1.5">
              Inbox
            </span>
            <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-line">
              {formatBulletText(briefing?.emailHighlights) || 'Priority correspondence reviewed.'}
            </p>
          </div>

          <div className="py-2.5 md:py-0 md:pl-4">
            <span className="text-[11px] font-medium text-zinc-500 block mb-1.5">
              Focus
            </span>
            <p className="text-xs text-zinc-200 leading-relaxed whitespace-pre-line">
              {briefing?.suggestedPreparation || 'Review obligations and focus on primary tasks.'}
            </p>
          </div>
        </div>
      )}

      {/* Overdue / Warning banner (if any) */}
      {briefing?.warningsOrOverdue && briefing.warningsOrOverdue.length > 0 && (
        <div className="mt-3.5 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
          <div>
            <span className="font-medium">Attention: </span>
            {briefing.warningsOrOverdue.join(' · ')}
          </div>
        </div>
      )}
    </div>
  );
}
