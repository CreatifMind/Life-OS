'use client';

import React, { useState, useEffect } from 'react';
import { X, Mail, Check, Archive, CheckSquare, Send, Sparkles, Loader2 } from 'lucide-react';
import { EmailThread } from '@/lib/types';

interface EmailDetail {
  id: string;
  threadId: string;
  accountEmail: string;
  subject: string;
  senderName: string;
  senderEmail: string;
  to: string;
  date: string;
  messageIdHeader?: string;
  body: string;
  snippet: string;
}

interface EmailDetailModalProps {
  email: EmailThread | null;
  onClose: () => void;
  onConvertToTask: (email: EmailThread) => void;
  onEmailCleared: (emailId: string) => void;
}

export function EmailDetailModal({
  email,
  onClose,
  onConvertToTask,
  onEmailCleared,
}: EmailDetailModalProps) {
  const [detail, setDetail] = useState<EmailDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [replyText, setReplyText] = useState('');
  const [isDrafting, setIsDrafting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    if (!email) {
      setDetail(null);
      setReplyText('');
      setError('');
      setStatusMessage('');
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError('');
    setReplyText('');
    setStatusMessage('');

    const params = new URLSearchParams({ id: email.id });
    if (email.accountEmail) params.set('account', email.accountEmail);

    fetch(`/api/gmail/message?${params.toString()}`)
      .then(res => res.json())
      .then(data => {
        if (cancelled) return;
        if (data.success && data.detail) {
          setDetail(data.detail);
        } else {
          setError(data.error || 'Failed to load full email');
        }
      })
      .catch(() => {
        if (!cancelled) setError('Network error loading email');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [email]);

  if (!email) return null;

  const handleLabelAction = async (action: 'markRead' | 'archive') => {
    setIsActing(true);
    setError('');
    try {
      const res = await fetch('/api/gmail/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          id: email.id,
          accountEmail: email.accountEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Action failed');
        setIsActing(false);
        return;
      }
      onEmailCleared(email.id);
      onClose();
    } catch {
      setError('Failed to update email');
      setIsActing(false);
    }
  };

  const handleDraftReply = async () => {
    setIsDrafting(true);
    setError('');
    try {
      const res = await fetch('/api/gmail/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'draftReply',
          subject: detail?.subject || email.subject,
          senderName: detail?.senderName || email.senderName,
          to: detail?.senderEmail || email.senderEmail,
          emailBody: detail?.body || email.snippet,
        }),
      });
      const data = await res.json();
      if (data.success && data.draft) {
        setReplyText(data.draft);
      } else {
        setError(data.error || 'Could not draft reply');
      }
    } catch {
      setError('Failed to draft reply');
    } finally {
      setIsDrafting(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyText.trim() || isSending) return;
    setIsSending(true);
    setError('');

    try {
      const res = await fetch('/api/gmail/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reply',
          id: email.id,
          threadId: detail?.threadId || email.threadId,
          to: detail?.senderEmail || email.senderEmail,
          subject: detail?.subject || email.subject,
          inReplyTo: detail?.messageIdHeader,
          accountEmail: detail?.accountEmail || email.accountEmail,
          replyBody: replyText.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to send reply');
        setIsSending(false);
        return;
      }
      setStatusMessage('Reply sent!');
      onEmailCleared(email.id);
      setTimeout(() => onClose(), 800);
    } catch {
      setError('Network error sending reply');
      setIsSending(false);
    }
  };

  const needsReauth = error.toLowerCase().includes('insufficient authentication scopes') || error.includes('(403)');

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-xl h-full bg-zinc-950 border-l border-zinc-800 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-4 md:p-5 border-b border-zinc-800 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Mail className="w-4 h-4 text-red-400 shrink-0" />
              <h3 className="text-sm font-semibold text-white truncate">
                {detail?.subject || email.subject}
              </h3>
            </div>
            <p className="text-xs text-zinc-400 truncate">
              <span className="text-zinc-200 font-medium">{detail?.senderName || email.senderName}</span>{' '}
              &lt;{detail?.senderEmail || email.senderEmail}&gt;
            </p>
            <div className="flex items-center gap-2 mt-1 text-[10px] text-zinc-500">
              <span>{new Date(email.receivedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
              {email.accountEmail && (
                <span className="px-1.5 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-300">
                  {email.accountEmail}
                </span>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Bar */}
        <div className="px-4 md:px-5 py-2.5 border-b border-zinc-900 bg-zinc-900/40 flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleLabelAction('markRead')}
            disabled={isActing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-colors disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span>Mark Read</span>
          </button>

          <button
            onClick={() => handleLabelAction('archive')}
            disabled={isActing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-colors disabled:opacity-50"
          >
            <Archive className="w-3.5 h-3.5 text-blue-400" />
            <span>Archive</span>
          </button>

          <button
            onClick={() => {
              onConvertToTask(email);
              onClose();
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition-colors"
          >
            <CheckSquare className="w-3.5 h-3.5 text-amber-400" />
            <span>To Reminder</span>
          </button>
        </div>

        {/* Error / Status Banner */}
        {error && (
          <div className="mx-4 md:mx-5 mt-3 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between gap-2 text-xs text-amber-300">
            <span>{error}</span>
            {needsReauth && (
              <a
                href="/api/auth/google/url"
                className="shrink-0 px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[11px] font-semibold"
              >
                Re-authorize
              </a>
            )}
          </div>
        )}
        {statusMessage && (
          <div className="mx-4 md:mx-5 mt-3 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
            {statusMessage}
          </div>
        )}

        {/* Email Body */}
        <div className="flex-1 overflow-y-auto p-4 md:p-5">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500 py-8 justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
              <span>Loading full message...</span>
            </div>
          ) : (
            <div className="text-xs md:text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap break-words font-sans">
              {detail?.body || email.snippet}
            </div>
          )}
        </div>

        {/* Quick Reply Box */}
        <form onSubmit={handleSendReply} className="p-4 md:p-5 border-t border-zinc-800 bg-zinc-900/30 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
              Quick Reply
            </span>
            <button
              type="button"
              onClick={handleDraftReply}
              disabled={isDrafting || isLoading}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 text-[11px] font-medium transition-colors disabled:opacity-50"
            >
              {isDrafting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              <span>{isDrafting ? 'Drafting...' : 'AI Draft Reply'}</span>
            </button>
          </div>

          <textarea
            rows={3}
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            placeholder={`Reply to ${detail?.senderName || email.senderName}...`}
            className="w-full p-3 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-indigo-500 focus:outline-none text-xs text-white placeholder:text-zinc-600 resize-none"
          />

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!replyText.trim() || isSending}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white hover:bg-zinc-200 disabled:opacity-40 text-zinc-950 text-xs font-medium transition-colors"
            >
              {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              <span>{isSending ? 'Sending...' : 'Send Reply'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
