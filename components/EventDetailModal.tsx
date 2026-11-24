'use client';

import React, { useState, useEffect } from 'react';
import { X, Calendar, Clock, MapPin, Trash2, Pencil, Loader2, AlignLeft } from 'lucide-react';
import { CalendarEvent } from '@/lib/types';

function toMytDateInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function toMytTimeInput(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '09:00';
  return d.toLocaleTimeString('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

interface EventDetailModalProps {
  event: CalendarEvent | null;
  availableCalendars?: string[];
  onClose: () => void;
  onUpdate: (oldEvent: CalendarEvent, updatedPayload: {
    title: string;
    startTime: string;
    endTime: string;
    isAllDay: boolean;
    location?: string;
    description?: string;
    calendarName?: string;
  }) => Promise<void>;
  onDelete: (event: CalendarEvent) => Promise<void>;
}

export function EventDetailModal({
  event,
  availableCalendars = [],
  onClose,
  onUpdate,
  onDelete,
}: EventDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [startHour, setStartHour] = useState('09:00');
  const [endHour, setEndHour] = useState('10:00');
  const [isAllDay, setIsAllDay] = useState(false);
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [calendarName, setCalendarName] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!event) return;
    setIsEditing(false);
    setConfirmDelete(false);
    setError('');
    setTitle(event.title);
    setDate(toMytDateInput(event.startTime));
    setStartHour(toMytTimeInput(event.startTime));
    setEndHour(toMytTimeInput(event.endTime || event.startTime));
    setIsAllDay(Boolean(event.isAllDay));
    setLocation(event.location || '');
    setDescription(event.description || '');
    setCalendarName(event.calendarName || availableCalendars[0] || '');
  }, [event, availableCalendars]);

  useEffect(() => {
    if (!event) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [event, onClose]);

  if (!event) return null;

  const isReadOnlyCal = /holiday|birthday|siri/i.test(event.calendarName || '');

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isBusy) return;
    if (!isAllDay && endHour <= startHour) {
      setError('End time must be after start time.');
      return;
    }

    setIsBusy(true);
    setError('');
    try {
      const startIso = isAllDay
        ? `${date}T00:00:00+08:00`
        : `${date}T${startHour}:00+08:00`;
      const endIso = isAllDay
        ? `${date}T23:59:00+08:00`
        : `${date}T${endHour}:00+08:00`;

      await onUpdate(event, {
        title: title.trim(),
        startTime: startIso,
        endTime: endIso,
        isAllDay,
        location: location.trim() || undefined,
        description: description.trim() || undefined,
        calendarName: calendarName || event.calendarName,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to update event');
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setError('');
    try {
      await onDelete(event);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to delete event');
      setIsBusy(false);
    }
  };

  const formatDisplayRange = () => {
    const startD = new Date(event.startTime);
    const endD = new Date(event.endTime || event.startTime);
    const dateLabel = startD.toLocaleDateString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      weekday: 'long',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
    if (event.isAllDay) return `${dateLabel} · All Day`;
    const sTime = startD.toLocaleTimeString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    const eTime = endD.toLocaleTimeString('en-MY', {
      timeZone: 'Asia/Kuala_Lumpur',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    return `${dateLabel} · ${sTime} – ${eTime}`;
  };

  const calList = Array.from(
    new Set([event.calendarName, ...availableCalendars].filter(Boolean))
  ).filter(c => !/holiday|birthday|siri/i.test(c));

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-[#111114] border border-zinc-800/90 shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-zinc-800/80 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Calendar className="w-4 h-4 text-zinc-400 shrink-0" />
            <h3 className="text-sm font-medium text-white truncate">
              {isEditing ? 'Edit Event' : event.title}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors shrink-0"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!isEditing ? (
          <div className="p-5 space-y-4">
            <div className="space-y-2.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-800 text-[10px] font-medium text-zinc-300 uppercase tracking-wider">
                  {event.calendarName}
                </span>
              </div>

              <div className="flex items-start gap-2 text-zinc-300">
                <Clock className="w-3.5 h-3.5 text-zinc-500 mt-0.5 shrink-0" />
                <span>{formatDisplayRange()}</span>
              </div>

              {event.location && (
                <div className="flex items-start gap-2 text-zinc-300">
                  <MapPin className="w-3.5 h-3.5 text-zinc-500 mt-0.5 shrink-0" />
                  <span className="break-words">{event.location}</span>
                </div>
              )}

              {event.description && (
                <div className="flex items-start gap-2 text-zinc-400 pt-1">
                  <AlignLeft className="w-3.5 h-3.5 text-zinc-500 mt-0.5 shrink-0" />
                  <p className="whitespace-pre-wrap break-words leading-relaxed">{event.description}</p>
                </div>
              )}
            </div>

            {error && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            {!isReadOnlyCal && (
              <div className="flex items-center justify-between gap-2 pt-3 border-t border-zinc-800/70">
                {!confirmDelete ? (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    disabled={isBusy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-rose-400 hover:bg-rose-500/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={handleDelete}
                      disabled={isBusy}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium transition-colors disabled:opacity-50"
                    >
                      {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                      <span>Confirm Delete</span>
                    </button>
                    <button
                      onClick={() => setConfirmDelete(false)}
                      className="px-2 py-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 text-xs"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                <button
                  onClick={() => setIsEditing(true)}
                  disabled={isBusy}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-zinc-950 text-xs font-medium transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSave} className="p-5 space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                autoFocus
                className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-zinc-500 focus:outline-none text-sm text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  required
                  className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-zinc-500 focus:outline-none text-xs text-white"
                />
              </div>
              {calList.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Calendar</label>
                  <select
                    value={calendarName}
                    onChange={e => setCalendarName(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-zinc-500 focus:outline-none text-xs text-white"
                  >
                    {calList.map(c => (
                      <option key={c} value={c}>
                        {c}
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
                onChange={e => {
                  setIsAllDay(e.target.checked);
                  if (e.target.checked) setError('');
                }}
                className="rounded border-zinc-700 bg-zinc-950 text-white"
              />
              <span>All-day event</span>
            </label>

            {!isAllDay && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">Start (MYT)</label>
                  <input
                    type="time"
                    value={startHour}
                    onChange={e => {
                      setStartHour(e.target.value);
                      setError('');
                    }}
                    required
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-zinc-500 focus:outline-none text-xs text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">End (MYT)</label>
                  <input
                    type="time"
                    value={endHour}
                    onChange={e => {
                      setEndHour(e.target.value);
                      setError('');
                    }}
                    required
                    className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-zinc-500 focus:outline-none text-xs text-white"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Location</label>
              <input
                type="text"
                value={location}
                onChange={e => setLocation(e.target.value)}
                placeholder="Optional"
                className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-zinc-500 focus:outline-none text-xs text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Notes</label>
              <textarea
                rows={2}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Optional"
                className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-zinc-500 focus:outline-none text-xs text-white resize-none"
              />
            </div>

            {error && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsEditing(false)}
                className="px-3.5 py-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/70 text-xs font-medium"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={!title.trim() || isBusy}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-white hover:bg-zinc-200 disabled:opacity-40 text-zinc-950 text-xs font-medium transition-colors"
              >
                {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isBusy ? 'Saving...' : 'Save Changes'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
