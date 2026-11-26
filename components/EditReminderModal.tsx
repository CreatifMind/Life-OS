'use client';

import React, { useState, useEffect } from 'react';
import { X, CheckSquare, Loader2, CheckCircle2 } from 'lucide-react';
import { ReminderTask } from '@/lib/types';
import {
  getClientTimeZoneInfo,
  toLocalDateInput,
  toLocalIsoWithOffset,
  toLocalTimeInput,
} from '@/lib/client';

interface EditReminderModalProps {
  reminder: ReminderTask | null;
  onClose: () => void;
  onSave: (
    oldReminder: ReminderTask,
    updates: {
      title: string;
      dueDate?: string;
      clearDueDate?: boolean;
      notes?: string;
      clearNotes?: boolean;
    }
  ) => Promise<void>;
  onMarkComplete: (uid: string) => Promise<void>;
}

export function EditReminderModal({
  reminder,
  onClose,
  onSave,
  onMarkComplete,
}: EditReminderModalProps) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [notes, setNotes] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [tzLabel, setTzLabel] = useState('MYT');

  useEffect(() => {
    setTzLabel(getClientTimeZoneInfo().tzLabel);
  }, []);

  useEffect(() => {
    if (!reminder) return;
    setTitle(reminder.title);
    setDueDate(toLocalDateInput(reminder.dueDate));
    setDueTime(toLocalTimeInput(reminder.dueDate));
    setNotes(reminder.notes || '');
    setError('');
  }, [reminder]);

  useEffect(() => {
    if (!reminder) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [reminder, onClose]);

  if (!reminder) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || isSaving) return;

    setIsSaving(true);
    setError('');
    try {
      let isoDue: string | undefined;
      if (dueDate) {
        const timePart = dueTime || '09:00';
        isoDue = toLocalIsoWithOffset(dueDate, timePart);
      }
      const hadDueDate = Boolean(reminder.dueDate);
      const clearDueDate = hadDueDate && !dueDate;
      const hadNotes = Boolean(reminder.notes?.trim());
      const clearNotes = hadNotes && !notes.trim();

      await onSave(reminder, {
        title: title.trim(),
        dueDate: isoDue,
        clearDueDate,
        notes: notes.trim() || undefined,
        clearNotes,
      });
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to update reminder');
    } finally {
      setIsSaving(false);
    }
  };

  const handleComplete = async () => {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await onMarkComplete(reminder.uid);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to complete reminder');
      setIsSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-[#111114] border border-zinc-800/90 shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-zinc-800/80 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckSquare className="w-4 h-4 text-zinc-400" />
            <h3 className="text-sm font-medium text-white">Edit Reminder</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Title</label>
            <input
              type="text"
              required
              autoFocus
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm text-white focus:outline-none focus:border-zinc-500 transition-colors"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-medium text-zinc-400">Due Date</label>
                {dueDate && (
                  <button
                    type="button"
                    onClick={() => {
                      setDueDate('');
                      setDueTime('');
                    }}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300"
                  >
                    Clear
                  </button>
                )}
              </div>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white focus:outline-none focus:border-zinc-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                Time ({tzLabel})
              </label>
              <input
                type="time"
                value={dueTime}
                disabled={!dueDate}
                onChange={e => setDueTime(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white focus:outline-none focus:border-zinc-500 disabled:opacity-40 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Optional notes..."
              className="w-full px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500 transition-colors resize-none"
            />
          </div>

          {error && (
            <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-800/70">
            <button
              type="button"
              onClick={handleComplete}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Mark Done</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/70 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving || !title.trim()}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-white hover:bg-zinc-200 text-zinc-950 disabled:opacity-40 transition-colors"
              >
                {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isSaving ? 'Saving...' : 'Save'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
