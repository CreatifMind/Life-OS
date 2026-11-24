'use client';

import React, { useState } from 'react';
import { Mail, CheckSquare, Inbox, Plus, X, Check } from 'lucide-react';
import { EmailThread } from '@/lib/types';

interface GmailTriageWidgetProps {
  emails: EmailThread[];
  isLoading: boolean;
  onConvertToTask: (email: EmailThread) => void;
  onSelectEmail?: (email: EmailThread) => void;
  onMarkRead?: (email: EmailThread) => void;
  onDisconnectAccount?: (email: string) => void;
  health?: { status: string; message?: string; accounts?: string[]; emailSendReady?: boolean };
}

function shortAccountLabel(email: string): string {
  const lower = email.toLowerCase();
  if (lower.includes('siamconnection')) return 'Work';
  const user = email.split('@')[0];
  return user.length > 12 ? `${user.slice(0, 12)}…` : user;
}

export function GmailTriageWidget({
  emails,
  isLoading,
  onConvertToTask,
  onSelectEmail,
  onMarkRead,
  onDisconnectAccount,
  health,
}: GmailTriageWidgetProps) {
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const isError = health?.status === 'ERROR';
  const accounts = health?.accounts || [];

  const filteredEmails =
    selectedAccount === 'all'
      ? emails
      : emails.filter(e => (e.accountEmail || '').toLowerCase() === selectedAccount.toLowerCase());

  return (
    <div className="rounded-2xl p-5 bg-[#111114] border border-zinc-800/70 flex flex-col h-full">
      {/* Single-line clean header */}
      <div className="flex items-center justify-between mb-3.5 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Mail className="w-4 h-4 text-zinc-400 shrink-0" />
          <h3 className="text-sm font-medium text-white tracking-tight">Inbox</h3>
          <span className="text-[11px] font-mono text-zinc-500">{filteredEmails.length}</span>
        </div>

        <a
          href="/api/auth/google/url"
          className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800/80 transition-colors shrink-0"
          title="Connect another Gmail account"
        >
          <Plus className="w-4 h-4" />
        </a>
      </div>

      {/* Compact account filter tabs */}
      {accounts.length > 0 && (
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {accounts.length > 1 && (
            <button
              onClick={() => setSelectedAccount('all')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                selectedAccount === 'all'
                  ? 'bg-white text-zinc-950'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
              }`}
            >
              All
            </button>
          )}
          {accounts.map(acc => {
            const active = selectedAccount.toLowerCase() === acc.toLowerCase();
            return (
              <div
                key={acc}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-white text-zinc-950'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                }`}
              >
                <button
                  onClick={() => setSelectedAccount(active ? 'all' : acc)}
                  title={acc}
                  className="truncate max-w-[110px]"
                >
                  {shortAccountLabel(acc)}
                </button>
                {onDisconnectAccount && accounts.length > 1 && (
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      onDisconnectAccount(acc);
                    }}
                    className={`ml-0.5 transition-colors ${
                      active ? 'text-zinc-600 hover:text-zinc-950' : 'text-zinc-600 hover:text-rose-400'
                    }`}
                    title={`Disconnect ${acc}`}
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {health?.status === 'OK' && health?.emailSendReady === false && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-between gap-2">
          <span className="text-[11px] text-amber-300">
            8 AM briefing email needs <span className="font-mono">gmail.send</span> permission.
          </span>
          <a
            href="/api/auth/google/url"
            className="shrink-0 px-2 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[10px] font-medium transition-colors"
          >
            Re-authorize
          </a>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3 py-4 animate-pulse">
          <div className="h-14 bg-zinc-900/80 rounded-lg" />
          <div className="h-14 bg-zinc-900/80 rounded-lg" />
        </div>
      ) : isError ? (
        <div className="flex-1 flex flex-col items-center justify-center py-6 px-3 text-center">
          <div className="w-9 h-9 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 mb-3">
            <Mail className="w-4 h-4" />
          </div>
          <h4 className="text-xs font-medium text-white mb-1">Gmail Permission Required</h4>
          <p className="text-[11px] text-zinc-500 max-w-[240px] mb-4 leading-relaxed">
            Reconnect your Google account to grant Primary inbox access.
          </p>
          <a
            href="/api/auth/google/url"
            className="px-3.5 py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-zinc-950 text-xs font-medium transition-colors"
          >
            Authorize Gmail
          </a>
        </div>
      ) : filteredEmails.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-10 text-center">
          <div className="w-9 h-9 rounded-full bg-zinc-800/50 flex items-center justify-center text-zinc-500 mb-2.5">
            <Inbox className="w-4 h-4" />
          </div>
          <p className="text-xs font-medium text-zinc-300">Inbox Zero</p>
          <p className="text-[11px] text-zinc-500 max-w-[200px] mt-0.5">
            No unread Primary emails.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-zinc-800/60 flex-1 overflow-y-auto overflow-x-hidden touch-pan-y overscroll-x-none max-h-[380px] pr-1">
          {filteredEmails.map(email => (
            <div
              key={email.id}
              onClick={() => onSelectEmail?.(email)}
              className="py-3 px-2 rounded-lg hover:bg-zinc-800/30 transition-colors group cursor-pointer"
            >
              <div className="flex items-baseline justify-between gap-2 mb-0.5">
                <span className="text-xs font-medium text-white tracking-tight truncate">
                  {email.senderName}
                </span>
                <span className="text-[10px] text-zinc-500 font-mono shrink-0">
                  {new Date(email.receivedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <h4 className="text-xs text-zinc-300 mb-0.5 line-clamp-1">
                {email.subject}
              </h4>

              <p className="text-[11px] text-zinc-500 line-clamp-2 leading-relaxed mb-2">
                {email.snippet}
              </p>

              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-zinc-600 truncate">
                  {email.accountEmail && accounts.length > 1
                    ? shortAccountLabel(email.accountEmail)
                    : email.senderEmail}
                </span>

                <div className="flex items-center gap-1 shrink-0">
                  {onMarkRead && (
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onMarkRead(email);
                      }}
                      className="flex items-center gap-1 px-2 py-0.5 rounded-md text-zinc-400 hover:text-emerald-300 hover:bg-zinc-800/80 text-[11px] font-medium transition-colors"
                      title="Mark as Read in Gmail"
                    >
                      <Check className="w-3 h-3" />
                      <span>Read</span>
                    </button>
                  )}

                  <button
                    onClick={e => {
                      e.stopPropagation();
                      onConvertToTask(email);
                    }}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md text-zinc-400 hover:text-white hover:bg-zinc-800/80 text-[11px] font-medium transition-colors"
                    title="Add to Reminders"
                  >
                    <CheckSquare className="w-3 h-3" />
                    <span>Task</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
