export interface DirectorTaskDraft {
  projectId: string
  projectName: string
  projectSource: 'api' | 'local-draft'
  title: string
  description: string
  acceptanceCriteria: readonly string[]
  priority: 'normal' | 'interactive'
}

export interface TaskSubmissionPayload {
  projectId: string
  title: string
  brief: string
  acceptanceCriteria: readonly string[]
  priority: 'normal' | 'interactive'
}

export interface DirectorTaskPreflightProjection {
  url: '/v1/tasks/preflight'
  body: TaskSubmissionPayload
}

export function isProjectSelectionUnavailable(projectId: string, confirmedProjectIds: readonly string[], localDraftIds: readonly string[]): boolean {
  return Boolean(projectId) && !confirmedProjectIds.includes(projectId) && !localDraftIds.includes(projectId)
}

/** Projects the confirmed backend project and the current preflight DTO. */
export function projectTaskRequest(draft: DirectorTaskDraft): DirectorTaskPreflightProjection {
  if (draft.projectSource !== 'api' || !draft.projectId.trim()) throw new Error('project_not_confirmed_by_api')
  const title = draft.title.trim()
  const brief = draft.description.trim()
  const criteria = draft.acceptanceCriteria.map(item => item.trim()).filter(Boolean)
  if (title.length < 3 || title.length > 160 || brief.length < 10 || brief.length > 8_000) throw new Error('task_draft_invalid')
  if (criteria.length < 1 || criteria.length > 12 || criteria.some(item => item.length < 3 || item.length > 500)) throw new Error('acceptance_criteria_count_invalid')
  return {
    url: '/v1/tasks/preflight',
    body: { projectId: draft.projectId, title, brief, acceptanceCriteria: criteria, priority: draft.priority },
  }
}
