'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Header } from '@/components/Header';
import { DailyBriefingCard } from '@/components/DailyBriefingCard';
import { CalendarTimeline } from '@/components/CalendarTimeline';
import { RemindersWidget } from '@/components/RemindersWidget';
import { GmailTriageWidget } from '@/components/GmailTriageWidget';
import { EmailDetailModal } from '@/components/EmailDetailModal';
import { NewReminderModal } from '@/components/NewReminderModal';
import { EditReminderModal } from '@/components/EditReminderModal';
import { NewEventModal } from '@/components/NewEventModal';
import { EventDetailModal } from '@/components/EventDetailModal';
import { LifeAssistantDrawer } from '@/components/LifeAssistantDrawer';
import { CalendarEvent, ReminderTask, EmailThread, DailyBriefing, SyncHealthStatus } from '@/lib/types';
import { getClientTimeZoneInfo, getUpcomingEventIds, safeFetchJson } from '@/lib/client';

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
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [selectedReminder, setSelectedReminder] = useState<ReminderTask | null>(null);
  const [authBanner, setAuthBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalNotes, setModalNotes] = useState('');

  // Refs so on-demand briefing generation reuses already-synced state without re-fetching CalDAV/Gmail
  const latestDataRef = useRef({ events, reminders, emails });
  useEffect(() => {
    latestDataRef.current = { events, reminders, emails };
  }, [events, reminders, emails]);

  // 1. Initial Load & Synchronization
  const handleSyncData = useCallback(async () => {
    try {
      setIsSyncing(true);
      setSyncError(null);
      const json = await safeFetchJson('/api/sync');

      if (json.data) {
        setEvents(json.data.events || []);
        setReminders(json.data.reminders || []);
        setEmails(json.data.emails || []);
        setHealth(json.data.health);
        const nowIso = json.data.health?.lastSync || new Date().toISOString();
        setLastSyncTime(nowIso);
        lastSyncMsRef.current = Date.now();
      }
    } catch (err: any) {
      setSyncError(err?.message || 'Sync failed. Please try again.');
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // 2. Load cached Briefing or force AI generation with Gemini
  const handleFetchBriefing = useCallback(async (
    force: boolean = false,
    overrideData?: { events: CalendarEvent[]; reminders: ReminderTask[]; emails: EmailThread[] }
  ) => {
    try {
      setIsBriefingLoading(true);
      const { timeZone } = getClientTimeZoneInfo();
      const payload = overrideData || (
        latestDataRef.current.events.length > 0 ||
        latestDataRef.current.reminders.length > 0 ||
        latestDataRef.current.emails.length > 0
          ? latestDataRef.current
          : null
      );

      const json = await safeFetchJson('/api/briefing/generate', {
        method: force ? 'POST' : 'GET',
        ...(force
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                timeZone,
                ...(payload || {}),
              }),
            }
          : {}),
      });

      if (json.briefing) {
        setBriefing(json.briefing);
      }
    } catch (err: any) {
      setSyncError(err?.message || 'Failed to update Daily Briefing.');
    } finally {
      setIsBriefingLoading(false);
    }
  }, []);

  // 3. Unified Sync Action (single-pass: fetches /api/sync once and passes that data directly to briefing generator)
  const handleFullSync = useCallback(async () => {
    setIsSyncing(true);
    setIsBriefingLoading(true);
    setSyncError(null);
    try {
      const json = await safeFetchJson('/api/sync');
      const nextEvents = json.data?.events || [];
      const nextReminders = json.data?.reminders || [];
      const nextEmails = json.data?.emails || [];

      if (json.data) {
        setEvents(nextEvents);
        setReminders(nextReminders);
        setEmails(nextEmails);
        setHealth(json.data.health);
        setLastSyncTime(json.data.health?.lastSync || new Date().toISOString());
        lastSyncMsRef.current = Date.now();
      }

      const { timeZone } = getClientTimeZoneInfo();
      const briefingJson = await safeFetchJson('/api/briefing/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: nextEvents,
          reminders: nextReminders,
          emails: nextEmails,
          timeZone,
        }),
      });
      if (briefingJson.briefing) {
        setBriefing(briefingJson.briefing);
      }
    } catch (err: any) {
      setSyncError(err?.message || 'Full sync failed. Please try again.');
    } finally {
      setIsSyncing(false);
      setIsBriefingLoading(false);
    }
  }, []);

  // Initial load + surface OAuth success/error before stripping query params
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search.includes('auth=')) {
      const params = new URLSearchParams(window.location.search);
      const authStatus = params.get('auth');
      if (authStatus === 'failed') {
        const errText = params.get('error') || 'Google authorization failed.';
        setAuthBanner({ type: 'error', message: `Google sign-in failed: ${errText}` });
      } else if (authStatus === 'gmail_success') {
        const account = params.get('account');
        setAuthBanner({
          type: 'success',
          message: account ? `Connected ${account} to Life OS.` : 'Gmail account connected.',
        });
        setTimeout(() => setAuthBanner(null), 5000);
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    handleSyncData();
    handleFetchBriefing(false);
  }, [handleSyncData, handleFetchBriefing]);

  // Quiet background auto-refresh (regenerates on focus / iOS PWA visibility resume after 5m, or every 15m)
  useEffect(() => {
    const maybeSync = () => {
      if (Date.now() - lastSyncMsRef.current > 5 * 60 * 1000) {
        handleFullSync();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        maybeSync();
      }
    };
    window.addEventListener('focus', maybeSync);
    document.addEventListener('visibilitychange', onVisibility);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        handleFullSync();
      }
    }, 15 * 60 * 1000);

    return () => {
      window.removeEventListener('focus', maybeSync);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(interval);
    };
  }, [handleFullSync]);

  // Toggle Reminder State (Two-Way Sync with Undo restoration fallback)
  const handleToggleTask = async (uid: string, nextStatus: boolean) => {
    const target = reminders.find(r => r.uid === uid || r.id === uid);
    setReminders(prev =>
      prev.map(t => (t.uid === uid || t.id === uid ? { ...t, isCompleted: nextStatus } : t))
    );

    try {
      const json = await safeFetchJson('/api/reminders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid,
          isCompleted: nextStatus,
          title: target?.title,
          listName: target?.listName,
          dueDate: target?.dueDate,
          notes: target?.notes,
        }),
      });
      if (json.restoredTask) {
        setReminders(prev => [
          json.restoredTask,
          ...prev.filter(r => r.uid !== uid && r.id !== uid),
        ]);
      }
    } catch (err: any) {
      setSyncError(err?.message || 'Failed to update Apple Reminder');
      setReminders(prev =>
        prev.map(t => (t.uid === uid || t.id === uid ? { ...t, isCompleted: !nextStatus } : t))
      );
    }
  };

  // Create New Task (queued for Mac EventKit two-way sync)
  const handleCreateTask = async (title: string, dueDate?: string, notes?: string) => {
    const json = await safeFetchJson('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, dueDate, notes }),
    });
    if (json.uid) {
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
      const nextReminders = [newTask, ...reminders];
      setReminders(nextReminders);
      handleFetchBriefing(true, { events, reminders: nextReminders, emails });
    }
  };

  // Create New Apple Calendar Event via CalDAV
  const handleCreateEvent = async (payload: {
    title: string;
    startTime: string;
    endTime: string;
    startDate?: string;
    endDate?: string;
    isAllDay: boolean;
    location?: string;
    calendarName?: string;
  }) => {
    const json = await safeFetchJson('/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (json.event) {
      const nextEvents = [...events, json.event].sort(
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );
      setEvents(nextEvents);
      handleFetchBriefing(true, { events: nextEvents, reminders, emails });
    }
  };

  // Update Existing Apple Reminder (in-place in Life OS + Mac EventKit sync)
  const handleUpdateTask = async (
    oldReminder: ReminderTask,
    updates: { title: string; dueDate?: string; clearDueDate?: boolean; notes?: string; clearNotes?: boolean }
  ) => {
    const json = await safeFetchJson('/api/reminders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        oldTitle: oldReminder.title,
        title: updates.title,
        listName: oldReminder.listName,
        dueDate: updates.dueDate,
        clearDueDate: updates.clearDueDate,
        notes: updates.notes,
        clearNotes: updates.clearNotes,
      }),
    });
    if (json.task) {
      const nextReminders = [
        json.task,
        ...reminders.filter(
          r => r.uid !== oldReminder.uid && r.title.trim().toLowerCase() !== oldReminder.title.trim().toLowerCase()
        ),
      ];
      setReminders(nextReminders);
      handleFetchBriefing(true, { events, reminders: nextReminders, emails });
    }
  };

  // Update Existing Apple Calendar Event via CalDAV (non-destructive)
  const handleUpdateEvent = async (
    oldEvent: CalendarEvent,
    payload: {
      title: string;
      startTime: string;
      endTime: string;
      startDate?: string;
      endDate?: string;
      isAllDay: boolean;
      location?: string;
      description?: string;
      calendarName?: string;
    }
  ) => {
    const json = await safeFetchJson('/api/calendar', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: oldEvent.id,
        oldTitle: oldEvent.title,
        isRecurring: oldEvent.isRecurring,
        ...payload,
      }),
    });
    if (json.event) {
      const nextEvents = [...events.filter(e => e.id !== oldEvent.id), json.event].sort(
        (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
      );
      setEvents(nextEvents);
      handleFetchBriefing(true, { events: nextEvents, reminders, emails });
    }
  };

  // Delete Apple Calendar Event via CalDAV
  const handleDeleteEvent = async (eventToDelete: CalendarEvent) => {
    await safeFetchJson('/api/calendar', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: eventToDelete.id,
        title: eventToDelete.title,
        isRecurring: eventToDelete.isRecurring,
      }),
    });
    const nextEvents = events.filter(e => e.id !== eventToDelete.id);
    setEvents(nextEvents);
    handleFetchBriefing(true, { events: nextEvents, reminders, emails });
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
      await safeFetchJson('/api/gmail/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'markRead',
          id: email.id,
          accountEmail: email.accountEmail,
        }),
      });
    } catch {
      setEmails(prev => [email, ...prev]);
      setSelectedEmail(email);
    }
  };

  const upcomingCount = getUpcomingEventIds(events).size;

  const availableCalendars = useMemo(
    () =>
      Array.from(
        new Set(
          events
            .map(e => e.calendarName)
            .filter(c => c && !/holiday|birthday|siri/i.test(c))
        )
      ),
    [events]
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#0A0A0C] text-zinc-100 overflow-x-hidden">
      {/* Top Header */}
      <Header
        onRefresh={handleFullSync}
        isSyncing={isSyncing || isBriefingLoading}
        health={health}
        lastSyncTime={lastSyncTime}
      />

      {/* Mobile Navigation Tabs (< md) */}
      <div className="md:hidden sticky top-[57px] z-20 bg-[#0A0A0C]/90 backdrop-blur-md border-b border-zinc-800/60 px-4 py-2 flex items-center gap-1.5 overflow-x-auto">
        {(
          [
            { id: 'briefing', label: 'Briefing' },
            { id: 'schedule', label: `Schedule (${upcomingCount})` },
            { id: 'tasks', label: `Reminders (${reminders.filter(r => !r.isCompleted).length})` },
            { id: 'mail', label: `Inbox (${emails.length})` },
          ] as Array<{ id: MobileTab; label: string }>
        ).map(tab => (
          <button
            key={tab.id}
            onClick={() => setMobileTab(tab.id)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              mobileTab === tab.id
                ? 'bg-white text-zinc-950'
                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Command Center Container */}
      <main className="flex-1 px-4 md:px-8 pt-4 md:pt-5 pb-20 max-w-7xl mx-auto w-full space-y-5">
        {authBanner && (
          <div
            className={`px-4 py-2.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
              authBanner.type === 'error'
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            }`}
          >
            <span>{authBanner.message}</span>
            <button
              onClick={() => setAuthBanner(null)}
              className="text-[11px] opacity-75 hover:opacity-100 font-medium shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {syncError && (
          <div className="px-4 py-2.5 rounded-xl border bg-rose-500/10 border-rose-500/30 text-rose-300 text-xs flex items-center justify-between gap-3">
            <span>{syncError}</span>
            <button
              onClick={() => setSyncError(null)}
              className="text-[11px] opacity-75 hover:opacity-100 font-medium shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Section 1: Compact Hero AI Daily Briefing + Merged Top 3 Priorities */}
        <section className={mobileTab === 'briefing' ? 'block' : 'hidden md:block'}>
          <DailyBriefingCard
            briefing={briefing}
            isLoading={isBriefingLoading}
          />
        </section>

        {/* Section 2: 3-Column Operational Command Center */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Column 1: Apple Calendar */}
          <div className={`h-full ${mobileTab === 'schedule' ? 'block' : 'hidden md:block'}`}>
            <CalendarTimeline
              events={events}
              isLoading={isSyncing && events.length === 0}
              onOpenNewEventModal={() => setIsEventModalOpen(true)}
              onSelectEvent={evt => setSelectedEvent(evt)}
            />
          </div>

          {/* Column 2: Apple Reminders */}
          <div className={`h-full ${mobileTab === 'tasks' ? 'block' : 'hidden md:block'}`}>
            <RemindersWidget
              reminders={reminders}
              isLoading={isSyncing && reminders.length === 0}
              onToggleTask={handleToggleTask}
              onQuickAddTask={(title) => handleCreateTask(title)}
              onSelectTask={task => setSelectedReminder(task)}
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
                  await safeFetchJson('/api/gmail/accounts', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email }),
                  });
                  await handleFullSync();
                } catch (err: any) {
                  setSyncError(err?.message || 'Failed to disconnect Gmail account');
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

      {/* Quick Add Apple Calendar Event Modal */}
      <NewEventModal
        isOpen={isEventModalOpen}
        onClose={() => setIsEventModalOpen(false)}
        onSubmit={handleCreateEvent}
        availableCalendars={availableCalendars}
      />

      {/* Calendar Event View / Edit / Delete Modal */}
      <EventDetailModal
        event={selectedEvent}
        availableCalendars={availableCalendars}
        onClose={() => setSelectedEvent(null)}
        onUpdate={handleUpdateEvent}
        onDelete={handleDeleteEvent}
      />

      {/* Quick Add Apple Reminder Modal */}
      <NewReminderModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateTask}
        initialTitle={modalTitle}
        initialNotes={modalNotes}
      />

      {/* Edit Existing Reminder Modal */}
      <EditReminderModal
        reminder={selectedReminder}
        onClose={() => setSelectedReminder(null)}
        onSave={handleUpdateTask}
        onMarkComplete={uid => handleToggleTask(uid, true)}
      />

      {/* Live Grounded AI Life Assistant */}
      <LifeAssistantDrawer
        onRemindersMutated={(createdList, needsFullRefresh) => {
          if (needsFullRefresh) {
            handleFullSync();
          } else if (createdList && createdList.length > 0) {
            const titleSet = new Set(createdList.map(c => c.title.trim().toLowerCase()));
            const nextReminders = [
              ...createdList,
              ...reminders.filter(
                r => r.isCompleted || !titleSet.has(r.title.trim().toLowerCase())
              ),
            ];
            setReminders(nextReminders);
            handleFetchBriefing(true, { events, reminders: nextReminders, emails });
          } else {
            handleFullSync();
          }
        }}
        onEventsMutated={(createdList, needsFullRefresh) => {
          if (needsFullRefresh) {
            handleFullSync();
          } else if (createdList && createdList.length > 0) {
            const nextEvents = [...events, ...createdList].sort(
              (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
            );
            setEvents(nextEvents);
            handleFetchBriefing(true, { events: nextEvents, reminders, emails });
          } else {
            handleFullSync();
          }
        }}
      />
    </div>
  );
}
