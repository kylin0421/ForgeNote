import type { CommandJob } from '@/lib/api/commands'

const ACTIVE_STATUSES = new Set(['new', 'queued', 'running'])

export type WorkflowAgentTiming = {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled' | 'unknown'
  started_at?: string | null
  completed_at?: string | null
  duration_seconds?: number | null
  elapsed_seconds?: number | null
}

function finiteSeconds(value: unknown) {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed)
    ? Math.max(0, parsed)
    : null
}

export function elapsedFromTimestamps(
  startedAt?: string | null,
  completedAt?: string | null,
  nowMs = Date.now()
) {
  if (!startedAt) return null
  const start = Date.parse(startedAt)
  const end = completedAt ? Date.parse(completedAt) : nowMs
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return Math.max(0, (end - start) / 1000)
}

export function jobElapsedSeconds(job: CommandJob, nowMs: number) {
  if (job.status === 'new' || job.status === 'queued') return null

  if (!ACTIVE_STATUSES.has(job.status)) {
    const progressDuration = finiteSeconds(job.progress?.duration_seconds)
    if (progressDuration !== null) return progressDuration

    const processingTime = finiteSeconds(job.result_summary?.processing_time)
    if (processingTime !== null) return processingTime
  }

  const progressElapsed = finiteSeconds(job.progress?.elapsed_seconds)
  if (progressElapsed !== null) return progressElapsed

  return elapsedFromTimestamps(
    job.progress?.workflow_started_at || job.created,
    ACTIVE_STATUSES.has(job.status)
      ? null
      : job.progress?.workflow_completed_at || job.updated,
    nowMs
  )
}

export function jobQueueElapsedSeconds(job: CommandJob, nowMs: number) {
  if (job.status !== 'new' && job.status !== 'queued') return null
  return elapsedFromTimestamps(job.created, null, nowMs)
}

export function stepElapsedSeconds(
  agent: WorkflowAgentTiming,
  nowMs: number,
  terminalAt?: string | null
) {
  if (agent.status === 'queued') return null

  if (agent.status === 'running') {
    const elapsed = finiteSeconds(agent.elapsed_seconds)
    if (elapsed !== null) return elapsed
    return elapsedFromTimestamps(agent.started_at, null, nowMs)
  }

  const duration = finiteSeconds(agent.duration_seconds)
  if (duration !== null) return duration

  const elapsed = finiteSeconds(agent.elapsed_seconds)
  if (elapsed !== null) return elapsed

  const completedAt = agent.completed_at || terminalAt
  if (!completedAt) return null

  const timestampElapsed = elapsedFromTimestamps(
    agent.started_at,
    completedAt,
    nowMs
  )
  if (timestampElapsed !== null) return timestampElapsed
  return null
}
