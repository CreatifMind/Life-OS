'use client';

import React from 'react';
import { Mail, CheckSquare, Inbox, Plus, X } from 'lucide-react';
import { EmailThread } from '@/lib/types';

interface GmailTriageWidgetProps {
  emails: EmailThread[];
  isLoading: boolean;
  onConvertToTask: (email: EmailThread) => void;
  onDisconnectAccount?: (email: string) => void;
  health?: { status: string; message?: string; accounts?: string[] };
}

export function GmailTriageWidget({
  emails,
  isLoading,
  onConvertToTask,
  onDisconnectAccount,
  health,
}: GmailTriageWidgetProps) {
  const isError = health?.status === 'ERROR';
  const accounts = health?.accounts || [];

  return (
    <div className="rounded-2xl p-5 md:p-6 bg-zinc-900/60 border border-zinc-800/80 shadow-lg flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-red-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Priority Gmail Triage
          </h3>
        </div>
        <div className="flex items-center gap-2.5">
          <a
            href="/api/auth/google/url"
            className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700/60 text-zinc-300 hover:text-white text-[10px] font-medium transition-colors"
            title="Connect another Gmail account"
          >
            <Plus className="w-3 h-3" />
            <span>Add Account</span>
          </a>
          <span className="text-[11px] text-zinc-500 font-mono">
            {emails.length} UNREAD
          </span>
        </div>
      </div>

      {accounts.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {accounts.map(acc => (
            <span
              key={acc}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-zinc-950/80 border border-zinc-800 text-[10px] text-zinc-400"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />
              <span className="truncate max-w-[160px]">{acc}</span>
              {onDisconnectAccount && accounts.length > 1 && (
                <button
                  onClick={() => onDisconnectAccount(acc)}
                  className="ml-0.5 text-zinc-500 hover:text-red-400 transition-colors"
                  title={`Disconnect ${acc}`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3 py-4 animate-pulse">
          <div className="h-16 bg-zinc-950/60 rounded-xl" />
          <div className="h-16 bg-zinc-950/60 rounded-xl" />
        </div>
      ) : isError ? (
        <div className="flex-1 flex flex-col items-center justify-center py-6 px-3 text-center">
          <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-3">
            <Mail className="w-5 h-5" />
          </div>
          <h4 className="text-xs font-semibold text-white mb-1">Gmail Scope Permission Required</h4>
          <p className="text-[11px] text-zinc-400 max-w-[260px] mb-4 leading-relaxed">
            Your Google authorization lacks the <span className="font-mono text-zinc-300">gmail.readonly</span> scope. Please reconnect and check the email permissions box.
          </p>
          <a
            href="/api/auth/google/url"
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-all shadow-lg shadow-indigo-600/20"
          >
            <span>Authorize Gmail</span>
          </a>
        </div>
      ) : emails.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
          <div className="w-10 h-10 rounded-full bg-zinc-800/50 flex items-center justify-center text-zinc-500 mb-2.5">
            <Inbox className="w-5 h-5" />
          </div>
          <p className="text-xs font-medium text-zinc-300">Inbox Zero</p>
          <p className="text-[11px] text-zinc-500 max-w-[200px] mt-0.5">
            No unread priority emails requiring immediate triage.
          </p>
        </div>
      ) : (
        <div className="space-y-3 flex-1 overflow-y-auto max-h-[380px] pr-1">
          {emails.map(email => (
            <div
              key={email.id}
              className="p-3.5 rounded-xl bg-zinc-950/70 border border-zinc-800/80 hover:border-zinc-700 transition-all group"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-xs font-semibold text-white tracking-tight truncate max-w-[180px]">
                  {email.senderName}
                </span>
                <span className="text-[10px] text-zinc-500 font-mono shrink-0">
                  {new Date(email.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <h4 className="text-xs font-medium text-zinc-300 mb-1 line-clamp-1">
                {email.subject}
              </h4>

              <p className="text-[11px] text-zinc-500 line-clamp-2 leading-relaxed mb-2.5">
                {email.snippet}
              </p>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-zinc-850">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[10px] text-zinc-600 truncate max-w-[130px]">
                    {email.senderEmail}
                  </span>
                  {email.accountEmail && accounts.length > 1 && (
                    <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-[9px] text-indigo-300 truncate max-w-[100px]">
                      {email.accountEmail.split('@')[0]}
                    </span>
                  )}
                </div>

                <button
                  onClick={() => onConvertToTask(email)}
                  className="flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-[11px] font-medium transition-colors"
                  title="Extract into Apple Reminders"
                >
                  <CheckSquare className="w-3 h-3 text-amber-400" />
                  <span>To Reminder</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
