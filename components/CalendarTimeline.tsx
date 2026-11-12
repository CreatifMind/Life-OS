'use client';

import React, { useState } from 'react';
import { Calendar as CalendarIcon, Clock, MapPin, CalendarDays, Sparkles, Layers } from 'lucide-react';
import { CalendarEvent } from '@/lib/types';

interface CalendarTimelineProps {
  events: CalendarEvent[];
  isLoading: boolean;
}

interface ExpandedTimelineItem {
  instanceId: string;
  originalEvent: CalendarEvent;
  instanceDate: Date;
  dateKey: string;
  isMultiDay: boolean;
  multiDayDayNumber?: number;
  totalDays?: number;
  dateRangeLabel?: string;
}

export function CalendarTimeline({ events, isLoading }: CalendarTimelineProps) {
  const [showPast, setShowPast] = useState(false);

  const formatTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
      return '';
    }
  };

  const getCalendarColor = (calName: string) => {
    const lower = calName.toLowerCase();
    if (lower.includes('work')) return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
    if (lower.includes('personal')) return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
    if (lower.includes('howbout')) return 'border-purple-500/40 bg-purple-500/10 text-purple-300';
    return 'border-blue-500/40 bg-blue-500/10 text-blue-300';
  };

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  // Helper to expand multi-day events across all relevant days
  const expandedItems: ExpandedTimelineItem[] = [];

  for (const event of events) {
    const start = new Date(event.startTime);
    let end = new Date(event.endTime || event.startTime);

    // Normalize start/end to midnight for day comparison
    const startMidnight = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    let endMidnight = new Date(end.getFullYear(), end.getMonth(), end.getDate());

    // In iCalendar, an all-day event DTEND is exclusive.
    // e.g. 2026-11-16 to 2026-11-18 means 16th and 17th.
    if (event.isAllDay && end.getTime() > start.getTime()) {
      endMidnight = new Date(endMidnight.getTime() - 1000 * 60 * 60 * 24);
    }

    const diffDays = Math.max(
      1,
      Math.round((endMidnight.getTime() - startMidnight.getTime()) / (1000 * 60 * 60 * 24)) + 1
    );

    const isMultiDay = diffDays > 1;
    const dateRangeLabel = isMultiDay
      ? `${start.toLocaleDateString([], { day: 'numeric', month: 'short' })} – ${endMidnight.toLocaleDateString([], {
          day: 'numeric',
          month: 'short',
        })} (${diffDays} Days)`
      : undefined;

    // Generate entry for each day the event spans
    for (let dayOffset = 0; dayOffset < diffDays; dayOffset++) {
      const currentDay = new Date(startMidnight.getTime() + dayOffset * 24 * 60 * 60 * 1000);
      const dateKey = currentDay.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

      expandedItems.push({
        instanceId: `${event.id}-day-${dayOffset}`,
        originalEvent: event,
        instanceDate: currentDay,
        dateKey,
        isMultiDay,
        multiDayDayNumber: dayOffset + 1,
        totalDays: diffDays,
        dateRangeLabel,
      });
    }
  }

  // Filter into Upcoming (today onwards) vs Past
  const futureOrTodayItems = expandedItems.filter(item => item.instanceDate.getTime() >= startOfToday);
  const pastItems = expandedItems.filter(item => item.instanceDate.getTime() < startOfToday);

  const displayList = showPast ? pastItems : futureOrTodayItems;

  // Group by dateKey
  const grouped = displayList.reduce((acc, item) => {
    if (!acc[item.dateKey]) {
      const targetTime = item.instanceDate.getTime();
      let label = item.dateKey;
      if (targetTime === startOfToday) label = 'Today';
      else if (targetTime === startOfToday + 24 * 60 * 60 * 1000) label = 'Tomorrow';

      acc[item.dateKey] = {
        label,
        dateStr: item.dateKey,
        items: [],
      };
    }
    acc[item.dateKey].items.push(item);
    return acc;
  }, {} as Record<string, { label: string; dateStr: string; items: ExpandedTimelineItem[] }>);

  return (
    <div className="rounded-2xl p-5 md:p-6 bg-zinc-900/60 border border-zinc-800/80 shadow-lg flex flex-col h-full">
      {/* Header bar with Tab Toggle */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <CalendarIcon className="w-4 h-4 text-blue-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Calendar Schedule
          </h3>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className="flex items-center p-0.5 rounded-lg bg-zinc-950 border border-zinc-800 text-[11px]">
            <button
              onClick={() => setShowPast(false)}
              className={`px-2 py-0.5 rounded-md font-medium transition-all ${
                !showPast ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Upcoming ({futureOrTodayItems.length})
            </button>
            <button
              onClick={() => setShowPast(true)}
              className={`px-2 py-0.5 rounded-md font-medium transition-all ${
                showPast ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              Past ({pastItems.length})
            </button>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3 py-4 animate-pulse">
          <div className="h-16 bg-zinc-950/60 rounded-xl" />
          <div className="h-16 bg-zinc-950/60 rounded-xl" />
        </div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
          <div className="w-10 h-10 rounded-full bg-zinc-800/50 flex items-center justify-center text-zinc-500 mb-2.5">
            <CalendarDays className="w-5 h-5" />
          </div>
          <p className="text-xs font-medium text-zinc-300">
            {showPast ? 'No past events in view' : 'No upcoming events'}
          </p>
          <p className="text-[11px] text-zinc-500 max-w-[200px] mt-0.5">
            {showPast ? 'Past events older than 14 days are archived.' : 'Your schedule is clear.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4 flex-1 overflow-y-auto max-h-[420px] pr-1">
          {Object.entries(grouped).map(([dateKey, group]) => {
            const isTodayGroup = group.label === 'Today';
            const isTomorrowGroup = group.label === 'Tomorrow';

            return (
              <div key={dateKey} className="space-y-2">
                {/* Date Header Pill */}
                <div className="flex items-center gap-2 pt-1">
                  <div
                    className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-semibold tracking-wider uppercase ${
                      isTodayGroup
                        ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 shadow-sm'
                        : isTomorrowGroup
                        ? 'bg-blue-500/15 text-blue-300 border border-blue-500/30'
                        : 'bg-zinc-800/80 text-zinc-400 border border-zinc-700/50'
                    }`}
                  >
                    {isTodayGroup && <Sparkles className="w-3 h-3 text-indigo-400" />}
                    <span>{group.label}</span>
                    <span className="text-zinc-500 font-normal">• {group.dateStr}</span>
                  </div>
                  <div className="flex-1 h-px bg-zinc-800/60" />
                </div>

                {/* Events list for this day */}
                <div className="space-y-2">
                  {group.items.map(item => {
                    const event = item.originalEvent;
                    return (
                      <div
                        key={item.instanceId}
                        className={`p-3.5 rounded-xl border transition-all ${
                          isTodayGroup
                            ? 'bg-gradient-to-r from-zinc-950 via-zinc-900/90 to-zinc-950 border-indigo-500/40 shadow-md shadow-indigo-500/5'
                            : 'bg-zinc-950/70 border-zinc-800/80 hover:border-zinc-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-sm font-medium text-white tracking-tight leading-snug">
                              {event.title}
                            </h4>
                            {item.isMultiDay && (
                              <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 uppercase tracking-wider">
                                <Layers className="w-2.5 h-2.5" />
                                Day {item.multiDayDayNumber} of {item.totalDays}
                              </span>
                            )}
                          </div>
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border uppercase tracking-wider shrink-0 ${getCalendarColor(
                              event.calendarName
                            )}`}
                          >
                            {event.calendarName}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 text-xs text-zinc-400 flex-wrap">
                          <div className="flex items-center gap-1 font-mono text-[11px]">
                            <Clock className="w-3.5 h-3.5 text-zinc-500" />
                            <span>
                              {event.isAllDay
                                ? item.dateRangeLabel || 'All Day'
                                : `${formatTime(event.startTime)} – ${formatTime(event.endTime)}`}
                            </span>
                          </div>

                          {event.location && (
                            <div className="flex items-center gap-1 text-[11px] text-zinc-400">
                              <MapPin className="w-3 h-3 text-zinc-500" />
                              <span className="truncate max-w-[150px]">{event.location}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
