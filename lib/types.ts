export interface CalendarEvent {
  id: string;
  title: string;
  calendarName: string;
  calendarColor?: string;
  startTime: string; // ISO string
  endTime: string;   // ISO string
  isAllDay: boolean;
  location?: string;
  description?: string;
  url?: string;
}

export interface ReminderTask {
  id: string;
  uid: string;
  title: string;
  listName: string;
  isCompleted: boolean;
  priority: 0 | 1 | 5 | 9; // 0=None, 1=High, 5=Med, 9=Low
  dueDate?: string;        // ISO string
  completedAt?: string;
  notes?: string;
}

export interface EmailThread {
  id: string;
  threadId: string;
  accountEmail?: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  receivedAt: string;
  snippet: string;
  isUnread: boolean;
  isImportant: boolean;
  aiSummary?: string;
  isActionable?: boolean;
  extractedDeadline?: string;
  urgencyScore?: number; // 1 to 5
}

export interface ConnectedGmailAccount {
  email: string;
  refreshToken: string;
  addedAt: string;
}

export interface ActionProposal {
  id: string;
  sourceType: 'EMAIL' | 'CALENDAR';
  sourceId: string;
  proposedTitle: string;
  proposedDueDate?: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  sourceSnippet: string;
  status: 'PENDING' | 'APPROVED' | 'DISMISSED';
}

export interface DailyBriefing {
  id: string;
  briefingDate: string; // YYYY-MM-DD
  generatedAt: string;  // ISO string
  headline: string;
  topPriorities: Array<{
    rank: number;
    title: string;
    reason: string;
    source: 'CALENDAR' | 'REMINDER' | 'GMAIL';
  }>;
  agendaSummary: string;
  emailHighlights: string;
  warningsOrOverdue: string[];
  suggestedPreparation: string;
  fullMarkdown: string;
  lastSyncTimestamp: string;
}

export interface SyncHealthStatus {
  appleCalendar: { status: 'OK' | 'ERROR' | 'PENDING'; lastSync?: string; message?: string };
  appleReminders: { status: 'OK' | 'ERROR' | 'PENDING'; lastSync?: string; message?: string };
  gmail: { status: 'OK' | 'ERROR' | 'PENDING'; lastSync?: string; message?: string; accounts?: string[] };
  aiEngine: { status: 'OK' | 'ERROR' | 'PENDING'; lastSync?: string; message?: string };
}
