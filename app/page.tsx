'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from '@/components/Header';
import { DailyBriefingCard } from '@/components/DailyBriefingCard';
import { CalendarTimeline } from '@/components/CalendarTimeline';
import { RemindersWidget } from '@/components/RemindersWidget';
import { GmailTriageWidget } from '@/components/GmailTriageWidget';
import { EmailDetailModal } from '@/components/EmailDetailModal';
import { NewReminderModal } from '@/components/NewReminderModal';
import { LifeAssistantDrawer } from '@/components/LifeAssistantDrawer';
import { CalendarEvent, ReminderTask, EmailThread, DailyBriefing, SyncHealthStatus } from '@/lib/types';

type MobileTab = 'briefing' | 'schedule' | 'tasks' | 'mail';

export default function DashboardPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [reminders, setReminders] = useState<ReminderTask[]>([]);
  const [emails, setEmails] = useState<EmailThread[]>([]);
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [health, setHealth] = useState<SyncHealthStatus | undefined>(undefined);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');
  const lastSyncMsRef = useRef<number>(0);

  const [isSyncing, setIsSyncing] = useState<boolean>(true);
  const [isBriefingLoading, setIsBriefingLoading] = useState<boolean>(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>('briefing');
  const [selectedEmail, setSelectedEmail] = useState<EmailThread | null>(null);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalNotes, setModalNotes] = useState('');

  // 1. Initial Load & Synchronization
  const handleSyncData = useCallback(async () => {
    try {
      setIsSyncing(true);
      const res = await fetch('/api/sync');
      const json = await res.json();

      if (json.success && json.data) {
        setEvents(json.data.events || []);
        setReminders(json.data.reminders || []);
        setEmails(json.data.emails || []);
        setHealth(json.data.health);
        const nowIso = json.data.health?.lastSync || new Date().toISOString();
        setLastSyncTime(nowIso);
        lastSyncMsRef.current = Date.now();
      }
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // 2. Load cached Briefing or force AI generation with Gemini
  const handleFetchBriefing = useCallback(async (force: boolean = false) => {
    try {
      setIsBriefingLoading(true);
      const res = await fetch('/api/briefing/generate', {
        method: force ? 'POST' : 'GET',
      });
      const json = await res.json();
      if (json.success && json.briefing) {
        setBriefing(json.briefing);
      }
    } catch (err) {
      console.error('Briefing fetch/generation error:', err);
    } finally {
      setIsBriefingLoading(false);
    }
  }, []);

  // 3. Unified Sync Action: Syncs all integrations AND regenerates AI Briefing together
  const handleFullSync = useCallback(async () => {
    setIsSyncing(true);
    setIsBriefingLoading(true);
    try {
      const res = await fetch('/api/sync');
      const json = await res.json();

      if (json.success && json.data) {
        setEvents(json.data.events || []);
        setReminders(json.data.reminders || []);
        setEmails(json.data.emails || []);
        setHealth(json.data.health);
        setLastSyncTime(json.data.health?.lastSync || new Date().toISOString());
        lastSyncMsRef.current = Date.now();
      }

      const briefingRes = await fetch('/api/briefing/generate', { method: 'POST' });
      const briefingJson = await briefingRes.json();
      if (briefingJson.success && briefingJson.briefing) {
        setBriefing(briefingJson.briefing);
      }
    } catch (err) {
      console.error('Unified full sync failed:', err);
    } finally {
      setIsSyncing(false);
      setIsBriefingLoading(false);
    }
  }, []);

  // Initial load + strip OAuth query params from URL
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('auth=')) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    handleSyncData();
    handleFetchBriefing(false);
  }, [handleSyncData, handleFetchBriefing]);

  // Quiet background auto-refresh (regenerates everything on tab focus after 5m, or every 15m)
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastSyncMsRef.current > 5 * 60 * 1000) {
        handleFullSync();
      }
    };
    window.addEventListener('focus', onFocus);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        handleFullSync();
      }
    }, 15 * 60 * 1000);

    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(interval);
    };
  }, [handleFullSync]);

  // Toggle Reminder State (Two-Way Sync)
  const handleToggleTask = async (uid: string, nextStatus: boolean) => {
    setReminders(prev =>
      prev.map(t => (t.uid === uid ? { ...t, isCompleted: nextStatus } : t))
    );

    try {
      const res = await fetch('/api/reminders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid, isCompleted: nextStatus }),
      });
      if (!res.ok) {
        throw new Error('Failed to update Apple Reminder');
      }
    } catch (err) {
      console.error(err);
      setReminders(prev =>
        prev.map(t => (t.uid === uid ? { ...t, isCompleted: !nextStatus } : t))
      );
    }
  };

  // Create New Task (queued for Mac EventKit two-way sync)
  const handleCreateTask = async (title: string, dueDate?: string, notes?: string) => {
    const res = await fetch('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, dueDate, notes }),
    });

    const json = await res.json();
    if (json.success && json.uid) {
      const newTask: ReminderTask = json.task || {
        id: json.uid,
        uid: json.uid,
        title,
        listName: reminders[0]?.listName || 'Reminders',
        isCompleted: false,
        priority: 0,
        dueDate,
        notes,
      };
      setReminders(prev => [newTask, ...prev]);
    }
  };

  // Convert Email to Reminder Workflow
  const handleConvertToTask = (email: EmailThread) => {
    setModalTitle(`Follow up: ${email.subject}`);
    setModalNotes(`From: ${email.senderName} (${email.senderEmail})\n\nSnippet: ${email.snippet}`);
    setIsModalOpen(true);
  };

  // 1-Click Mark Email as Read in Gmail
  const handleMarkRead = async (email: EmailThread) => {
    setEmails(prev => prev.filter(e => e.id !== email.id));
    try {
      const res = await fetch('/api/gmail/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'markRead',
          id: email.id,
          accountEmail: email.accountEmail,
        }),
      });
      if (!res.ok) {
        // Restore & open modal so user sees re-auth prompt if gmail.modify is missing
        setEmails(prev => [email, ...prev]);
        setSelectedEmail(email);
      }
    } catch {
      setEmails(prev => [email, ...prev]);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#09090b] text-zinc-100">
      {/* Top Header */}
      <Header
        onRefresh={handleFullSync}
        isSyncing={isSyncing || isBriefingLoading}
        health={health}
        lastSyncTime={lastSyncTime}
      />

      {/* Mobile Navigation Tabs (< md) */}
      <div className="md:hidden sticky top-[61px] z-20 bg-zinc-950/90 backdrop-blur-md border-b border-zinc-800/80 px-4 py-2 flex items-center gap-1.5 overflow-x-auto">
        {(
          [
            { id: 'briefing', label: 'Briefing' },
            { id: 'schedule', label: `Schedule (${events.length})` },
            { id: 'tasks', label: `Tasks (${reminders.filter(r => !r.isCompleted).length})` },
            { id: 'mail', label: `Mail (${emails.length})` },
          ] as Array<{ id: MobileTab; label: string }>
        ).map(tab => (
          <button
            key={tab.id}
            onClick={() => setMobileTab(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
              mobileTab === tab.id
                ? 'bg-indigo-600 text-white'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Command Center Container */}
      <main className="flex-1 px-4 md:px-8 py-4 md:py-5 max-w-7xl mx-auto w-full space-y-5">
        {/* Section 1: Compact Hero AI Daily Briefing + Merged Top 3 Priorities */}
        <section className={mobileTab === 'briefing' ? 'block' : 'hidden md:block'}>
          <DailyBriefingCard
            briefing={briefing}
            isLoading={isBriefingLoading}
          />
        </section>

        {/* Section 2: 3-Column Operational Command Center (Above the fold on desktop) */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Column 1: Apple Calendar */}
          <div className={`h-full ${mobileTab === 'schedule' ? 'block' : 'hidden md:block'}`}>
            <CalendarTimeline events={events} isLoading={isSyncing && events.length === 0} />
          </div>

          {/* Column 2: Apple Reminders */}
          <div className={`h-full ${mobileTab === 'tasks' ? 'block' : 'hidden md:block'}`}>
            <RemindersWidget
              reminders={reminders}
              isLoading={isSyncing && reminders.length === 0}
              onToggleTask={handleToggleTask}
              onQuickAddTask={(title) => handleCreateTask(title)}
              onOpenNewTaskModal={() => {
                setModalTitle('');
                setModalNotes('');
                setIsModalOpen(true);
              }}
            />
          </div>

          {/* Column 3: Gmail Priority Triage */}
          <div className={`h-full ${mobileTab === 'mail' ? 'block' : 'hidden md:block'}`}>
            <GmailTriageWidget
              emails={emails}
              isLoading={isSyncing && emails.length === 0}
              onConvertToTask={handleConvertToTask}
              onSelectEmail={email => setSelectedEmail(email)}
              onMarkRead={handleMarkRead}
              onDisconnectAccount={async (email) => {
                try {
                  await fetch('/api/gmail/accounts', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email }),
                  });
                  await handleFullSync();
                } catch (err) {
                  console.error('Failed to disconnect Gmail account:', err);
                }
              }}
              health={health?.gmail}
            />
          </div>
        </section>
      </main>

      {/* In-Place Email Reader & Quick Reply Drawer */}
      <EmailDetailModal
        email={selectedEmail}
        onClose={() => setSelectedEmail(null)}
        onConvertToTask={handleConvertToTask}
        onEmailCleared={emailId => setEmails(prev => prev.filter(e => e.id !== emailId))}
      />

      {/* Quick Add Apple Reminder Modal */}
      <NewReminderModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateTask}
        initialTitle={modalTitle}
        initialNotes={modalNotes}
      />

      {/* Live Grounded AI Life Assistant */}
      <LifeAssistantDrawer onReminderCreated={handleSyncData} />
    </div>
  );
}
