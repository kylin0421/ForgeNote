import { describe, expect, it } from 'vitest'

import type { CommandJob } from '@/lib/api/commands'
import {
  jobElapsedSeconds,
  jobQueueElapsedSeconds,
  stepElapsedSeconds,
  type WorkflowAgentTiming,
} from './timing'

const NOW = Date.parse('2026-07-30T10:00:30.000Z')

function job(overrides: Partial<CommandJob> = {}): CommandJob {
  return {
    job_id: 'command:demo',
    status: 'completed',
    created: '2026-07-30T10:00:00.000Z',
    updated: '2026-07-30T10:00:20.000Z',
    ...overrides,
  }
}

function agent(overrides: Partial<WorkflowAgentTiming> = {}): WorkflowAgentTiming {
  return {
    id: 'worker-agent',
    status: 'completed',
    ...overrides,
  }
}

describe('workflow timing fallbacks', () => {
  it('uses persisted processing time when workflow progress has no timer', () => {
    expect(
      jobElapsedSeconds(
        job({ result_summary: { processing_time: 12.4 } }),
        NOW
      )
    ).toBe(12.4)
  })

  it('uses the live elapsed value even when a running step has no timestamp', () => {
    expect(
      stepElapsedSeconds(
        agent({ status: 'running', elapsed_seconds: 7.2 }),
        NOW
      )
    ).toBe(7.2)
  })

  it('never assigns the workflow total to a step without step timing', () => {
    expect(stepElapsedSeconds(agent(), NOW)).toBeNull()
  })

  it('keeps queued steps unstarted instead of assigning the job timer', () => {
    expect(
      stepElapsedSeconds(agent({ status: 'queued' }), NOW)
    ).toBeNull()
  })

  it('uses only the running step start instead of the workflow start', () => {
    expect(
      stepElapsedSeconds(
        agent({
          status: 'running',
          started_at: '2026-07-30T10:00:25.000Z',
        }),
        NOW
      )
    ).toBe(5)
  })

  it('does not count queue wait as job execution time', () => {
    const queuedJob = job({
      status: 'queued',
      created: '2026-07-30T10:00:00.000Z',
    })

    expect(jobElapsedSeconds(queuedJob, NOW)).toBeNull()
    expect(jobQueueElapsedSeconds(queuedJob, NOW)).toBe(30)
  })

  it('ignores terminal duration fields while a job is still running', () => {
    expect(
      jobElapsedSeconds(
        job({
          status: 'running',
          progress: {
            duration_seconds: 99,
            elapsed_seconds: 6,
          },
        }),
        NOW
      )
    ).toBe(6)
  })

  it('prefers a failed step local elapsed value over timestamps', () => {
    expect(
      stepElapsedSeconds(
        agent({
          status: 'failed',
          started_at: '2026-07-30T10:00:05.000Z',
          elapsed_seconds: 4.5,
        }),
        NOW,
        '2026-07-30T10:00:20.000Z'
      )
    ).toBe(4.5)
  })

  it('freezes a canceled step at the job terminal timestamp', () => {
    const canceledAgent = agent({
      status: 'canceled',
      started_at: '2026-07-30T10:00:05.000Z',
    })
    const terminalAt = '2026-07-30T10:00:13.000Z'

    expect(stepElapsedSeconds(canceledAgent, NOW, terminalAt)).toBe(8)
    expect(
      stepElapsedSeconds(
        canceledAgent,
        Date.parse('2026-07-30T11:00:00.000Z'),
        terminalAt
      )
    ).toBe(8)
  })

  it('does not use the live clock for a terminal step without an end', () => {
    expect(
      stepElapsedSeconds(
        agent({
          status: 'failed',
          started_at: '2026-07-30T10:00:05.000Z',
        }),
        NOW
      )
    ).toBeNull()
  })
})
