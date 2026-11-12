'use client';

import React, { useState } from 'react';
import { CheckSquare, CheckCircle2, Circle, Plus, AlertCircle, Loader2 } from 'lucide-react';
import { ReminderTask } from '@/lib/types';

interface RemindersWidgetProps {
  reminders: ReminderTask[];
  isLoading: boolean;
  onToggleTask: (uid: string, nextStatus: boolean) => Promise<void>;
  onOpenNewTaskModal: () => void;
}

export function RemindersWidget({
  reminders,
  isLoading,
  onToggleTask,
  onOpenNewTaskModal,
}: RemindersWidgetProps) {
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const handleToggle = async (uid: string, currentStatus: boolean) => {
    try {
      setTogglingId(uid);
      await onToggleTask(uid, !currentStatus);
    } finally {
      setTogglingId(null);
    }
  };

  const openReminders = reminders.filter(r => !r.isCompleted);
  const completedReminders = reminders.filter(r => r.isCompleted);

  return (
    <div className="rounded-2xl p-5 md:p-6 bg-zinc-900/60 border border-zinc-800/80 shadow-lg flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-amber-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Apple Reminders
          </h3>
        </div>
        <button
          onClick={onOpenNewTaskModal}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium border border-zinc-700/60 transition-all active:scale-95"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Task</span>
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-3 py-4 animate-pulse">
          <div className="h-12 bg-zinc-950/60 rounded-xl" />
          <div className="h-12 bg-zinc-950/60 rounded-xl" />
        </div>
      ) : reminders.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
          <div className="w-10 h-10 rounded-full bg-zinc-800/50 flex items-center justify-center text-zinc-500 mb-2.5">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <p className="text-xs font-medium text-zinc-300">All tasks completed</p>
          <p className="text-[11px] text-zinc-500 mt-0.5">Nothing pending in your reminders</p>
        </div>
      ) : (
        <div className="space-y-2.5 flex-1 overflow-y-auto max-h-[380px] pr-1">
          {openReminders.map(task => (
            <div
              key={task.id}
              className="group flex items-start gap-3 p-3 rounded-xl bg-zinc-950/70 border border-zinc-800/80 hover:border-zinc-700 transition-all"
            >
              <button
                onClick={() => handleToggle(task.uid, task.isCompleted)}
                disabled={togglingId === task.uid}
                className="mt-0.5 text-zinc-500 hover:text-amber-400 transition-colors shrink-0 disabled:opacity-50"
              >
                {togglingId === task.uid ? (
                  <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                ) : (
                  <Circle className="w-4 h-4" />
                )}
              </button>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-medium text-white tracking-tight">
                    {task.title}
                  </span>
                  {task.priority === 1 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30 uppercase tracking-wider">
                      High
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-1 text-[11px] text-zinc-500">
                  <span>{task.listName}</span>
                  {task.dueDate && (
                    <>
                      <span>•</span>
                      <span className="text-amber-400/80">
                        Due {new Date(task.dueDate).toLocaleDateString()}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Completed Tasks section */}
          {completedReminders.length > 0 && (
            <div className="pt-3 border-t border-zinc-800/50">
              <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block mb-2">
                Completed ({completedReminders.length})
              </span>
              <div className="space-y-1.5">
                {completedReminders.map(task => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2.5 p-2 rounded-lg bg-zinc-950/40 text-zinc-500 text-xs"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500/70" />
                    <span className="line-through">{task.title}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
