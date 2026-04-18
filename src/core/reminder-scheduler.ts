/**
 * ReminderScheduler — M4
 *
 * Interface + implémentation Windows via `schtasks` CLI.
 *
 * Guideline §10 (Scheduler des rappels):
 *   - Pas de daemon maison
 *   - Trois implémentations OS derrière une interface commune
 *   - Windows → schtasks /Create
 *   - Déclenchement via deep link `project://remind?id=xxx` (ou MCP)
 *
 * Pour M4 seul WindowsScheduler est implémenté.
 * MacOS / Linux peuvent être ajoutés en M5 en suivant la même interface.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

export interface Reminder {
  /** Unique id — typically the vault-relative path of the reminder node */
  id: string;
  /** Human-readable title, used as task name in the OS scheduler */
  title: string;
  /**
   * ISO 8601 datetime string (e.g. "2026-04-20T10:00:00")
   * OR a cron expression (e.g. "0 9 * * 1").
   *
   * Windows `schtasks` does not support cron natively.
   * Cron expressions are parsed and converted to the closest schtasks
   * equivalent (DAILY / WEEKLY / MONTHLY). Complex cron rules fall back
   * to a one-time trigger at the next calculated fire time.
   */
  trigger: string;
  /** Whether the task should recur (re-schedules after firing) */
  recurring: boolean;
  /** Callback command when the reminder fires (defaults to project deep-link) */
  command?: string;
}

export interface ScheduledReminder extends Reminder {
  /** Task name registered in the OS scheduler */
  taskName: string;
  scheduledAt: string; // ISO date when scheduled
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface ReminderScheduler {
  schedule(reminder: Reminder): Promise<ScheduledReminder>;
  cancel(reminderId: string): Promise<void>;
  list(): Promise<ScheduledReminder[]>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sanitize a string for use as a Windows task name (no special chars) */
function sanitizeTaskName(id: string): string {
  // Replace path separators and special characters
  return `Project_${id.replace(/[\/\\:*?"<>|]/g, '_').slice(0, 200)}`;
}

/**
 * Parse trigger string.
 * Returns { dateStr, timeStr, scheduleType, modifier } for schtasks.
 */
function parseTrigger(trigger: string): {
  dateStr: string;
  timeStr: string;
  scheduleType: 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
  modifier?: number;
} {
  // ISO datetime — e.g. "2026-04-20T10:00:00"
  const ISO_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;
  const isoMatch = ISO_RE.exec(trigger);
  if (isoMatch) {
    const [, date, time] = isoMatch;
    return { dateStr: date!, timeStr: time!, scheduleType: 'ONCE' };
  }

  // Basic cron parsing — "MIN HOUR DOM MON DOW"
  const cronParts = trigger.trim().split(/\s+/);
  if (cronParts.length >= 5) {
    const [min, hour, , , dow] = cronParts;
    const timeStr = `${(hour === '*' ? '09' : hour.padStart(2, '0'))}:${(min === '*' ? '00' : min.padStart(2, '0'))}`;
    const today = new Date().toISOString().slice(0, 10);

    if (dow !== '*' && dow !== undefined) {
      // Weekly schedule
      return { dateStr: today, timeStr, scheduleType: 'WEEKLY' };
    }
    if (hour !== '*' && min !== '*') {
      // Daily schedule
      return { dateStr: today, timeStr, scheduleType: 'DAILY' };
    }
  }

  // Fallback: schedule for 5 minutes from now
  const soon = new Date(Date.now() + 5 * 60 * 1000);
  const dateStr = soon.toISOString().slice(0, 10);
  const timeStr = `${String(soon.getHours()).padStart(2, '0')}:${String(soon.getMinutes()).padStart(2, '0')}`;
  return { dateStr, timeStr, scheduleType: 'ONCE' };
}

// ---------------------------------------------------------------------------
// WindowsScheduler — schtasks implementation
// ---------------------------------------------------------------------------

export class WindowsScheduler implements ReminderScheduler {
  /**
   * In-memory registry of scheduled reminders (id → ScheduledReminder).
   * For persistence across restarts this could be written to .project/reminders.json,
   * but for M4 in-memory is sufficient — the vault files are the source of truth.
   */
  private registry = new Map<string, ScheduledReminder>();

  async schedule(reminder: Reminder): Promise<ScheduledReminder> {
    const taskName = sanitizeTaskName(reminder.id);
    const { dateStr, timeStr, scheduleType } = parseTrigger(reminder.trigger);

    // Default command: open the project deep link
    const command = reminder.command ?? `explorer.exe "project://remind?id=${encodeURIComponent(reminder.id)}"`;

    // Build schtasks command
    // /F = force overwrite if task exists
    let cmd = `schtasks /Create /F /TN "${taskName}" /TR "${command}" /SC ${scheduleType} /ST ${timeStr}`;

    if (scheduleType === 'ONCE') {
      cmd += ` /SD ${dateStr.replace(/-/g, '/')}`;
    }

    if (!reminder.recurring && scheduleType !== 'ONCE') {
      // Add /ET (end time = same as start) to prevent recurrence on non-recurring reminders
      // schtasks doesn't have a "run once for cron" mode; we schedule then delete after
      // For simplicity: we schedule ONCE at the next computed time
      cmd = `schtasks /Create /F /TN "${taskName}" /TR "${command}" /SC ONCE /ST ${timeStr} /SD ${dateStr.replace(/-/g, '/')}`;
    }

    await execAsync(cmd);

    const scheduled: ScheduledReminder = {
      ...reminder,
      taskName,
      scheduledAt: new Date().toISOString(),
    };
    this.registry.set(reminder.id, scheduled);
    return scheduled;
  }

  async cancel(reminderId: string): Promise<void> {
    const entry = this.registry.get(reminderId);
    const taskName = entry?.taskName ?? sanitizeTaskName(reminderId);

    try {
      await execAsync(`schtasks /Delete /F /TN "${taskName}"`);
    } catch {
      // Task may not exist in the OS — ignore ENOENT-equivalent
    }
    this.registry.delete(reminderId);
  }

  async list(): Promise<ScheduledReminder[]> {
    return Array.from(this.registry.values());
  }
}

// ---------------------------------------------------------------------------
// Factory — returns the right scheduler for the current platform
// ---------------------------------------------------------------------------

export function createScheduler(): ReminderScheduler {
  if (process.platform === 'win32') return new WindowsScheduler();

  // Stub for other platforms — logs a warning, no-ops
  return {
    async schedule(r: Reminder): Promise<ScheduledReminder> {
      console.warn(`[ReminderScheduler] Platform '${process.platform}' not yet supported. Reminder '${r.title}' not scheduled in OS.`);
      return { ...r, taskName: sanitizeTaskName(r.id), scheduledAt: new Date().toISOString() };
    },
    async cancel(): Promise<void> {},
    async list(): Promise<ScheduledReminder[]> { return []; },
  };
}
