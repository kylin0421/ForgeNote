'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Activity,
  ArrowRight,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  ExternalLink,
  FileCheck2,
  ListChecks,
  Loader2,
  Radio,
  Route,
  SearchCheck,
  ShieldCheck,
  Sparkles,
  TimerReset,
  XCircle,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { type CommandJob, type CommandJobStatus } from '@/lib/api/commands'
import { cn } from '@/lib/utils'
import {
  jobElapsedSeconds,
  jobQueueElapsedSeconds,
  stepElapsedSeconds,
} from '@/lib/workflow/timing'

type AgentStep = {
  id: string
  name: string
  role: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'canceled' | 'unknown'
  started_at?: string | null
  completed_at?: string | null
  duration_seconds?: number | null
  elapsed_seconds?: number | null
}

export type WorkflowFilter = 'active' | 'all' | 'completed' | 'failed'

const ACTIVE_STATUSES = new Set<CommandJobStatus>(['new', 'queued', 'running'])

const COMMAND_LABELS: Record<string, string> = {
  collect_learning_resources: '画像驱动的资料搜集',
  generate_learning_asset: '个性化学习资产生成',
  process_source: '资料解析与知识化',
  generate_podcast: '学习播客生成',
  run_transformation: '资料洞察生成',
  create_insight: '知识洞察提取',
  embed_source: '来源语义索引',
  embed_note: '学习资产语义索引',
  rebuild_embeddings: '智能检索索引重建',
}

const LEARNING_AGENTS = [
  {
    id: 'profile-agent',
    name: '学习画像智能体',
    role: '从自然语言对话中抽取画像特征并持续更新学生状态',
  },
  {
    id: 'curriculum-agent',
    name: '课程结构智能体',
    role: '把课程内容拆成可学习、可评估的知识单元',
  },
  {
    id: 'collector-agent',
    name: '资源搜集智能体',
    role: '搜集候选学习资料，并保留采纳、拒绝或上传资料的选择权',
  },
  {
    id: 'resource-agent',
    name: '资源生成智能体',
    role: '结合采纳资料生成讲解、导图、阅读材料与代码实操',
  },
  {
    id: 'practice-agent',
    name: '练习实训智能体',
    role: '生成可交互 Quiz、代码实操和项目化练习',
  },
  {
    id: 'path-agent',
    name: '路径规划智能体',
    role: '依据画像、资源和掌握度规划动态学习路径',
  },
  {
    id: 'tutor-agent',
    name: '智能辅导智能体',
    role: '提供即时答疑、错误定位和下一步学习引导',
  },
  {
    id: 'evaluation-agent',
    name: '学习评估智能体',
    role: '根据行为线索评估学习效果并给出调整建议',
  },
  {
    id: 'safety-agent',
    name: '安全校验智能体',
    role: '负责防幻觉、引用一致性和内容安全过滤',
  },
] as const

function commandLabel(command?: string | null) {
  return command ? COMMAND_LABELS[command] || command : '后台协作任务'
}

function statusLabel(status: CommandJobStatus) {
  return {
    new: '等待调度',
    queued: '排队中',
    running: '进行中',
    completed: '已完成',
    failed: '失败',
    canceled: '已取消',
    unknown: '未知',
  }[status]
}

function statusClasses(status: CommandJobStatus) {
  if (status === 'running') return 'border-primary/30 bg-primary/10 text-primary'
  if (status === 'completed') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (status === 'failed') return 'border-destructive/30 bg-destructive/10 text-destructive'
  return 'border-border bg-muted/50 text-muted-foreground'
}

function formatDate(value?: string | null) {
  if (!value) return '时间未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatDuration(value?: number | null, unavailableLabel = '未记录') {
  if (value === null || value === undefined || !Number.isFinite(value)) return unavailableLabel
  const seconds = Math.max(0, Math.round(value))
  if (seconds < 1) return '< 1 秒'
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes} 分 ${remainingSeconds} 秒`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}

function jobTimingSummary(job: CommandJob, nowMs: number) {
  if (job.status === 'new' || job.status === 'queued') {
    return `已等待 ${formatDuration(jobQueueElapsedSeconds(job, nowMs), '时间未知')}`
  }
  if (job.status === 'running') {
    return `已运行 ${formatDuration(jobElapsedSeconds(job, nowMs), '计时同步中')}`
  }
  return `总耗时 ${formatDuration(jobElapsedSeconds(job, nowMs))}`
}

function stepTimingSummary(agent: AgentStep, job: CommandJob, nowMs: number) {
  if (agent.status === 'queued') return '待运行'
  const elapsed = stepElapsedSeconds(agent, nowMs, job.updated)
  if (agent.status === 'running') {
    return `已运行 ${formatDuration(elapsed, '计时同步中')}`
  }
  return `耗时 ${formatDuration(elapsed)}`
}

function shortValue(value: unknown, limit = 68) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized
}

function jobTarget(job: CommandJob) {
  const target = job.target || {}
  return (
    shortValue(target.goal) ||
    shortValue(target.message) ||
    shortValue(target.output_kind) ||
    shortValue(target.episode_name) ||
    shortValue(target.source_id) ||
    shortValue(job.job_id)
  )
}

function fallbackAgents(job: CommandJob): AgentStep[] {
  const status: AgentStep['status'] =
    job.status === 'new' || job.status === 'queued'
      ? 'queued'
      : job.status === 'running' ||
          job.status === 'completed' ||
          job.status === 'failed' ||
          job.status === 'canceled'
        ? job.status
        : 'unknown'

  return [
    {
      id: `${job.job_id}:task-status`,
      name: '后台任务状态',
      role: '该任务未上报步骤级遥测；这里只反映任务整体状态，不代表多 Agent 执行记录。',
      status,
    },
  ]
}

function jobAgents(job: CommandJob): AgentStep[] {
  const steps = job.progress?.steps
  if (!steps?.length) return fallbackAgents(job)
  if (job.status !== 'failed' && job.status !== 'canceled') return steps
  const terminalStatus = job.status
  return steps.map((step) => (
    step.status === 'running'
      ? {
          ...step,
          status: terminalStatus,
          completed_at: step.completed_at || job.updated || null,
        }
      : step
  ))
}

function stepTelemetryLabel(job: CommandJob) {
  const count = job.progress?.steps?.length
  return count ? `${count} 个 Agent` : '无步骤遥测'
}

function jobPercent(job: CommandJob): number | null {
  if (job.status === 'completed') return 100
  if (job.status === 'new' || job.status === 'queued') return 0
  if (typeof job.progress?.percent === 'number' && Number.isFinite(job.progress.percent)) {
    return Math.max(0, Math.min(100, job.progress.percent))
  }
  return null
}

function currentTask(job: CommandJob) {
  if (job.status === 'completed') return '协作任务已完成，结果已写回学习记录'
  if (job.status === 'failed') return job.error_message || '任务执行失败，等待检查'
  if (job.status === 'canceled') return '任务已取消，未执行的步骤不会继续运行'
  if (job.progress?.current_task) return job.progress.current_task
  if (job.status === 'running') return `${commandLabel(job.command)}正在执行`
  return '等待调度器分配执行资源'
}

function AgentStatusIcon({ status }: { status: AgentStep['status'] }) {
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-primary" />
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  if (status === 'failed') return <XCircle className="h-4 w-4 text-destructive" />
  if (status === 'canceled') return <XCircle className="h-4 w-4 text-muted-foreground" />
  return <Circle className="h-4 w-4 text-muted-foreground/50" />
}

function WorkflowJobCard({
  job,
  selected,
  onSelect,
  nowMs,
}: {
  job: CommandJob
  selected: boolean
  onSelect: () => void
  nowMs: number
}) {
  const active = ACTIVE_STATUSES.has(job.status)
  const percent = jobPercent(job)
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-xl border p-4 text-left transition-colors',
        selected ? 'border-primary bg-primary/5' : 'bg-background hover:border-primary/30'
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          )}
        >
          {active ? <Activity className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="truncate text-sm font-semibold">{commandLabel(job.command)}</span>
            <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px]', statusClasses(job.status))}>
              {statusLabel(job.status)}
            </span>
          </span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">{jobTarget(job)}</span>
          <span className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{stepTelemetryLabel(job)}</span>
            <span>·</span>
            <span>{jobTimingSummary(job, nowMs)}</span>
          </span>
          {active && percent !== null && (
            <Progress value={percent} className="mt-3 h-1.5" />
          )}
        </span>
        <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground" />
      </div>
    </button>
  )
}

function WorkflowBlueprint() {
  const gates = [
    {
      icon: BrainCircuit,
      label: '画像上下文',
      detail: '目标、基础、偏好与近期学习信号',
    },
    {
      icon: SearchCheck,
      label: '来源可追溯',
      detail: '视频、文章与网页保留出处和标签',
    },
    {
      icon: FileCheck2,
      label: '质量与安全',
      detail: '事实一致性、引用和内容安全复核',
    },
  ]

  return (
    <div className="flex h-full min-h-[650px] flex-col p-5 sm:p-6">
      <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              编排器就绪
            </span>
            <span className="rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground">
              9 个专业 Agent
            </span>
          </div>
          <h2 className="mt-3 text-xl font-semibold tracking-tight">画像驱动的协作蓝图</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            当前没有运行中的任务。发起资料搜索、资产生成或学习评估后，节点会切换为真实执行状态，并显示当前动作、单步耗时和上下游交接。
          </p>
        </div>
        <Button asChild size="sm" className="shrink-0 rounded-full">
          <Link href="/notebooks">
            发起学习任务
            <ArrowRight className="ml-2 h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {LEARNING_AGENTS.map((agent, index) => (
          <div
            key={agent.id}
            className={cn(
              'group relative overflow-hidden rounded-xl border bg-background p-4 transition-colors',
              index === 0
                ? 'border-primary/30 bg-primary/5'
                : 'border-dashed hover:border-primary/30'
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-xs font-semibold',
                  index === 0
                    ? 'border-primary/20 bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0">
                <p className="font-medium">{agent.name}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{agent.role}</p>
              </div>
            </div>
            {index < LEARNING_AGENTS.length - 1 && (
              <ArrowRight className="absolute right-3 top-3 h-3.5 w-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            )}
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-3 border-t pt-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,.42fr)]">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">三道可核验质量门</h3>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {gates.map(({ icon: Icon, label, detail }) => (
              <div key={label} className="rounded-xl border bg-muted/20 p-3">
                <div className="flex items-center gap-2 text-xs font-medium">
                  <Icon className="h-3.5 w-3.5 text-primary" />
                  {label}
                </div>
                <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{detail}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <TimerReset className="h-4 w-4 text-primary" />
            监控只展示真实事件
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            进度、当前 Agent 与耗时均来自后台任务事件；空闲状态不伪造运行数据。
          </p>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-primary">
            <Route className="h-3.5 w-3.5" />
            任务开始后自动切换为实时协作链路
          </div>
        </div>
      </div>
    </div>
  )
}

export type WorkflowSupervisorSurfaceProps = {
  jobs: CommandJob[]
  isFetching?: boolean
  nowMs?: number
  refreshLabel?: string
  initialFilter?: WorkflowFilter
}

export function WorkflowSupervisorSurface({
  jobs,
  isFetching = false,
  nowMs: controlledNowMs,
  refreshLabel = '2 秒自动刷新',
  initialFilter = 'active',
}: WorkflowSupervisorSurfaceProps) {
  const [filter, setFilter] = useState<WorkflowFilter>(initialFilter)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now())
  const nowMs = controlledNowMs ?? liveNowMs

  const sortedJobs = useMemo(
    () =>
      [...jobs].sort((left, right) => {
        const activeDelta =
          Number(ACTIVE_STATUSES.has(right.status)) - Number(ACTIVE_STATUSES.has(left.status))
        if (activeDelta !== 0) return activeDelta
        return (
          (Date.parse(right.updated || right.created || '') || 0) -
          (Date.parse(left.updated || left.created || '') || 0)
        )
      }),
    [jobs]
  )

  const filteredJobs = useMemo(
    () =>
      sortedJobs.filter((job) => {
        if (filter === 'active') return ACTIVE_STATUSES.has(job.status)
        if (filter === 'completed') return job.status === 'completed'
        if (filter === 'failed') return job.status === 'failed' || job.status === 'canceled'
        return true
      }),
    [filter, sortedJobs]
  )
  const hasActiveJobs = sortedJobs.some((job) => ACTIVE_STATUSES.has(job.status))

  useEffect(() => {
    if (controlledNowMs !== undefined || !hasActiveJobs) return
    const timer = window.setInterval(() => setLiveNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [controlledNowMs, hasActiveJobs])

  useEffect(() => {
    if (selectedJobId && filteredJobs.some((job) => job.job_id === selectedJobId)) return
    setSelectedJobId(filteredJobs[0]?.job_id || null)
  }, [filteredJobs, selectedJobId])

  const selectedJob =
    filteredJobs.find((job) => job.job_id === selectedJobId) || filteredJobs[0] || null
  const selectedAgents = selectedJob ? jobAgents(selectedJob) : []
  const hasStepTelemetry = Boolean(selectedJob?.progress?.steps?.length)
  const currentAgent = hasStepTelemetry
    ? selectedAgents.find((agent) => agent.status === 'running')
    : undefined
  const currentStepIndex = currentAgent
    ? selectedAgents.findIndex((agent) => agent.id === currentAgent.id)
    : -1
  const selectedPercent = selectedJob ? jobPercent(selectedJob) : null

  const stats = {
    running: sortedJobs.filter((job) => job.status === 'running').length,
    queued: sortedJobs.filter((job) => job.status === 'new' || job.status === 'queued').length,
    completed: sortedJobs.filter((job) => job.status === 'completed').length,
    failed: sortedJobs.filter((job) => job.status === 'failed' || job.status === 'canceled').length,
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-[1680px] space-y-6 px-5 py-6 lg:px-8">
          <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <Radio className="h-4 w-4" />
                <span>{refreshLabel}</span>
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Multi-Agent 工作流监督台</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                实时查看当前任务、执行进度、正在工作的 Agent、具体动作和上下游交接状态。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['执行中', stats.running, 'text-primary'],
                ['排队', stats.queued, 'text-amber-600'],
                ['已完成', stats.completed, 'text-emerald-600'],
                ['失败/取消', stats.failed, 'text-destructive'],
              ].map(([label, value, color]) => (
                <div key={String(label)} className="min-w-28 rounded-xl border bg-card px-4 py-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className={cn('mt-1 text-2xl font-semibold', color)}>{value}</p>
                </div>
              ))}
            </div>
          </header>

          <div className="grid min-h-[650px] gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
            <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border bg-card">
              <div className="border-b p-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">工作流任务</h2>
                  {isFetching && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                </div>
                <div className="mt-3 grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
                  {([
                    ['active', '活动'],
                    ['all', '全部'],
                    ['completed', '完成'],
                    ['failed', '失败'],
                  ] as Array<[WorkflowFilter, string]>).map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={filter === value ? 'secondary' : 'ghost'}
                      className="h-8 px-2 text-xs"
                      onClick={() => setFilter(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-3">
                {filteredJobs.length > 0 ? (
                  filteredJobs.map((job) => (
                    <WorkflowJobCard
                      key={job.job_id}
                      job={job}
                      selected={job.job_id === selectedJob?.job_id}
                      onSelect={() => setSelectedJobId(job.job_id)}
                      nowMs={nowMs}
                    />
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed p-8 text-center">
                    <Clock3 className="mx-auto h-8 w-8 text-muted-foreground/60" />
                    <p className="mt-3 text-sm font-medium">这个分组暂时没有任务</p>
                    <p className="mt-1 text-xs text-muted-foreground">发起资料搜索或资产生成后会实时出现在这里。</p>
                  </div>
                )}
              </div>
            </section>

            <section className="min-w-0 overflow-hidden rounded-2xl border bg-card">
              {selectedJob ? (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="border-b p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-xl font-semibold">{commandLabel(selectedJob.command)}</h2>
                          <span className={cn('rounded-full border px-2.5 py-1 text-xs', statusClasses(selectedJob.status))}>
                            {statusLabel(selectedJob.status)}
                          </span>
                        </div>
                        <p className="mt-2 break-words text-sm text-muted-foreground">{jobTarget(selectedJob)}</p>
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">{selectedJob.job_id}</p>
                      </div>
                      {Boolean(selectedJob.target?.learning_record_id) && (
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/notebooks/${encodeURIComponent(String(selectedJob.target?.learning_record_id))}`}>
                            打开学习记录
                            <ExternalLink className="ml-2 h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      )}
                    </div>

                    <div className="mt-5 rounded-xl border border-primary/20 bg-primary/5 p-4">
                      <div className="flex items-start gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                          {currentAgent ? <Bot className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="text-xs font-medium text-primary">
                                {currentAgent && currentStepIndex >= 0
                                  ? `当前步骤 ${currentStepIndex + 1}/${selectedAgents.length}`
                                  : '当前状态'}
                              </p>
                              <p className="mt-0.5 font-semibold">
                                {currentAgent?.name || statusLabel(selectedJob.status)}
                              </p>
                            </div>
                            <div className="text-right">
                              <span className="block text-2xl font-semibold text-primary">
                                {selectedPercent === null ? '—' : `${selectedPercent}%`}
                              </span>
                              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                {currentAgent
                                  ? `本步${stepTimingSummary(currentAgent, selectedJob, nowMs)}`
                                  : jobTimingSummary(selectedJob, nowMs)}
                              </span>
                            </div>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">{currentTask(selectedJob)}</p>
                          {selectedPercent !== null && (
                            <Progress value={selectedPercent} className="mt-3 h-2" />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)]">
                    <div className="min-h-0 overflow-y-auto border-r p-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold">Agent 协作链路</h3>
                          <p className="mt-1 text-xs text-muted-foreground">
                            每个节点展示职责、状态和当前交接位置。
                          </p>
                        </div>
                        <span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
                          {selectedJob ? stepTelemetryLabel(selectedJob) : '无步骤遥测'}
                        </span>
                      </div>

                      <div className="mt-5 space-y-0">
                        {selectedAgents.map((agent, index) => (
                          <div key={agent.id} className="relative flex gap-4 pb-5 last:pb-0">
                            {index < selectedAgents.length - 1 && (
                              <span
                                className={cn(
                                  'absolute left-[17px] top-9 h-[calc(100%-1rem)] w-px',
                                  agent.status === 'completed' ? 'bg-emerald-300' : 'bg-border'
                                )}
                              />
                            )}
                            <span
                              className={cn(
                                'relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border bg-background',
                                agent.status === 'running' && 'border-primary bg-primary/10',
                                agent.status === 'completed' && 'border-emerald-300 bg-emerald-50',
                                agent.status === 'failed' && 'border-destructive/40 bg-destructive/10'
                              )}
                            >
                              <AgentStatusIcon status={agent.status} />
                            </span>
                            <div
                              className={cn(
                                'min-w-0 flex-1 rounded-xl border p-4',
                                agent.status === 'running' && 'border-primary/30 bg-primary/5',
                                agent.status === 'completed' && 'bg-muted/20',
                                agent.status === 'queued' && 'border-dashed'
                              )}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-medium">{agent.name}</p>
                                  <p className="mt-1 text-sm leading-6 text-muted-foreground">{agent.role}</p>
                                </div>
                                <div className="shrink-0 text-right">
                                  <span className="rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">
                                    {agent.status === 'running'
                                      ? '执行中'
                                      : agent.status === 'completed'
                                        ? '已完成'
                                        : agent.status === 'failed'
                                          ? '失败'
                                          : agent.status === 'canceled'
                                            ? '已取消'
                                            : agent.status === 'unknown'
                                              ? '未知'
                                              : '等待'}
                                  </span>
                                  <span
                                    className={cn(
                                      'mt-2 block text-[11px] text-muted-foreground',
                                      agent.status === 'running' && 'font-medium text-primary'
                                    )}
                                  >
                                    {stepTimingSummary(agent, selectedJob, nowMs)}
                                  </span>
                                </div>
                              </div>
                              {agent.status === 'running' && (
                                <div className="mt-3 flex items-center gap-2 rounded-lg bg-background px-3 py-2 text-xs text-primary">
                                  <Sparkles className="h-3.5 w-3.5" />
                                  {currentTask(selectedJob)}
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <aside className="min-h-0 overflow-y-auto bg-muted/15 p-5">
                      <h3 className="font-semibold">实时监督信息</h3>
                      <div className="mt-4 space-y-3">
                        <div className="rounded-xl border bg-background p-4">
                          <p className="text-xs font-medium text-muted-foreground">当前具体动作</p>
                          <p className="mt-2 text-sm leading-6">{currentTask(selectedJob)}</p>
                        </div>
                        <div className="rounded-xl border bg-background p-4">
                          <p className="text-xs font-medium text-muted-foreground">输入目标</p>
                          <p className="mt-2 text-sm leading-6">{jobTarget(selectedJob)}</p>
                        </div>
                        <div className="rounded-xl border bg-background p-4">
                          <p className="text-xs font-medium text-muted-foreground">时间线</p>
                          <div className="mt-3 space-y-2 text-xs text-muted-foreground">
                            <div className="flex justify-between gap-3">
                              <span>创建</span>
                              <span>{formatDate(selectedJob.created)}</span>
                            </div>
                            <div className="flex justify-between gap-3">
                              <span>最近更新</span>
                              <span>{formatDate(selectedJob.progress?.updated_at || selectedJob.updated)}</span>
                            </div>
                            <div className="flex justify-between gap-3 border-t pt-2 font-medium text-foreground">
                              <span>
                                {selectedJob.status === 'new' || selectedJob.status === 'queued'
                                  ? '排队等待'
                                  : '总耗时'}
                              </span>
                              <span>
                                {selectedJob.status === 'new' || selectedJob.status === 'queued'
                                  ? formatDuration(jobQueueElapsedSeconds(selectedJob, nowMs), '时间未知')
                                  : formatDuration(jobElapsedSeconds(selectedJob, nowMs))}
                              </span>
                            </div>
                          </div>
                        </div>
                        {selectedJob.error_message && (
                          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                            <p className="text-xs font-medium text-destructive">异常信息</p>
                            <p className="mt-2 break-words text-sm leading-6 text-destructive">
                              {selectedJob.error_message}
                            </p>
                          </div>
                        )}
                      </div>
                    </aside>
                  </div>
                </div>
              ) : (
                <WorkflowBlueprint />
              )}
            </section>
          </div>
        </div>
      </div>
  )
}
