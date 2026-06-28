'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Clock3, FileText, Loader2, ListChecks, X, XCircle } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { commandsApi, type CommandJob, type CommandJobLogResponse, type CommandJobStatus } from '@/lib/api/commands'
import { cn } from '@/lib/utils'

const ACTIVE_STATUSES: CommandJobStatus[] = ['running', 'queued', 'new']
const ACTIVE_STATUS_SET = new Set<CommandJobStatus>(ACTIVE_STATUSES)
const FAILED_STATUSES: CommandJobStatus[] = ['failed']
const VISIBLE_STATUSES: CommandJobStatus[] = [...ACTIVE_STATUSES, ...FAILED_STATUSES]
const VISIBLE_STATUS_SET = new Set<CommandJobStatus>(VISIBLE_STATUSES)
const FLOATING_BUTTON_SIZE = 48
const FLOATING_MARGIN = 20

const TEXT = {
  queueTitle: '\u4efb\u52a1\u961f\u5217',
  activeCount: '\u4e2a\u8fdb\u884c\u4e2d',
  failedCount: '\u4e2a\u5931\u8d25',
  noVisibleJobs: '\u5f53\u524d\u6ca1\u6709\u6392\u961f\u3001\u8fdb\u884c\u4e2d\u6216\u5931\u8d25\u4efb\u52a1',
  viewLog: '\u67e5\u770b\u65e5\u5fd7',
  hideLog: '\u6536\u8d77\u65e5\u5fd7',
  logTitle: '\u5931\u8d25\u65e5\u5fd7',
  logLoading: '\u65e5\u5fd7\u52a0\u8f7d\u4e2d...',
  logEmpty: '\u6ca1\u6709\u53ef\u7528\u65e5\u5fd7',
  logLoadFailed: '\u65e5\u5fd7\u52a0\u8f7d\u5931\u8d25',
  dismissFailed: '\u5173\u95ed\u5931\u8d25\u8bb0\u5f55',
  dismissing: '\u5173\u95ed\u4e2d',
  resultDetail: '\u7ed3\u679c\u8be6\u60c5',
  argsDetail: '\u8f93\u5165\u53c2\u6570',
  errorPrefix: '\u9519\u8bef',
}

type FloatingPosition = {
  x: number
  y: number
}

type DragState = {
  pointerId: number
  offsetX: number
  offsetY: number
  startX: number
  startY: number
  dragging: boolean
}

function clampFloatingPosition(position: FloatingPosition) {
  if (typeof window === 'undefined') return position
  const maxX = Math.max(FLOATING_MARGIN, window.innerWidth - FLOATING_BUTTON_SIZE - FLOATING_MARGIN)
  const maxY = Math.max(FLOATING_MARGIN, window.innerHeight - FLOATING_BUTTON_SIZE - FLOATING_MARGIN)

  return {
    x: Math.min(Math.max(FLOATING_MARGIN, position.x), maxX),
    y: Math.min(Math.max(FLOATING_MARGIN, position.y), maxY),
  }
}

function statusLabel(status: CommandJobStatus) {
  const labels: Record<string, string> = {
    new: '\u6392\u961f\u4e2d',
    queued: '\u6392\u961f\u4e2d',
    running: '\u8fdb\u884c\u4e2d',
    completed: '\u5df2\u5b8c\u6210',
    failed: '\u5931\u8d25',
    canceled: '\u5df2\u53d6\u6d88',
    unknown: '\u672a\u77e5',
  }
  return labels[status] || status
}

function commandLabel(command?: string | null) {
  const labels: Record<string, string> = {
    process_source: '\u5904\u7406\u6765\u6e90',
    run_transformation: '\u751f\u6210\u6d1e\u5bdf',
    create_insight: '\u521b\u5efa\u6d1e\u5bdf',
    embed_source: '\u521b\u5efa\u6765\u6e90\u5d4c\u5165',
    embed_note: '\u521b\u5efa\u8d44\u4ea7\u5d4c\u5165',
    embed_insight: '\u521b\u5efa\u6d1e\u5bdf\u5d4c\u5165',
    rebuild_embeddings: '\u91cd\u5efa\u5d4c\u5165',
    generate_podcast: '\u751f\u6210\u64ad\u5ba2',
    collect_learning_resources: '\u641c\u96c6\u5b66\u4e60\u8d44\u6599',
    generate_learning_asset: '\u751f\u6210\u5b66\u4e60\u8d44\u4ea7',
  }
  return command ? labels[command] || command : '\u540e\u53f0\u4efb\u52a1'
}

function shortValue(value: unknown) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  if (text.length <= 36) return text
  return `${text.slice(0, 33)}...`
}

function targetLabel(job: CommandJob) {
  const target = job.target || {}
  if (target.output_kind) return `\u8d44\u4ea7 ${shortValue(target.output_kind)}`
  if (target.goal) return `\u76ee\u6807 ${shortValue(target.goal)}`
  if (target.message) return shortValue(target.message)
  if (target.episode_name) return shortValue(target.episode_name)
  if (target.source_id) return `\u6765\u6e90 ${shortValue(target.source_id)}`
  if (target.note_id) return `\u8d44\u4ea7 ${shortValue(target.note_id)}`
  if (target.insight_id) return `\u6d1e\u5bdf ${shortValue(target.insight_id)}`
  if (target.item_id) return `${target.item_type || '\u9879\u76ee'} ${shortValue(target.item_id)}`
  if (target.rebuild_mode) return `\u6a21\u5f0f ${shortValue(target.rebuild_mode)}`
  return shortValue(job.job_id)
}

function resultSummary(job: CommandJob) {
  const result = job.result_summary || {}
  if (typeof result.chunks_created === 'number') return `${result.chunks_created} \u4e2a chunks`
  if (typeof result.insights_created === 'number') return `${result.insights_created} \u4e2a\u6d1e\u5bdf`
  if (typeof result.resources_found === 'number') return `${result.resources_found} \u6761\u8d44\u6599`
  if (typeof result.result_title === 'string') return result.result_title
  if (typeof result.jobs_submitted === 'number') {
    const total = typeof result.total_items === 'number' ? ` / ${result.total_items}` : ''
    return `${result.jobs_submitted}${total} \u4e2a\u5b50\u4efb\u52a1`
  }
  if (typeof result.processing_time === 'number') return `${result.processing_time.toFixed(1)}s`
  return ''
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatCommandLog(log?: CommandJobLogResponse, fallbackError?: string | null) {
  const sections: string[] = []
  const lines = (log?.log || []).filter((line) => line.trim().length > 0)
  if (lines.length > 0) {
    sections.push(lines.join('\n'))
  } else if (fallbackError) {
    sections.push(`${TEXT.errorPrefix}:\n${fallbackError}`)
  }

  if (log?.result && Object.keys(log.result).length > 0) {
    sections.push(`${TEXT.resultDetail}:\n${safeJsonStringify(log.result)}`)
  }

  if (log?.args && Object.keys(log.args).length > 0) {
    sections.push(`${TEXT.argsDetail}:\n${safeJsonStringify(log.args)}`)
  }

  return sections.join('\n\n') || TEXT.logEmpty
}

function progressValue(job: CommandJob) {
  const result = job.result_summary || {}
  if (
    typeof result.jobs_submitted === 'number' &&
    typeof result.total_items === 'number' &&
    result.total_items > 0
  ) {
    return Math.min(100, Math.round((result.jobs_submitted / result.total_items) * 100))
  }
  if (job.status === 'new' || job.status === 'queued') return 8
  return null
}

function StatusIcon({ status }: { status: CommandJobStatus }) {
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-primary" />
  if (status === 'failed') return <XCircle className="h-4 w-4 text-destructive" />
  return <Clock3 className="h-4 w-4 text-muted-foreground" />
}

function sortVisibleJobs(a: CommandJob, b: CommandJob) {
  const statusRank = (status: CommandJobStatus) => {
    if (status === 'running') return 0
    if (status === 'queued') return 1
    if (status === 'new') return 2
    if (status === 'failed') return 3
    return 3
  }
  const rankDiff = statusRank(a.status) - statusRank(b.status)
  if (rankDiff !== 0) return rankDiff
  const aTime = Date.parse(a.updated || a.created || '') || 0
  const bTime = Date.parse(b.updated || b.created || '') || 0
  return bTime - aTime
}

async function listVisibleJobs() {
  const batches = await Promise.all(
    VISIBLE_STATUSES.map((status_filter) =>
      commandsApi.listJobs({ status_filter, limit: 50 })
    )
  )
  const unique = new Map<string, CommandJob>()
  for (const job of batches.flat()) {
    if (VISIBLE_STATUS_SET.has(job.status)) {
      unique.set(job.job_id, job)
    }
  }
  return Array.from(unique.values()).sort(sortVisibleJobs)
}

function JobRow({
  job,
  isCanceling,
  isDismissing,
  onCancel,
  onDismiss,
}: {
  job: CommandJob
  isCanceling: boolean
  isDismissing: boolean
  onCancel: (job: CommandJob) => void
  onDismiss: (job: CommandJob) => void
}) {
  const [showLog, setShowLog] = useState(false)
  const isFailed = job.status === 'failed'
  const value = progressValue(job)
  const summary = resultSummary(job)
  const cancelLabel = job.status === 'running' ? '\u7ec8\u6b62' : '\u53d6\u6d88'
  const {
    data: commandLog,
    isError: logFailed,
    isFetching: logFetching,
  } = useQuery({
    queryKey: ['commands', 'job-log', job.job_id],
    queryFn: () => commandsApi.getJobLog(job.job_id),
    enabled: isFailed && showLog,
    staleTime: 30_000,
  })

  return (
    <div className={cn('rounded-md border bg-background p-3', isFailed && 'border-destructive/30')}>
      <div className="flex items-start gap-3">
        <StatusIcon status={job.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{commandLabel(job.command)}</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {targetLabel(job)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={cn(
                  'rounded-md border px-2 py-0.5 text-xs',
                  isFailed ? 'border-destructive/30 text-destructive' : 'border-primary/30 text-primary'
                )}
              >
                {statusLabel(job.status)}
              </span>
              {isFailed ? (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => setShowLog((value) => !value)}
                    title={showLog ? TEXT.hideLog : TEXT.viewLog}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {showLog ? TEXT.hideLog : TEXT.viewLog}
                    {showLog ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    disabled={isDismissing}
                    onClick={() => onDismiss(job)}
                    title={TEXT.dismissFailed}
                    aria-label={TEXT.dismissFailed}
                  >
                    {isDismissing ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <X className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                  disabled={isCanceling}
                  onClick={() => onCancel(job)}
                  title={cancelLabel}
                >
                  {isCanceling ? (
                    <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <XCircle className="mr-1 h-3.5 w-3.5" />
                  )}
                  {cancelLabel}
                </Button>
              )}
            </div>
          </div>

          {!isFailed && (
            <div className="mt-3">
              {value === null ? (
                <div className="h-2 overflow-hidden rounded-full bg-primary/20">
                  <div className="h-full w-1/2 animate-pulse rounded-full bg-primary" />
                </div>
              ) : (
                <Progress value={value} className="h-2" />
              )}
            </div>
          )}

          {isFailed && job.error_message ? (
            <p className="mt-2 break-words text-xs leading-5 text-destructive">
              {job.error_message}
            </p>
          ) : (
            summary && (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {summary}
              </p>
            )
          )}

          {isFailed && showLog && (
            <div className="mt-3 overflow-hidden rounded-md border bg-muted/30">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <p className="text-xs font-medium">{TEXT.logTitle}</p>
                {logFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              </div>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-5 text-muted-foreground">
                {logFetching && !commandLog
                  ? TEXT.logLoading
                  : logFailed
                    ? TEXT.logLoadFailed
                    : formatCommandLog(commandLog, job.error_message)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function JobsFloatingPanel() {
  const [open, setOpen] = useState(false)
  const [cancelingJobId, setCancelingJobId] = useState<string | null>(null)
  const [dismissingJobId, setDismissingJobId] = useState<string | null>(null)
  const [position, setPosition] = useState<FloatingPosition | null>(null)
  const [panelSide, setPanelSide] = useState<'left' | 'right'>('right')
  const dragStateRef = useRef<DragState | null>(null)
  const suppressClickRef = useRef(false)
  const queryClient = useQueryClient()
  const { data: jobs = [], isFetching } = useQuery({
    queryKey: ['commands', 'visible-jobs'],
    queryFn: listVisibleJobs,
    refetchInterval: 3000,
  })
  const activeCount = jobs.filter((job) => ACTIVE_STATUS_SET.has(job.status)).length
  const failedCount = jobs.filter((job) => job.status === 'failed').length
  const cancelJob = useMutation({
    mutationFn: (job: CommandJob) => commandsApi.cancelJob(job.job_id),
    onMutate: (job) => {
      setCancelingJobId(job.job_id)
    },
    onSuccess: async (result, job) => {
      toast.success(
        result.cancelled
          ? job.status === 'running'
            ? '\u5df2\u53d1\u51fa\u7ec8\u6b62\u4efb\u52a1\u7684\u8bf7\u6c42'
            : '\u5df2\u53d6\u6d88\u6392\u961f\u4efb\u52a1'
          : '\u8be5\u4efb\u52a1\u5df2\u7ed3\u675f\uff0c\u65e0\u9700\u53d6\u6d88'
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['commands'] }),
        queryClient.invalidateQueries({ queryKey: ['sources'] }),
        queryClient.invalidateQueries({ queryKey: ['notes'] }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notebooks }),
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.podcastEpisodes }),
      ])
    },
    onError: (error) => {
      console.error('Failed to cancel command job:', error)
      toast.error('\u53d6\u6d88\u4efb\u52a1\u5931\u8d25')
    },
    onSettled: () => {
      setCancelingJobId(null)
    },
  })
  const dismissJob = useMutation({
    mutationFn: (job: CommandJob) => commandsApi.dismissJob(job.job_id),
    onMutate: (job) => {
      setDismissingJobId(job.job_id)
    },
    onSuccess: async (result) => {
      toast.success(
        result.dismissed
          ? '\u5df2\u5173\u95ed\u5931\u8d25\u8bb0\u5f55'
          : '\u53ea\u6709\u5931\u8d25\u4efb\u52a1\u53ef\u4ee5\u5173\u95ed'
      )
      await queryClient.invalidateQueries({ queryKey: ['commands'] })
    },
    onError: (error) => {
      console.error('Failed to dismiss command job:', error)
      toast.error('\u5173\u95ed\u5931\u8d25\u8bb0\u5f55\u5931\u8d25')
    },
    onSettled: () => {
      setDismissingJobId(null)
    },
  })

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const drag = dragStateRef.current
      if (!drag || event.pointerId !== drag.pointerId) return

      const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY)
      if (moved > 3) {
        drag.dragging = true
      }

      const nextPosition = clampFloatingPosition({
        x: event.clientX - drag.offsetX,
        y: event.clientY - drag.offsetY,
      })
      setPosition(nextPosition)
      setPanelSide(nextPosition.x < window.innerWidth / 2 ? 'left' : 'right')
    }

    const handlePointerUp = (event: PointerEvent) => {
      const drag = dragStateRef.current
      if (!drag || event.pointerId !== drag.pointerId) return

      if (drag.dragging) {
        suppressClickRef.current = true
        window.setTimeout(() => {
          suppressClickRef.current = false
        }, 0)
      }
      dragStateRef.current = null
    }

    const handleResize = () => {
      setPosition((current) => {
        if (!current) return current
        const nextPosition = clampFloatingPosition(current)
        setPanelSide(nextPosition.x < window.innerWidth / 2 ? 'left' : 'right')
        return nextPosition
      })
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  const handlePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return

    const rect = event.currentTarget.getBoundingClientRect()
    const currentPosition = clampFloatingPosition({
      x: rect.left,
      y: rect.top,
    })
    setPosition(currentPosition)
    setPanelSide(currentPosition.x < window.innerWidth / 2 ? 'left' : 'right')
    dragStateRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleFloatingClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (suppressClickRef.current) {
      event.preventDefault()
      event.stopPropagation()
      return
    }
    setOpen((value) => !value)
  }

  const floatingStyle = position
    ? { left: position.x, top: position.y }
    : { bottom: FLOATING_MARGIN, right: FLOATING_MARGIN }

  return (
    <div className="fixed z-40" style={floatingStyle}>
      {open && (
        <div
          className={cn(
            'absolute bottom-[calc(100%+0.75rem)] w-[min(calc(100vw-2rem),24rem)] rounded-lg border bg-background shadow-xl',
            panelSide === 'left' ? 'left-0' : 'right-0'
          )}
        >
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <h2 className="text-sm font-semibold">{TEXT.queueTitle}</h2>
              <p className="text-xs text-muted-foreground">
                {activeCount} {TEXT.activeCount} / {failedCount} {TEXT.failedCount}
              </p>
            </div>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="max-h-[26rem] space-y-2 overflow-y-auto p-3">
            {jobs.length === 0 ? (
              <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
                {TEXT.noVisibleJobs}
              </div>
            ) : (
              jobs.map((job) => (
                <JobRow
                  key={job.job_id}
                  job={job}
                  isCanceling={cancelingJobId === job.job_id}
                  isDismissing={dismissingJobId === job.job_id}
                  onCancel={(selectedJob) => cancelJob.mutate(selectedJob)}
                  onDismiss={(selectedJob) => dismissJob.mutate(selectedJob)}
                />
              ))
            )}
          </div>
        </div>
      )}

      <Button
        type="button"
        size="lg"
        className="relative h-12 w-12 cursor-move touch-none rounded-full shadow-lg"
        onPointerDown={handlePointerDown}
        onClick={handleFloatingClick}
        aria-label={TEXT.queueTitle}
      >
        {isFetching && jobs.length > 0 ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          <ListChecks className="h-5 w-5" />
        )}
        {jobs.length > 0 && (
          <span
            className={cn(
              'absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-medium text-white',
              failedCount > 0 ? 'bg-destructive' : 'bg-emerald-600'
            )}
          >
            {jobs.length}
          </span>
        )}
      </Button>
    </div>
  )
}
