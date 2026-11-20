export type ConfirmedTaskStatus = 'RUNNING' | 'WAITING' | 'COMPLETED' | 'FAILED' | 'BLOCKED';
export type IncomingTaskStatus = ConfirmedTaskStatus | 'UNVERIFIED' | 'NOT_RUN' | 'UNKNOWN';

/**
 * `confirmed` is supplied by the UI adapter only when a server snapshot and
 * Directory employee mapping agree. The scene still validates identity/status.
 */
export interface EmployeeTaskState {
  readonly employeeId: string;
  readonly status: IncomingTaskStatus;
  readonly confirmed: boolean;
}

export type ExistingCharacterStatus = 'working' | 'idle' | 'blocked';

const allowed = new Set<ConfirmedTaskStatus>(['RUNNING', 'WAITING', 'COMPLETED', 'FAILED', 'BLOCKED']);

export function readConfirmedEmployeeStates(
  records: readonly EmployeeTaskState[] | undefined,
  knownEmployeeIds: ReadonlySet<string>,
): ReadonlyMap<string, ConfirmedTaskStatus> {
  const result = new Map<string, ConfirmedTaskStatus>();
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const record of records ?? []) {
    if (!record || typeof record.employeeId !== 'string' || !record.employeeId || !knownEmployeeIds.has(record.employeeId)) continue;
    if (duplicates.has(record.employeeId)) continue;
    if (seen.has(record.employeeId)) {
      result.delete(record.employeeId);
      duplicates.add(record.employeeId);
      continue;
    }
    seen.add(record.employeeId);
    if (record.confirmed === true && allowed.has(record.status as ConfirmedTaskStatus)) {
      result.set(record.employeeId, record.status as ConfirmedTaskStatus);
    }
  }
  return result;
}

/** Map to already supported character packs while preserving raw task state separately. */
export function statusAppearance(status: ConfirmedTaskStatus | undefined): ExistingCharacterStatus | undefined {
  if (status === 'RUNNING') return 'working';
  if (status === 'FAILED' || status === 'BLOCKED') return 'blocked';
  if (status === 'WAITING' || status === 'COMPLETED') return 'idle';
  return undefined;
}

export function statusBadgeVisual(status: ConfirmedTaskStatus) {
  const color = status === 'RUNNING' ? '#256c55'
    : status === 'WAITING' ? '#386985'
      : status === 'COMPLETED' ? '#55733f'
        : status === 'FAILED' ? '#9a3c38' : '#a05d20';
  return { label: status, color } as const;
}
