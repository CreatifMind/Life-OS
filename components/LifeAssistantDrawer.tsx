'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, X, Send, Bot, User, Loader2, RotateCcw, Check, AlertCircle, Info } from 'lucide-react';

import { AssistantActionReceipt, CalendarEvent, ReminderTask } from '@/lib/types';
import { getClientTimeZoneInfo, safeFetchJson } from '@/lib/client';

interface Message {
  role: 'user' | 'model';
  text: string;
  receipts?: AssistantActionReceipt[];
  isError?: boolean;
}

interface LifeAssistantDrawerProps {
  onRemindersMutated?: (reminders?: ReminderTask[], needsFullRefresh?: boolean) => void;
  onEventsMutated?: (events?: CalendarEvent[], needsFullRefresh?: boolean) => void;
}

export function LifeAssistantDrawer({ onRemindersMutated, onEventsMutated }: LifeAssistantDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'model',
      text: 'Good day! I have live access to your Apple Calendar, Reminders, and Gmail. What would you like to check or prepare?',
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const suggestedPrompts = [
    'What does my day look like today?',
    'When am I free for a 1-hour call today?',
    'What meetings require preparation this week?',
    'Give me a summary of my upcoming week.',
  ];

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen]);

  const handleClearChat = () => {
    setMessages([
      {
        role: 'model',
        text: 'Good day! I have live access to your Apple Calendar, Reminders, and Gmail. What would you like to check or prepare?',
      },
    ]);
  };

  const handleSend = async (textToSend?: string) => {
    const q = (textToSend || input).trim();
    if (!q || isLoading) return;

    const userMsg: Message = { role: 'user', text: q };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const history = messages
        .slice(1)
        .filter(m => !m.isError)
        .slice(-12)
        .map(m => ({ role: m.role, text: m.text }));

      const { timeZone, utcOffset } = getClientTimeZoneInfo();

      const data = await safeFetchJson<{
        success: boolean;
        reply?: string;
        error?: string;
        actionResults?: AssistantActionReceipt[];
        createdEvents?: CalendarEvent[];
        createdEvent?: CalendarEvent | null;
        mutatedCalendar?: boolean;
        createdReminders?: ReminderTask[];
        createdReminder?: ReminderTask | null;
        mutatedReminders?: boolean;
      }>('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: q, history, timeZone, utcOffset }),
      });

      if (data.reply) {
        setMessages(prev => [
          ...prev,
          {
            role: 'model',
            text: data.reply!,
            receipts: Array.isArray(data.actionResults) && data.actionResults.length > 0
              ? data.actionResults
              : undefined,
          },
        ]);

        const createdRems = Array.isArray(data.createdReminders) && data.createdReminders.length > 0
          ? data.createdReminders
          : data.createdReminder
          ? [data.createdReminder]
          : [];
        if (createdRems.length > 0 || data.mutatedReminders) {
          onRemindersMutated?.(createdRems, Boolean(data.mutatedReminders));
        }

        const createdEvts = Array.isArray(data.createdEvents) && data.createdEvents.length > 0
          ? data.createdEvents
          : data.createdEvent
          ? [data.createdEvent]
          : [];
        if (createdEvts.length > 0 || data.mutatedCalendar) {
          onEventsMutated?.(createdEvts, Boolean(data.mutatedCalendar));
        }
      } else {
        setMessages(prev => [
          ...prev,
          { role: 'model', text: `Sorry, I encountered an issue: ${data.error || 'Empty response'}`, isError: true },
        ]);
      }
    } catch (err: any) {
      setMessages(prev => [
        ...prev,
        { role: 'model', text: err?.message || 'Connection error. Please try again.', isError: true },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-[#16161A]/95 hover:bg-zinc-800 text-white font-medium text-xs shadow-2xl border border-zinc-700/80 backdrop-blur-md active:scale-95 transition-all group"
      >
        <Sparkles className="w-3.5 h-3.5 text-zinc-300 group-hover:rotate-12 transition-transform" />
        <span>Ask Life OS</span>
      </button>

      {/* Slide-Over Drawer */}
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className="fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div
            onClick={e => e.stopPropagation()}
            className="w-full max-w-md h-full bg-[#0A0A0C] border-l border-zinc-800 flex flex-col shadow-2xl"
          >
            {/* Drawer Header */}
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white text-zinc-950 flex items-center justify-center">
                  <Bot className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-white">Life OS Assistant</h3>
                  <p className="text-[10px] text-zinc-500">Live Grounded Intelligence</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 1 && (
                  <button
                    onClick={handleClearChat}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                    title="Clear conversation"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                  title="Close (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Messages Scroll Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex gap-2.5 text-xs ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {m.role === 'model' && (
                    <div className="w-6 h-6 rounded-full bg-zinc-800 text-zinc-200 border border-zinc-700 flex items-center justify-center shrink-0 mt-0.5">
                      <Sparkles className="w-3 h-3" />
                    </div>
                  )}

                  <div className="max-w-[85%] space-y-1.5">
                    <div
                      className={`p-3 rounded-2xl leading-relaxed whitespace-pre-wrap ${
                        m.role === 'user'
                          ? 'bg-white text-zinc-950 font-medium rounded-br-none'
                          : m.isError
                          ? 'bg-rose-500/10 border border-rose-500/30 text-rose-200 rounded-bl-none'
                          : 'bg-[#111114] border border-zinc-800/80 text-zinc-200 rounded-bl-none'
                      }`}
                    >
                      {m.text}
                    </div>

                    {m.receipts && m.receipts.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pl-0.5">
                        {m.receipts.map((rc, rIdx) => (
                          <span
                            key={rIdx}
                            title={rc.detail || rc.label}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium border ${
                              rc.status === 'success'
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                                : rc.status === 'error'
                                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                                : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                            }`}
                          >
                            {rc.status === 'success' ? (
                              <Check className="w-2.5 h-2.5 shrink-0" />
                            ) : rc.status === 'error' ? (
                              <AlertCircle className="w-2.5 h-2.5 shrink-0" />
                            ) : (
                              <Info className="w-2.5 h-2.5 shrink-0" />
                            )}
                            <span className="truncate max-w-[220px]">{rc.label}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {m.role === 'user' && (
                    <div className="w-6 h-6 rounded-full bg-zinc-800 text-zinc-300 flex items-center justify-center shrink-0 mt-0.5">
                      <User className="w-3 h-3" />
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex items-center gap-2 text-xs text-zinc-500 pl-8">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-300" />
                  <span>Reviewing schedule and tasks...</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* Suggested Prompt Pills */}
            <div className="px-4 py-2 border-t border-zinc-900 flex gap-1.5 overflow-x-auto no-scrollbar">
              {suggestedPrompts.map((prompt, i) => (
                <button
                  key={i}
                  disabled={isLoading}
                  onClick={() => handleSend(prompt)}
                  className="px-2.5 py-1 rounded-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-400 hover:text-zinc-200 shrink-0 transition-colors"
                >
                  {prompt}
                </button>
              ))}
            </div>

            {/* Input Bar */}
            <div className="p-4 border-t border-zinc-800 bg-zinc-950">
              <form
                onSubmit={e => {
                  e.preventDefault();
                  handleSend();
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Ask about your schedule, tasks, or emails..."
                  className="flex-1 px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-500 transition-colors"
                />
                <button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  className="p-2.5 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 disabled:opacity-40 transition-colors"
                >
                  <Send className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
