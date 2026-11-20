'use client';

import React, { useState, useEffect } from 'react';
import { X, Calendar, MapPin, Loader2 } from 'lucide-react';

interface NewEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    title: string;
    startTime: string;
    endTime: string;
    isAllDay: boolean;
    location?: string;
    calendarName?: string;
  }) => Promise<void>;
  availableCalendars?: string[];
}

export function NewEventModal({
  isOpen,
  onClose,
  onSubmit,
  availableCalendars = [],
}: NewEventModalProps) {
  const todayIso = new Date().toISOString().split('T')[0];
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayIso);
  const [startHour, setStartHour] = useState('09:00');
  const [endHour, setEndHour] = useState('10:00');
  const [isAllDay, setIsAllDay] = useState(false);
  const [location, setLocation] = useState('');
  const [calendarName, setCalendarName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDate(new Date().toISOString().split('T')[0]);
      setStartHour('09:00');
      setEndHour('10:00');
      setIsAllDay(false);
      setLocation('');
      setError('');
      if (availableCalendars.length > 0 && !calendarName) {
        setCalendarName(availableCalendars[0]);
      }
    }
  }, [isOpen, availableCalendars, calendarName]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isSubmitting) return;

    setIsSubmitting(true);
    setError('');

    try {
      const startIso = isAllDay
        ? `${date}T00:00:00+08:00`
        : `${date}T${startHour}:00+08:00`;
      const endIso = isAllDay
        ? `${date}T23:59:00+08:00`
        : `${date}T${endHour}:00+08:00`;

      await onSubmit({
        title: title.trim(),
        startTime: startIso,
        endTime: endIso,
        isAllDay,
        location: location.trim() || undefined,
        calendarName: calendarName || undefined,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not create calendar event');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl bg-zinc-950 border border-zinc-800 shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-white">New Apple Calendar Event</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
              Event Title
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Client Call / Deep Work"
              autoFocus
              required
              className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 focus:border-indigo-500 focus:outline-none text-sm text-white placeholder:text-zinc-600"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                required
                className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 focus:border-indigo-500 focus:outline-none text-xs text-white"
              />
            </div>

            {availableCalendars.length > 0 && (
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                  Calendar
                </label>
                <select
                  value={calendarName}
                  onChange={e => setCalendarName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 focus:border-indigo-500 focus:outline-none text-xs text-white"
                >
                  {availableCalendars.map(cal => (
                    <option key={cal} value={cal}>
                      {cal}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isAllDay}
              onChange={e => setIsAllDay(e.target.checked)}
              className="rounded border-zinc-700 bg-zinc-900 text-indigo-600 focus:ring-indigo-500"
            />
            <span>All-day event</span>
          </label>

          {!isAllDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                  Start (MYT)
                </label>
                <input
                  type="time"
                  value={startHour}
                  onChange={e => setStartHour(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 focus:border-indigo-500 focus:outline-none text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
                  End (MYT)
                </label>
                <input
                  type="time"
                  value={endHour}
                  onChange={e => setEndHour(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 focus:border-indigo-500 focus:outline-none text-xs text-white"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-zinc-400 mb-1.5">
              Location (optional)
            </label>
            <div className="relative">
              <MapPin className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="Zoom / Office / Venue"
                className="w-full pl-8 pr-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 focus:border-indigo-500 focus:outline-none text-xs text-white placeholder:text-zinc-600"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || isSubmitting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-medium transition-colors"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isSubmitting ? 'Saving...' : 'Add to Calendar'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
