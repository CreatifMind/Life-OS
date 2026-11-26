'use client';

import React, { useState, useEffect } from 'react';
import { X, Mail, Check, Archive, CheckSquare, Send, Sparkles, Loader2, Paperclip, Reply } from 'lucide-react';
import { EmailThread } from '@/lib/types';
import { safeFetchJson } from '@/lib/client';

interface EmailAttachment {
  attachmentId: string;
  filename: string;
  mimeType: string;
  size: number;
}

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
  htmlBody?: string;
  attachments?: EmailAttachment[];
  snippet: string;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderLinkifiedText(text: string): React.ReactNode {
  const parts = text.split(/(https?:\/\/[^\s<>()]+)/gi);
  return parts.map((part, i) =>
    /^https?:\/\//i.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sky-400 underline hover:text-sky-300 break-all"
      >
        {part}
      </a>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  );
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
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [isDrafting, setIsDrafting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  useEffect(() => {
    if (!email) {
      setDetail(null);
      setReplyText('');
      setShowReply(false);
      setError('');
      setStatusMessage('');
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setShowReply(false);
    setError('');
    setReplyText('');
    setStatusMessage('');

    const params = new URLSearchParams({ id: email.id });
    if (email.accountEmail) params.set('account', email.accountEmail);

    safeFetchJson<{ success: boolean; detail?: EmailDetail; error?: string }>(`/api/gmail/message?${params.toString()}`)
      .then(data => {
        if (cancelled) return;
        if (data.detail) {
          setDetail(data.detail);
        } else {
          setError(data.error || 'Failed to load full email');
        }
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Network error loading email');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [email]);

  useEffect(() => {
    if (!email) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [email, onClose]);

  if (!email) return null;

  const handleLabelAction = async (action: 'markRead' | 'archive') => {
    setIsActing(true);
    setError('');
    try {
      await safeFetchJson('/api/gmail/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          id: email.id,
          accountEmail: email.accountEmail,
        }),
      });
      onEmailCleared(email.id);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Failed to update email');
      setIsActing(false);
    }
  };

  const handleDraftReply = async () => {
    setIsDrafting(true);
    setError('');
    try {
      const data = await safeFetchJson<{ success: boolean; draft?: string; error?: string }>('/api/gmail/message', {
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
      if (data.draft) {
        setReplyText(data.draft);
      } else {
        setError(data.error || 'Could not draft reply');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to draft reply');
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
      await safeFetchJson('/api/gmail/message', {
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
      setStatusMessage('Reply sent!');
      onEmailCleared(email.id);
      setTimeout(() => onClose(), 800);
    } catch (err: any) {
      setError(err?.message || 'Network error sending reply');
      setIsSending(false);
    }
  };

  const needsReauth = error.toLowerCase().includes('insufficient authentication scopes') || error.includes('(403)');

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/75 backdrop-blur-sm"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="w-full max-w-3xl h-[90vh] md:h-[86vh] rounded-2xl bg-[#111114] border border-zinc-800/90 flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800/80 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Mail className="w-4 h-4 text-zinc-400 shrink-0" />
              <h3 className="text-sm md:text-base font-medium text-white truncate">
                {detail?.subject || email.subject}
              </h3>
            </div>
            <p className="text-xs text-zinc-400 truncate">
              <span className="text-zinc-200 font-medium">{detail?.senderName || email.senderName}</span>{' '}
              &lt;{detail?.senderEmail || email.senderEmail}&gt;
            </p>
            <div className="flex items-center gap-2 mt-1 text-[11px] text-zinc-500">
              <span>{new Date(email.receivedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
              {email.accountEmail && (
                <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 text-[10px]">
                  {email.accountEmail}
                </span>
              )}
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors shrink-0"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Bar */}
        <div className="px-5 py-2.5 border-b border-zinc-800/70 bg-[#0D0D10] flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowReply(prev => !prev)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              showReply
                ? 'bg-white text-zinc-950'
                : 'bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800'
            }`}
          >
            <Reply className="w-3.5 h-3.5" />
            <span>Reply</span>
          </button>

          <button
            onClick={() => handleLabelAction('markRead')}
            disabled={isActing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-medium transition-colors disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5 text-emerald-400" />
            <span>Mark Read</span>
          </button>

          <button
            onClick={() => handleLabelAction('archive')}
            disabled={isActing}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-medium transition-colors disabled:opacity-50"
          >
            <Archive className="w-3.5 h-3.5 text-zinc-400" />
            <span>Archive</span>
          </button>

          <button
            onClick={() => {
              onConvertToTask(email);
              onClose();
            }}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-medium transition-colors"
          >
            <CheckSquare className="w-3.5 h-3.5 text-amber-400" />
            <span>To Reminder</span>
          </button>
        </div>

        {/* Error / Status Banner */}
        {error && (
          <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-between gap-2 text-xs text-amber-300">
            <span>{error}</span>
            {needsReauth && (
              <a
                href="/api/auth/google/url"
                className="shrink-0 px-2.5 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-[11px] font-medium"
              >
                Re-authorize
              </a>
            )}
          </div>
        )}
        {statusMessage && (
          <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
            {statusMessage}
          </div>
        )}

        {/* Email Body */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-zinc-500 py-12 justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-zinc-300" />
              <span>Loading full message...</span>
            </div>
          ) : detail?.htmlBody ? (
            <iframe
              title={detail.subject || 'Email content'}
              srcDoc={detail.htmlBody}
              sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
              className="w-full h-full flex-1 min-h-[380px] bg-white border-0"
            />
          ) : (
            <div className="p-5 text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap break-words font-sans">
              {renderLinkifiedText(detail?.body || email.snippet)}
            </div>
          )}

          {/* Clickable Attachments */}
          {detail?.attachments && detail.attachments.length > 0 && (
            <div className="px-5 py-3 border-t border-zinc-800/80 bg-[#0D0D10] flex flex-wrap gap-2">
              {detail.attachments.map(att => {
                const href = `/api/gmail/attachment?messageId=${encodeURIComponent(detail.id)}&attachmentId=${encodeURIComponent(att.attachmentId)}&account=${encodeURIComponent(detail.accountEmail)}&mimeType=${encodeURIComponent(att.mimeType)}&filename=${encodeURIComponent(att.filename)}`;
                return (
                  <a
                    key={att.attachmentId}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs text-zinc-200 transition-colors"
                  >
                    <Paperclip className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    <span className="truncate max-w-[200px]">{att.filename}</span>
                    {att.size > 0 && (
                      <span className="text-[10px] text-zinc-500 font-mono">{formatBytes(att.size)}</span>
                    )}
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {/* Toggleable Quick Reply Box */}
        {showReply && (
          <form onSubmit={handleSendReply} className="p-4 md:p-5 border-t border-zinc-800 bg-[#0D0D10] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-400">
                Reply to {detail?.senderName || email.senderName}
              </span>
              <button
                type="button"
                onClick={handleDraftReply}
                disabled={isDrafting || isLoading}
                className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 text-[11px] font-medium transition-colors disabled:opacity-50"
              >
                {isDrafting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                <span>{isDrafting ? 'Drafting...' : 'AI Draft'}</span>
              </button>
            </div>

            <textarea
              rows={3}
              value={replyText}
              onChange={e => setReplyText(e.target.value)}
              placeholder="Write your reply..."
              autoFocus
              className="w-full p-3 rounded-xl bg-zinc-950 border border-zinc-800 focus:border-zinc-500 focus:outline-none text-xs text-white placeholder:text-zinc-600 resize-none"
            />

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowReply(false)}
                className="px-3 py-1.5 rounded-lg text-zinc-400 hover:text-zinc-200 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!replyText.trim() || isSending}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white hover:bg-zinc-200 disabled:opacity-40 text-zinc-950 text-xs font-medium transition-colors"
              >
                {isSending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                <span>{isSending ? 'Sending...' : 'Send Reply'}</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
