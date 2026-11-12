'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Header } from '@/components/Header';
import { DailyBriefingCard } from '@/components/DailyBriefingCard';
import { TopPrioritiesWidget } from '@/components/TopPrioritiesWidget';
import { CalendarTimeline } from '@/components/CalendarTimeline';
import { RemindersWidget } from '@/components/RemindersWidget';
import { GmailTriageWidget } from '@/components/GmailTriageWidget';
import { NewReminderModal } from '@/components/NewReminderModal';
import { LifeAssistantDrawer } from '@/components/LifeAssistantDrawer';
import { CalendarEvent, ReminderTask, EmailThread, DailyBriefing, SyncHealthStatus } from '@/lib/types';

export default function DashboardPage() {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [reminders, setReminders] = useState<ReminderTask[]>([]);
  const [emails, setEmails] = useState<EmailThread[]>([]);
  const [briefing, setBriefing] = useState<DailyBriefing | null>(null);
  const [health, setHealth] = useState<SyncHealthStatus | undefined>(undefined);
  const [lastSyncTime, setLastSyncTime] = useState<string>('');

  const [isSyncing, setIsSyncing] = useState<boolean>(true);
  const [isBriefingLoading, setIsBriefingLoading] = useState<boolean>(false);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState('');
  const [modalNotes, setModalNotes] = useState('');

  // 1. Initial Load & Synchronization
  const handleSync = useCallback(async () => {
    try {
      setIsSyncing(true);
      const res = await fetch('/api/sync');
      const json = await res.json();

      if (json.success && json.data) {
        setEvents(json.data.events || []);
        setReminders(json.data.reminders || []);
        setEmails(json.data.emails || []);
        setHealth(json.data.health);
        setLastSyncTime(json.data.health?.lastSync || new Date().toISOString());
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

  useEffect(() => {
    handleSync();
    handleFetchBriefing(false);
  }, [handleSync, handleFetchBriefing]);

  // 3. Toggle Reminder State (Two-Way CalDAV Write-Back)
  const handleToggleTask = async (uid: string, nextStatus: boolean) => {
    // Optimistic UI update
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
      // Revert if failed
      setReminders(prev =>
        prev.map(t => (t.uid === uid ? { ...t, isCompleted: !nextStatus } : t))
      );
    }
  };

  // 4. Create New Task in Apple Reminders via CalDAV
  const handleCreateTask = async (title: string, dueDate?: string, notes?: string) => {
    const res = await fetch('/api/reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, dueDate, notes }),
    });

    const json = await res.json();
    if (json.success && json.uid) {
      const newTask: ReminderTask = {
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

  // 5. Convert Email to Reminder Workflow
  const handleConvertToTask = (email: EmailThread) => {
    setModalTitle(`Follow up: ${email.subject}`);
    setModalNotes(`From: ${email.senderName} (${email.senderEmail})\n\nSnippet: ${email.snippet}`);
    setIsModalOpen(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#09090b] text-zinc-100">
      {/* Top Header */}
      <Header
        onRefresh={handleSync}
        isSyncing={isSyncing}
        health={health}
        lastSyncTime={lastSyncTime}
      />

      {/* Main Command Center Container */}
      <main className="flex-1 px-4 md:px-8 py-6 max-w-7xl mx-auto w-full space-y-6">
        {/* Section 1: Hero AI Daily Briefing */}
        <section>
          <DailyBriefingCard
            briefing={briefing}
            isLoading={isBriefingLoading}
            onRegenerate={() => handleFetchBriefing(true)}
          />
        </section>

        {/* Section 2: Top 3 Priorities for Today */}
        <section>
          <TopPrioritiesWidget briefing={briefing} />
        </section>

        {/* Section 3: 3-Column Operational Command Center */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Column 1: Apple Calendar */}
          <div className="h-full">
            <CalendarTimeline events={events} isLoading={isSyncing && events.length === 0} />
          </div>

          {/* Column 2: Apple Reminders */}
          <div className="h-full">
            <RemindersWidget
              reminders={reminders}
              isLoading={isSyncing && reminders.length === 0}
              onToggleTask={handleToggleTask}
              onOpenNewTaskModal={() => {
                setModalTitle('');
                setModalNotes('');
                setIsModalOpen(true);
              }}
            />
          </div>

          {/* Column 3: Gmail Priority Triage */}
          <div className="h-full">
            <GmailTriageWidget
              emails={emails}
              isLoading={isSyncing && emails.length === 0}
              onConvertToTask={handleConvertToTask}
              health={health?.gmail}
            />
          </div>
        </section>
      </main>

      {/* Quick Add Apple Reminder Modal */}
      <NewReminderModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateTask}
        initialTitle={modalTitle}
        initialNotes={modalNotes}
      />

      {/* Natural Language Life Assistant */}
      <LifeAssistantDrawer />
    </div>
  );
}
