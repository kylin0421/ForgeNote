'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
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

import { AppShell } from '@/components/layout/AppShell'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  commandsApi,
  type CommandJob,
  type CommandJobStatus,
} from '@/lib/api/commands'
import { cn } from '@/lib/utils'

type AgentStep = {
  id: string
  name: string
  role: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  started_at?: string | null
  completed_at?: string | null
  duration_seconds?: number | null
  elapsed_seconds?: number | null
}

type WorkflowFilter = 'active' | 'all' | 'completed' | 'failed'

const ACTIVE_STATUSES = new Set<CommandJobStatus>(['new', 'queued', 'running'])

const LEARNING_AGENTS: AgentStep[] = [
  {
    id: 'profile-agent',
    name: '学习画像智能体',
    role: '从对话和学习行为中提取 8 维画像并持续刷新',
    status: 'queued',
  },
  {
    id: 'curriculum-agent',
    name: '课程结构智能体',
    role: '拆解知识单元、先修关系与检索意图',
    status: 'queued',
  },
  {
    id: 'collector-agent',
    name: '资源搜集智能体',
    role: '并行搜索视频、文章、网页、论文和练习',
    status: 'queued',
  },
  {
    id: 'resource-agent',
    name: '资源生成智能体',
    role: '基于已采纳来源生成可追溯学习资产',
    status: 'queued',
  },
  {
    id: 'practice-agent',
    name: '练习实训智能体',
    role: '生成 Quiz、闪卡、代码与迁移练习',
    status: 'queued',
  },
  {
    id: 'path-agent',
    name: '路径规划智能体',
    role: '依据画像、资源与掌握度动态编排学习顺序',
    status: 'queued',
  },
  {
    id: 'tutor-agent',
    name: '智能辅导智能体',
    role: '即时答疑、定位卡点并按需调用学习资产工具',
    status: 'queued',
  },
  {
    id: 'evaluation-agent',
    name: '学习评估智能体',
    role: '评估掌握度并给出路径调整建议',
    status: 'queued',
  },
  {
    id: 'safety-agent',
    name: '安全校验智能体',
    role: '核对来源、事实一致性和内容安全',
    status: 'queued',
  },
]

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

function formatDuration(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '尚未计时'
  const seconds = Math.max(0, Math.round(value))
  if (seconds < 1) return '< 1 秒'
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  if (minutes < 60) return `${minutes} 分 ${remainingSeconds} 秒`
  const hours = Math.floor(minutes / 60)
  return `${hours} 小时 ${minutes % 60} 分`
}

function elapsedFromTimestamps(
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

function stepElapsedSeconds(agent: AgentStep, job: CommandJob, nowMs: number) {
  if (typeof agent.duration_seconds === 'number') return agent.duration_seconds
  if (agent.status === 'running') {
    return elapsedFromTimestamps(
      agent.started_at || job.progress?.workflow_started_at,
      null,
      nowMs
    )
  }
  if (agent.status === 'failed') {
    return elapsedFromTimestamps(
      agent.started_at || job.progress?.workflow_started_at || job.created,
      agent.completed_at || job.updated,
      nowMs
    )
  }
  return elapsedFromTimestamps(agent.started_at, agent.completed_at, nowMs)
}

function jobElapsedSeconds(job: CommandJob, nowMs: number) {
  if (typeof job.progress?.duration_seconds === 'number') {
    return job.progress.duration_seconds
  }
  return elapsedFromTimestamps(
    job.progress?.workflow_started_at || job.created,
    ACTIVE_STATUSES.has(job.status)
      ? null
      : job.progress?.workflow_completed_at || job.updated,
    nowMs
  )
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
  let agents = LEARNING_AGENTS
  if (job.command === 'collect_learning_resources') {
    agents = LEARNING_AGENTS.filter((agent) =>
      ['profile-agent', 'curriculum-agent', 'collector-agent', 'safety-agent'].includes(agent.id)
    )
  } else if (job.command === 'generate_learning_asset') {
    agents = LEARNING_AGENTS
  } else if (!job.command?.includes('learning')) {
    agents = [
      {
        id: 'dispatcher-agent',
        name: '任务调度智能体',
        role: '接收任务、校验输入并安排执行顺序',
        status: 'queued',
      },
      {
        id: 'worker-agent',
        name: '专业执行智能体',
        role: `执行「${commandLabel(job.command)}」的核心工作`,
        status: 'queued',
      },
      {
        id: 'review-agent',
        name: '结果校验智能体',
        role: '检查输出完整性并写回项目记录',
        status: 'queued',
      },
    ]
  }

  return agents.map((agent, index) => {
    if (job.status === 'completed') return { ...agent, status: 'completed' }
    if (job.status === 'failed') {
      return { ...agent, status: index === 0 ? 'failed' : 'queued' }
    }
    if (job.status === 'running') {
      return { ...agent, status: index === 0 ? 'running' : 'queued' }
    }
    return { ...agent, status: 'queued' }
  })
}

function jobAgents(job: CommandJob): AgentStep[] {
  const steps = job.progress?.steps
  if (!steps?.length) return fallbackAgents(job)
  if (job.status !== 'failed') return steps
  return steps.map((step) => (
    step.status === 'running' ? { ...step, status: 'failed' } : step
  ))
}

function jobPercent(job: CommandJob) {
  if (typeof job.progress?.percent === 'number') return job.progress.percent
  if (job.status === 'completed') return 100
  if (job.status === 'running') return 24
  if (job.status === 'new' || job.status === 'queued') return 6
  return 0
}

function currentTask(job: CommandJob) {
  if (job.progress?.current_task) return job.progress.current_task
  if (job.status === 'completed') return '协作任务已完成，结果已写回学习记录'
  if (job.status === 'failed') return job.error_message || '任务执行失败，等待检查'
  if (job.status === 'running') return `${commandLabel(job.command)}正在执行`
  return '等待调度器分配执行资源'
}

function AgentStatusIcon({ status }: { status: AgentStep['status'] }) {
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-primary" />
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  if (status === 'failed') return <XCircle className="h-4 w-4 text-destructive" />
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
            <span>{jobAgents(job).length} 个 Agent</span>
            <span>·</span>
            <span>耗时 {formatDuration(jobElapsedSeconds(job, nowMs))}</span>
          </span>
          {active && <Progress value={jobPercent(job)} className="mt-3 h-1.5" />}
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

export default function WorkflowSupervisorPage() {
  const [filter, setFilter] = useState<WorkflowFilter>('active')
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const { data: jobs = [], isFetching } = useQuery({
    queryKey: ['commands', 'workflow-supervisor'],
    queryFn: () => commandsApi.listJobs({ limit: 100, include_dismissed: true }),
    refetchInterval: 2000,
  })

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
        if (filter === 'failed') return job.status === 'failed'
        return true
      }),
    [filter, sortedJobs]
  )
  const hasActiveJobs = sortedJobs.some((job) => ACTIVE_STATUSES.has(job.status))

  useEffect(() => {
    if (!hasActiveJobs) return
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [hasActiveJobs])

  useEffect(() => {
    if (selectedJobId && sortedJobs.some((job) => job.job_id === selectedJobId)) return
    setSelectedJobId(
      sortedJobs.find((job) => ACTIVE_STATUSES.has(job.status))?.job_id ||
      sortedJobs[0]?.job_id ||
      null
    )
  }, [selectedJobId, sortedJobs])

  const selectedJob =
    sortedJobs.find((job) => job.job_id === selectedJobId) || filteredJobs[0] || null
  const selectedAgents = selectedJob ? jobAgents(selectedJob) : []
  const currentAgent =
    selectedAgents.find((agent) => agent.status === 'running') ||
    selectedAgents.find((agent) => agent.id === selectedJob?.progress?.current_agent_id)
  const currentStepIndex = currentAgent
    ? selectedAgents.findIndex((agent) => agent.id === currentAgent.id)
    : -1

  const stats = {
    active: sortedJobs.filter((job) => ACTIVE_STATUSES.has(job.status)).length,
    queued: sortedJobs.filter((job) => job.status === 'new' || job.status === 'queued').length,
    completed: sortedJobs.filter((job) => job.status === 'completed').length,
    failed: sortedJobs.filter((job) => job.status === 'failed').length,
  }

  return (
    <AppShell>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-[1680px] space-y-6 px-5 py-6 lg:px-8">
          <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <Radio className="h-4 w-4" />
                <span>2 秒自动刷新</span>
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">Multi-Agent 工作流监督台</h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                实时查看当前任务、执行进度、正在工作的 Agent、具体动作和上下游交接状态。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['进行中', stats.active, 'text-primary'],
                ['排队', stats.queued, 'text-amber-600'],
                ['已完成', stats.completed, 'text-emerald-600'],
                ['失败', stats.failed, 'text-destructive'],
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
                    ['active', '进行中'],
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
                                {jobPercent(selectedJob)}%
                              </span>
                              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                {currentAgent
                                  ? `本步已运行 ${formatDuration(stepElapsedSeconds(currentAgent, selectedJob, nowMs))}`
                                  : `总耗时 ${formatDuration(jobElapsedSeconds(selectedJob, nowMs))}`}
                              </span>
                            </div>
                          </div>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">{currentTask(selectedJob)}</p>
                          <Progress value={jobPercent(selectedJob)} className="mt-3 h-2" />
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
                          {selectedAgents.length} 个 Agent
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
                                          : '等待'}
                                  </span>
                                  <span
                                    className={cn(
                                      'mt-2 block text-[11px] text-muted-foreground',
                                      agent.status === 'running' && 'font-medium text-primary'
                                    )}
                                  >
                                    {agent.status === 'queued'
                                      ? '尚未开始'
                                      : `${agent.status === 'running' ? '已运行' : '耗时'} ${formatDuration(
                                          stepElapsedSeconds(agent, selectedJob, nowMs)
                                        )}`}
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
                              <span>总耗时</span>
                              <span>{formatDuration(jobElapsedSeconds(selectedJob, nowMs))}</span>
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
    </AppShell>
  )
}
