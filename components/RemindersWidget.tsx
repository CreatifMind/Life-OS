'use client';

import React, { useState } from 'react';
import { CheckSquare, CheckCircle2, Circle, Plus, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { ReminderTask } from '@/lib/types';

type TaskFilter = 'all' | 'overdue' | 'today' | 'next7';

interface RemindersWidgetProps {
  reminders: ReminderTask[];
  isLoading: boolean;
  onToggleTask: (uid: string, nextStatus: boolean) => Promise<void>;
  onOpenNewTaskModal: () => void;
  onQuickAddTask?: (title: string) => Promise<void>;
  onSelectTask?: (task: ReminderTask) => void;
}

export function RemindersWidget({
  reminders,
  isLoading,
  onToggleTask,
  onOpenNewTaskModal,
  onQuickAddTask,
  onSelectTask,
}: RemindersWidgetProps) {
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<TaskFilter>('all');
  const [quickTitle, setQuickTitle] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [showCompleted, setShowCompleted] = useState(false);

  const handleToggle = async (uid: string, currentStatus: boolean) => {
    try {
      setTogglingId(uid);
      await onToggleTask(uid, !currentStatus);
    } finally {
      setTogglingId(null);
    }
  };

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = quickTitle.trim();
    if (!trimmed || !onQuickAddTask || isAdding) return;
    try {
      setIsAdding(true);
      await onQuickAddTask(trimmed);
      setQuickTitle('');
    } finally {
      setIsAdding(false);
    }
  };

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfToday = startOfToday + 24 * 60 * 60 * 1000;
  const endOfNext7 = startOfToday + 8 * 24 * 60 * 60 * 1000;

  const openReminders = reminders.filter(r => !r.isCompleted);
  const completedReminders = reminders.filter(r => r.isCompleted);

  const isOverdue = (r: ReminderTask) => {
    if (!r.dueDate) return false;
    const t = new Date(r.dueDate).getTime();
    return !isNaN(t) && t < now.getTime();
  };

  const isToday = (r: ReminderTask) => {
    if (!r.dueDate) return false;
    const t = new Date(r.dueDate).getTime();
    return !isNaN(t) && t >= startOfToday && t < endOfToday;
  };

  const isNext7 = (r: ReminderTask) => {
    if (!r.dueDate) return false;
    const t = new Date(r.dueDate).getTime();
    return !isNaN(t) && t >= startOfToday && t < endOfNext7;
  };

  const counts = {
    overdue: openReminders.filter(isOverdue).length,
    today: openReminders.filter(isToday).length,
    next7: openReminders.filter(isNext7).length,
    all: openReminders.length,
  };

  const filteredOpen = openReminders.filter(r => {
    if (filter === 'overdue') return isOverdue(r);
    if (filter === 'today') return isToday(r);
    if (filter === 'next7') return isNext7(r);
    return true;
  });

  const formatDueLabel = (dueDate: string) => {
    const d = new Date(dueDate);
    if (isNaN(d.getTime())) return '';
    const t = d.getTime();
    const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
    if (t >= startOfToday && t < endOfToday) {
      return `Today • ${timeStr}`;
    }
    if (t >= endOfToday && t < endOfToday + 24 * 60 * 60 * 1000) {
      return `Tomorrow • ${timeStr}`;
    }
    return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  };

  return (
    <div className="rounded-2xl p-5 bg-[#111114] border border-zinc-800/70 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-zinc-400" />
          <h3 className="text-sm font-medium text-white tracking-tight">
            Reminders
          </h3>
        </div>
        <button
          onClick={onOpenNewTaskModal}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/80 transition-colors"
          title="Add task with due date & notes"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Segmented Filter Pills */}
      <div className="flex items-center gap-1.5 mb-3 flex-wrap">
        {(
          [
            { id: 'all', label: 'All', count: counts.all },
            { id: 'overdue', label: 'Overdue', count: counts.overdue },
            { id: 'today', label: 'Today', count: counts.today },
            { id: 'next7', label: 'Next 7d', count: counts.next7 },
          ] as Array<{ id: TaskFilter; label: string; count: number }>
        ).map(tab => {
          const active = filter === tab.id;
          const isOverdueAlert = tab.id === 'overdue' && tab.count > 0 && !active;
          return (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                active
                  ? 'bg-white text-zinc-950'
                  : isOverdueAlert
                  ? 'bg-rose-500/10 text-rose-300 border border-rose-500/30 hover:bg-rose-500/20'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              {tab.label} <span className="opacity-70 ml-0.5">{tab.count}</span>
            </button>
          );
        })}
      </div>

      {/* Inline Quick-Add Bar */}
      {onQuickAddTask && (
        <form onSubmit={handleQuickAdd} className="flex items-center gap-2 mb-3">
          <input
            type="text"
            value={quickTitle}
            onChange={e => setQuickTitle(e.target.value)}
            placeholder="Add a reminder..."
            disabled={isAdding}
            className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-950/60 border border-zinc-800/70 focus:border-zinc-500 focus:outline-none text-xs text-white placeholder:text-zinc-600 transition-colors"
          />
          <button
            type="submit"
            disabled={!quickTitle.trim() || isAdding}
            className="px-3 py-1.5 rounded-lg bg-white hover:bg-zinc-200 disabled:opacity-30 text-zinc-950 text-xs font-medium transition-colors shrink-0"
          >
            {isAdding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Add'}
          </button>
        </form>
      )}

      {isLoading ? (
        <div className="space-y-3 py-4 animate-pulse">
          <div className="h-10 bg-zinc-950/60 rounded-lg" />
          <div className="h-10 bg-zinc-950/60 rounded-lg" />
        </div>
      ) : filteredOpen.length === 0 && completedReminders.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
          <div className="w-10 h-10 rounded-full bg-zinc-800/50 flex items-center justify-center text-zinc-500 mb-2.5">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <p className="text-xs font-medium text-zinc-300">
            {filter === 'all' ? 'All tasks completed' : `Nothing in ${filter === 'next7' ? 'next 7 days' : filter}`}
          </p>
          <p className="text-[11px] text-zinc-500 mt-0.5">
            {filter === 'all' ? 'Nothing pending in your reminders' : 'Switch to All to see other tasks'}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto overflow-x-hidden touch-pan-y overscroll-x-none max-h-[380px] pr-1">
          {filteredOpen.length === 0 ? (
            <p className="text-xs text-zinc-500 text-center py-6">
              No open tasks in this view.
            </p>
          ) : (
            <div className="divide-y divide-zinc-800/70">
              {filteredOpen.map(task => {
                const taskOverdue = isOverdue(task);
                return (
                  <div
                    key={task.id}
                    onClick={() => onSelectTask?.(task)}
                    className={`group flex items-start gap-3 py-3 px-2 rounded-lg hover:bg-zinc-800/30 transition-colors ${
                      onSelectTask ? 'cursor-pointer' : ''
                    }`}
                  >
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        handleToggle(task.uid, task.isCompleted);
                      }}
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
                      <div className="flex items-start gap-2 flex-wrap min-w-0">
                        <span className="text-xs font-medium text-white tracking-tight break-words whitespace-normal">
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
                            <span className={taskOverdue ? 'text-red-400 font-medium' : 'text-amber-400/80'}>
                              {taskOverdue ? `Overdue (${formatDueLabel(task.dueDate)})` : formatDueLabel(task.dueDate)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Completed Tasks section (collapsible) */}
          {completedReminders.length > 0 && (
            <div className="pt-3 mt-2 border-t border-zinc-800/60">
              <button
                onClick={() => setShowCompleted(prev => !prev)}
                className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 hover:text-zinc-300 mb-1.5 transition-colors"
              >
                {showCompleted ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                <span>Completed ({completedReminders.length})</span>
              </button>
              {showCompleted && (
                <div className="divide-y divide-zinc-800/50">
                  {completedReminders.map(task => (
                    <div
                      key={task.id}
                      className="group flex items-center justify-between gap-2.5 py-2 px-2 rounded-lg text-zinc-400 text-xs hover:bg-zinc-800/30 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          onClick={() => handleToggle(task.uid, task.isCompleted)}
                          disabled={togglingId === task.uid}
                          className="text-emerald-500/70 hover:text-amber-400 transition-colors shrink-0 disabled:opacity-50"
                          title="Click to mark incomplete / undo"
                        >
                          {togglingId === task.uid ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <span className="line-through text-zinc-500 break-words whitespace-normal">{task.title}</span>
                      </div>

                      <button
                        onClick={() => handleToggle(task.uid, task.isCompleted)}
                        disabled={togglingId === task.uid}
                        className="text-[10px] text-zinc-500 hover:text-zinc-300 font-medium px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 transition-colors shrink-0"
                      >
                        Undo
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
