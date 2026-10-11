import type {AuditEntry} from './api';

function bounded(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length)}…` : value;
}

export function auditActionLabel(action: string): string {
  if (action === 'CHANGE_ROLE') return 'Role changed';
  if (action === 'MODERATE_PROJECT') return 'Project reviewed';
  return bounded(action, 80) || 'Unknown action';
}

/** Audit JSON is historical data, not HTML or a trusted rendering specification. */
export function auditDetails(entry: Pick<AuditEntry, 'action' | 'details'>): string[] {
  if (entry.details.length > 8000) return ['Details are too long to display.'];
  let value: unknown;
  try { value = JSON.parse(entry.details); } catch { return ['Details are unavailable.']; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Details are unavailable.'];
  const data = value as Record<string, unknown>;
  if (entry.action === 'CHANGE_ROLE') {
    const roles: Record<string, string> = {STUDENT: 'Student', FACULTY: 'Faculty', ADMIN: 'Administrator'};
    return typeof data.role === 'string' && Object.hasOwn(roles, data.role) ? [`New role: ${roles[data.role]}`] : ['Role details are unavailable.'];
  }
  if (entry.action === 'MODERATE_PROJECT') {
    const states: Record<string, string> = {APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', HIDDEN: 'Hidden'};
    const result: string[] = [];
    if (typeof data.status === 'string' && Object.hasOwn(states, data.status)) result.push(`Decision: ${states[data.status]}`);
    if (typeof data.expectedVersion === 'number' && Number.isSafeInteger(data.expectedVersion) && data.expectedVersion >= 0) result.push(`Reviewed version: ${data.expectedVersion}`);
    if (typeof data.feedback === 'string' && data.feedback.trim()) result.push(`Feedback: ${bounded(data.feedback.trim(), 500)}`);
    return result.length ? result : ['Review details are unavailable.'];
  }
  return ['No structured details are available for this action.'];
}
