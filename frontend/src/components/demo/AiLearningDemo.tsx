'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Activity,
  ArrowRight,
  BookOpen,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Code2,
  FileCheck2,
  FileText,
  Headphones,
  ImageIcon,
  Keyboard,
  LibraryBig,
  Loader2,
  Map,
  Network,
  Play,
  Radio,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Volume2,
  Video,
  WandSparkles,
} from 'lucide-react'

import { AppShell } from '@/components/layout/AppShell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  AI_LEARNING_DEMO,
  AI_LEARNING_DEMO_STEPS,
  AI_LEARNING_DEMO_TOTAL_STEPS,
  defaultDemoStepForPath,
  demoStepHref,
} from '@/lib/demo/ai-learning-demo'
import { cn } from '@/lib/utils'

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.closest('input, textarea, select, button, a[href], [role="button"]')) return true
  return target.isContentEditable || Boolean(target.closest('[contenteditable="true"]'))
}

function Panel({
  title,
  icon,
  action,
  children,
  className,
}: {
  title: string
  icon: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('min-w-0 overflow-hidden rounded-xl border bg-card', className)}>
      <header className="flex h-12 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

function EmptyState({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed bg-muted/10 px-5 text-center text-sm text-muted-foreground">
      <span className="mb-3 text-muted-foreground/60">{icon}</span>
      {children}
    </div>
  )
}

function NotebookScene({ step }: { step: number }) {
  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1680px] flex-col px-4 py-4 lg:px-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            学习记录
            <ChevronRight className="h-3 w-3" />
            <span>{AI_LEARNING_DEMO.notebookName}</span>
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold">{AI_LEARNING_DEMO.topic}</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">学习曲线</Button>
          <Button size="sm" className="gap-2">
            <WandSparkles className="h-4 w-4" />
            生成学习资产
          </Button>
        </div>
      </div>

      {step >= 2 && (
        <div className="mb-4 rounded-xl border bg-card px-4 py-3 shadow-sm" data-testid="profile-summary">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="flex shrink-0 items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Brain className="h-4 w-4" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">8 维动态学习画像</p>
                  <span className="flex items-center gap-1 text-[11px] text-emerald-600">
                    <CheckCircle2 className="h-3 w-3" />
                    已启用
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">持续根据对话、资料采纳和测验结果更新</p>
              </div>
            </div>
            <div className="grid flex-1 grid-cols-2 gap-1.5 sm:grid-cols-4 xl:grid-cols-8">
              {AI_LEARNING_DEMO.profileDimensions.map((dimension) => (
                <div key={dimension.label} className="rounded-lg bg-muted/40 px-2.5 py-2">
                  <p className="text-[10px] text-muted-foreground">{dimension.label}</p>
                  <p className="mt-0.5 truncate text-xs font-medium">{dimension.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="grid min-h-[580px] flex-1 gap-3 lg:grid-cols-[260px_minmax(420px,1fr)_320px]">
        <Panel
          title="资料"
          icon={<LibraryBig className="h-4 w-4 text-primary" />}
          action={<Button variant="ghost" size="sm" className="h-7 px-2 text-xs">添加</Button>}
          className="flex min-h-0 flex-col"
        >
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            {step < 4 ? (
              <EmptyState icon={<FileText className="h-6 w-6" />}>
                还没有资料
                <span className="mt-1 block text-xs">对话中需要证据时会自动发起搜索</span>
              </EmptyState>
            ) : (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  <Search className="h-4 w-4" />
                  DeepSearch 已准备
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  将从论文、教程和官方代码文档中交叉验证 QKV 的解释。
                </p>
              </div>
            )}
          </div>
        </Panel>

        <Panel
          title="对话"
          icon={<Bot className="h-4 w-4 text-primary" />}
          action={<Badge variant="outline">deepseek-v4-flash</Badge>}
          className="flex min-h-0 flex-col"
        >
          <div className="flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
            {step === 0 && (
              <EmptyState icon={<Bot className="h-7 w-7" />}>
                开始一段对话，让 AI 了解你的目标和已有基础
              </EmptyState>
            )}

            {step >= 1 && (
              <div className="max-w-[88%] rounded-2xl rounded-tl-md bg-muted px-4 py-3 text-sm leading-6">
                <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-primary">
                  <Brain className="h-3.5 w-3.5" />
                  学习画像访谈
                </div>
                {AI_LEARNING_DEMO.profileQuestion}
              </div>
            )}

            {step >= 2 && (
              <>
                <div className="ml-auto max-w-[82%] rounded-2xl rounded-tr-md bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">
                  {AI_LEARNING_DEMO.profileAnswer}
                </div>
                <div className="max-w-[88%] rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" />
                    学习画像已建立
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    后续解释将优先使用图解、类比和可运行代码，并实时控制难度。
                  </p>
                </div>
              </>
            )}

            {step >= 3 && (
              <div className="ml-auto max-w-[82%] rounded-2xl rounded-tr-md bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">
                {AI_LEARNING_DEMO.userQuestion}
              </div>
            )}

            {step >= 4 && (
              <>
                <div className="max-w-[90%] rounded-2xl rounded-tl-md border bg-background px-4 py-3 text-sm leading-6 shadow-sm">
                  <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-primary">
                    <Sparkles className="h-3.5 w-3.5" />
                    已按你的画像调整讲解
                  </div>
                  {AI_LEARNING_DEMO.assistantAnswer}
                </div>
                <div className="max-w-[90%] rounded-xl border bg-muted/20 px-4 py-3 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2 font-medium">
                      <Search className="h-3.5 w-3.5 text-primary" />
                      DeepSearch · 权威证据检索
                    </span>
                    <span className="text-muted-foreground">即将打开</span>
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="border-t p-3">
            <input
              aria-label="学习记录输入框"
              className="h-10 w-full rounded-lg border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground"
              placeholder="输入问题，Enter 发送"
            />
          </div>
        </Panel>

        <Panel
          title="Studio"
          icon={<WandSparkles className="h-4 w-4 text-primary" />}
          action={<Button variant="ghost" size="sm" className="h-7 px-2 text-xs">新建</Button>}
          className="flex min-h-0 flex-col"
        >
          <div className="flex-1 space-y-2 overflow-y-auto p-3">
            <EmptyState icon={<WandSparkles className="h-6 w-6" />}>
              暂无学习资产
              <span className="mt-1 block text-xs">资料准备好后，可生成指南、导图、播客和 Quiz</span>
            </EmptyState>
          </div>
        </Panel>
      </div>
    </div>
  )
}

function SearchScene({ step }: { step: number }) {
  const isRunning = step === 6
  const isComplete = step >= 7

  return (
    <div className="mx-auto min-h-full w-full max-w-[1500px] px-5 py-6 lg:px-8">
      <div className="flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Search className="h-4 w-4" />
            问询与搜索
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">DeepSearch</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            多路检索智能体并行查找、精读和交叉验证资料，再将可追溯证据保存到学习记录。
          </p>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[
            ['候选资料', step >= 6 ? '28' : '—'],
            ['深度精读', step >= 6 ? '6' : '—'],
            ['采纳证据', isComplete ? '4' : '—'],
            ['平均质量', isComplete ? '95%' : '—'],
          ].map(([label, value]) => (
            <div key={label} className="min-w-24 rounded-lg border bg-card px-3 py-2">
              <p className="text-[10px] text-muted-foreground">{label}</p>
              <p className="mt-0.5 text-lg font-semibold">{value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-5 rounded-xl border bg-card p-4">
        <p className="text-xs font-medium text-muted-foreground">搜索目标</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <div className="flex h-10 flex-1 items-center rounded-lg border bg-background px-3 text-sm">
            {AI_LEARNING_DEMO.searchQuery}
          </div>
          <Button className="gap-2">
            <Search className="h-4 w-4" />
            深度搜索
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge variant="secondary">画像适配：图解 + 代码</Badge>
          <Badge variant="secondary">优先权威来源</Badge>
          <Badge variant="secondary">自动交叉验证</Badge>
        </div>
      </div>

      <div className="mt-5 grid min-h-[560px] gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Panel
          title="检索意图与智能体"
          icon={<Network className="h-4 w-4 text-primary" />}
          action={
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {isRunning && <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />}
              3 路并行
            </span>
          }
        >
          <div className="space-y-3 p-3">
            {AI_LEARNING_DEMO.searchIntents.map((intent, index) => {
              const completed = isComplete
              return (
                <div
                  key={intent.agent}
                  className={cn(
                    'rounded-xl border p-3',
                    isRunning && 'border-primary/25 bg-primary/5',
                    completed && 'bg-muted/20'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background',
                        completed && 'border-emerald-300 bg-emerald-50 text-emerald-600'
                      )}
                    >
                      {completed ? (
                        <Check className="h-4 w-4" />
                      ) : isRunning ? (
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      ) : (
                        <span className="font-mono text-xs">{index + 1}</span>
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{intent.agent}</p>
                        <Badge variant="outline" className="text-[10px]">{intent.scope}</Badge>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{intent.intent}</p>
                      {step >= 6 && (
                        <p className="mt-2 rounded-md bg-background px-2 py-1.5 text-[11px] text-foreground">
                          {completed ? intent.result : '正在检索并评估候选资料…'}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>

        <Panel
          title={isComplete ? '证据结果' : '实时检索'}
          icon={<FileCheck2 className="h-4 w-4 text-primary" />}
          action={<Badge variant={isComplete ? 'default' : 'secondary'}>{isComplete ? '已保存到 ai学习' : isRunning ? '检索中' : '等待执行'}</Badge>}
        >
          <div className="p-4">
            {step === 5 && (
              <EmptyState icon={<Search className="h-7 w-7" />}>
                检索策略已经拆解完成
                <span className="mt-1 block text-xs">下一步将同时搜索论文、教程与官方代码文档</span>
              </EmptyState>
            )}

            {isRunning && (
              <div className="space-y-3">
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">并行检索与页面精读</span>
                    <span className="font-mono text-primary">18 / 28</span>
                  </div>
                  <Progress value={64} className="mt-3 h-2" />
                </div>
                {AI_LEARNING_DEMO.sources.slice(0, 3).map((source, index) => (
                  <div key={source.title} className="flex items-center gap-3 rounded-lg border px-3 py-3">
                    <Loader2 className={cn('h-4 w-4 text-primary', index === 2 && 'animate-spin')} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{source.title}</p>
                      <p className="text-xs text-muted-foreground">{index === 2 ? '正在精读正文与代码片段…' : '已提取关键证据'}</p>
                    </div>
                    {index < 2 && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
                  </div>
                ))}
              </div>
            )}

            {isComplete && (
              <div className="space-y-3" data-testid="deep-search-results">
                {AI_LEARNING_DEMO.sources.map((source) => (
                  <article key={source.title} className="rounded-xl border bg-background p-3.5">
                    <div className="flex items-start gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        {source.domain === 'arXiv' ? <FileText className="h-4 w-4" /> : source.domain === 'pytorch.org' ? <Code2 className="h-4 w-4" /> : source.domain === 'youtube.com' ? <Video className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-semibold">{source.title}</h3>
                          <Badge variant="outline" className="text-[10px]">{source.kind}</Badge>
                          <Badge variant="secondary" className="text-[10px]">质量 {source.score}%</Badge>
                          <Badge className="bg-emerald-500 text-[10px] text-white hover:bg-emerald-500">已采纳</Badge>
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{source.meta}</p>
                        <p className="mt-2 text-xs leading-5">{source.insight}</p>
                        <p className="mt-1.5 text-[11px] text-primary">推荐理由：{source.recommendation}</p>
                      </div>
                    </div>
                  </article>
                ))}
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                    <ShieldCheck className="h-4 w-4" />
                    交叉验证通过
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">{AI_LEARNING_DEMO.evidenceSummary}</p>
                  <div className="mt-3 flex items-center gap-2 border-t border-emerald-500/20 pt-3 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" />
                    4 个来源及证据摘要已保存到「ai学习」
                  </div>
                </div>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}

function workflowState(step: number, index: number) {
  if (step >= 10) return 'completed'
  if (step === 9) {
    if (index < 4) return 'completed'
    if (index === 4) return 'running'
    return 'queued'
  }
  if (index === 0) return 'completed'
  if (index === 1) return 'running'
  return 'queued'
}

function WorkflowStatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <Check className="h-4 w-4 text-emerald-600" />
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-primary" />
  return <Circle className="h-3.5 w-3.5 text-muted-foreground" />
}

function WorkflowScene({ step }: { step: number }) {
  const complete = step >= 10
  const progress = complete ? 100 : step === 9 ? 78 : 22
  const currentAgentIndex = complete ? -1 : step === 9 ? 4 : 1
  const currentAgent =
    AI_LEARNING_DEMO.workflowAgents.find((_, index) => index === currentAgentIndex) ?? null

  return (
    <div className="mx-auto min-h-full w-full max-w-[1680px] space-y-5 px-5 py-6 lg:px-8">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Radio className="h-4 w-4" />
            <span>实时任务事件</span>
            {!complete && <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />}
          </div>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Multi-Agent 工作流监督台</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            当前步骤、负责智能体、输入输出和上下游交接均可实时追踪。
          </p>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {[
            ['进行中', complete ? 0 : 1, 'text-primary'],
            ['排队', complete ? 0 : step === 9 ? 1 : 4, 'text-amber-600'],
            ['已完成', complete ? 1 : 0, 'text-emerald-600'],
            ['失败', 0, 'text-destructive'],
          ].map(([label, value, color]) => (
            <div key={String(label)} className="min-w-24 rounded-xl border bg-card px-4 py-3">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className={cn('mt-1 text-2xl font-semibold', color)}>{value}</p>
            </div>
          ))}
        </div>
      </header>

      <div className="grid min-h-[650px] gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
        <Panel title="工作流任务" icon={<Activity className="h-4 w-4 text-primary" />}>
          <div className="border-b p-3">
            <div className="grid grid-cols-4 gap-1 rounded-lg bg-muted p-1 text-center text-xs">
              <span className="rounded-md bg-background px-2 py-2 shadow-sm">进行中</span>
              <span className="px-2 py-2 text-muted-foreground">全部</span>
              <span className="px-2 py-2 text-muted-foreground">完成</span>
              <span className="px-2 py-2 text-muted-foreground">失败</span>
            </div>
          </div>
          <div className="p-3">
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center justify-between gap-2">
                <Badge variant={complete ? 'secondary' : 'default'}>{complete ? '已完成' : '进行中'}</Badge>
                <span className="font-mono text-xs font-semibold text-primary">{progress}%</span>
              </div>
              <p className="mt-3 font-medium">QKV 个性化学习资源生成</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">ai学习 · 画像驱动的资料搜集与多模态资产生成</p>
              <Progress value={progress} className="mt-3 h-1.5" />
              <p className="mt-3 font-mono text-[10px] text-muted-foreground">command:demo-qkv-20260730</p>
            </div>
          </div>
        </Panel>

        <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
          <div className="border-b p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-semibold">个性化学习资产生成</h2>
                  <Badge variant={complete ? 'secondary' : 'default'}>{complete ? '已完成' : '进行中'}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">目标：用图解、类比和代码讲清 Transformer 的 Q、K、V</p>
              </div>
              <Button variant="outline" size="sm" className="gap-2">
                打开学习记录
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className={cn(
              'mt-5 rounded-xl border p-4',
              complete ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-primary/20 bg-primary/5'
            )}>
              <div className="flex items-start gap-3">
                <span className={cn(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white',
                  complete ? 'bg-emerald-500' : 'bg-primary'
                )}>
                  {complete ? <ShieldCheck className="h-5 w-5" /> : <Bot className="h-5 w-5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium text-primary">{complete ? '当前状态' : `当前步骤 ${currentAgentIndex + 1}/${AI_LEARNING_DEMO.workflowAgents.length}`}</p>
                      <p className="mt-0.5 font-semibold">{currentAgent?.name || '全部智能体协作完成'}</p>
                    </div>
                    <span className="text-2xl font-semibold text-primary">{progress}%</span>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {currentAgent?.role || '资料、资产和评估结果已通过一致性校验，完整事件链可追溯。'}
                  </p>
                  <Progress value={progress} className="mt-3 h-2" />
                </div>
              </div>
            </div>
          </div>

          <div className="grid min-h-[430px] lg:grid-cols-[minmax(0,1.25fr)_300px]">
            <div className="border-r p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold">Agent 协作链路</h3>
                  <p className="mt-1 text-xs text-muted-foreground">每个节点展示职责、状态与交接位置。</p>
                </div>
                <Badge variant="outline">本任务启用 {AI_LEARNING_DEMO.workflowAgents.length} / 9 Agent</Badge>
              </div>
              <div className="mt-4 grid gap-2 xl:grid-cols-2">
                {AI_LEARNING_DEMO.workflowAgents.map((agent, index) => {
                  const status = workflowState(step, index)
                  return (
                    <div
                      key={agent.name}
                      className={cn(
                        'rounded-xl border p-3',
                        status === 'running' && 'border-primary/30 bg-primary/5',
                        status === 'completed' && 'bg-muted/20',
                        status === 'queued' && 'border-dashed'
                      )}
                    >
                      <div className="flex gap-3">
                        <span className={cn(
                          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background',
                          status === 'completed' && 'border-emerald-300 bg-emerald-50',
                          status === 'running' && 'border-primary'
                        )}>
                          <WorkflowStatusIcon status={status} />
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium">{agent.name}</p>
                            <span className="text-[10px] text-muted-foreground">
                              {status === 'completed' ? agent.duration : status === 'running' ? '执行中' : '等待'}
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">{agent.role}</p>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <aside className="bg-muted/10 p-5">
              <h3 className="font-semibold">实时监督信息</h3>
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border bg-background p-4">
                  <p className="text-xs font-medium text-muted-foreground">当前具体动作</p>
                  <p className="mt-2 text-sm leading-6">{currentAgent?.role || '对最终资产进行来源与事实一致性校验'}</p>
                </div>
                <div className="rounded-xl border bg-background p-4">
                  <p className="text-xs font-medium text-muted-foreground">Agent 交接</p>
                  <p className="mt-2 text-sm leading-6">
                    {complete ? '学习评估智能体 → 学习记录：写入资产与画像证据' : step === 9 ? '安全校验智能体 → 资源生成智能体' : '学习画像智能体 → 课程结构智能体'}
                  </p>
                </div>
                <div className="rounded-xl border bg-background p-4">
                  <p className="text-xs font-medium text-muted-foreground">三道质量门</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {['来源权威性', '证据一致性', '画像适配度'].map((gate) => (
                      <span key={gate} className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-700 dark:text-emerald-300">
                        <Check className="h-3 w-3" />
                        {gate}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border bg-background p-4">
                  <p className="text-xs font-medium text-muted-foreground">总耗时</p>
                  <p className="mt-2 text-lg font-semibold">{complete ? '12.6 秒' : step === 9 ? '8.1 秒' : '2.0 秒'}</p>
                  <p className="mt-1 text-xs text-muted-foreground">无异常 · 6 条步骤事件</p>
                </div>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </div>
  )
}

const ASSET_ICONS = {
  学习指南: BookOpen,
  思维导图: Map,
  学习播客: Headphones,
  Quiz: FileCheck2,
  辅助图片: ImageIcon,
  讲解视频: Video,
} as const

function AssetCard({ asset, generating }: { asset: (typeof AI_LEARNING_DEMO.assets)[number]; generating: boolean }) {
  const Icon = ASSET_ICONS[asset.type]
  return (
    <article className="rounded-xl border bg-background p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <Badge variant="outline" className="text-[10px]">{asset.type}</Badge>
            {generating ? (
              <span className="flex items-center gap-1 text-[10px] text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                生成中
              </span>
            ) : (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            )}
          </div>
          <h3 className="mt-2 truncate text-sm font-semibold">{asset.title}</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">{generating ? '正在综合画像与 4 个来源…' : asset.meta}</p>
        </div>
      </div>
    </article>
  )
}

function StudioScene({ step }: { step: number }) {
  const generating = step === 11
  const showQuiz = step >= 13
  const showUpdate = step >= 14

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1680px] flex-col px-4 py-4 lg:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            学习记录
            <ChevronRight className="h-3 w-3" />
            <span>ai学习</span>
          </div>
          <h1 className="mt-1.5 text-2xl font-semibold">{AI_LEARNING_DEMO.topic}</h1>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          4 个来源已同步
          <span>·</span>
          画像已启用
        </div>
      </div>

      <div className="grid min-h-[680px] flex-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <section className="overflow-hidden rounded-xl border bg-card">
          <header className="flex h-12 items-center justify-between border-b px-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <WandSparkles className="h-4 w-4 text-primary" />
              Studio
            </div>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">新建</Button>
          </header>
          <div className="space-y-2 p-3">
            {AI_LEARNING_DEMO.assets.map((asset) => (
              <AssetCard key={asset.type} asset={asset} generating={generating} />
            ))}
          </div>
          <div className="mx-3 rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
            <div className="flex items-center justify-between">
              <span>{generating ? '正在生成 6 类学习资产' : '多模态资产已全部就绪'}</span>
              <span className="font-mono">{generating ? '76%' : '100%'}</span>
            </div>
            <Progress value={generating ? 76 : 100} className="mt-2 h-1.5" />
          </div>
        </section>

        <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
          <header className="flex h-12 items-center justify-between border-b px-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {showQuiz ? <FileCheck2 className="h-4 w-4 text-primary" /> : <BookOpen className="h-4 w-4 text-primary" />}
              {showQuiz ? 'QKV 概念诊断' : generating ? '正在生成学习资产' : '多模态学习资产'}
            </div>
            {!generating && <Badge variant="secondary">由 4 个来源生成</Badge>}
          </header>

          <div className="h-[calc(100%-3rem)] overflow-y-auto p-4 lg:p-5">
            {generating && (
              <div className="grid h-full place-items-center">
                <div className="w-full max-w-lg rounded-2xl border bg-primary/5 p-8 text-center">
                  <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                    <WandSparkles className="h-6 w-6" />
                  </span>
                  <h2 className="mt-4 text-lg font-semibold">正在生成个性化多模态资产</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    资源生成智能体正在把画像、对话和 DeepSearch 证据编排为指南、导图、辅助图片、讲解视频、播客和 Quiz。
                  </p>
                  <Progress value={76} className="mx-auto mt-5 h-2 max-w-sm" />
                  <p className="mt-2 font-mono text-xs text-primary">5 / 6 已完成</p>
                </div>
              </div>
            )}

            {!generating && !showQuiz && (
              <div className="grid gap-4 lg:grid-cols-2" data-testid="multimodal-assets">
                <article className="rounded-xl border bg-background p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold">
                      <BookOpen className="h-4 w-4 text-primary" />
                      学习指南
                    </div>
                    <Badge variant="outline">8 分钟</Badge>
                  </div>
                  <h2 className="mt-4 text-lg font-semibold">QKV：从检索类比到矩阵运算</h2>
                  <div className="mt-4 space-y-2">
                    {AI_LEARNING_DEMO.guideSections.map((section, index) => (
                      <div key={section} className="flex gap-3 rounded-lg bg-muted/35 px-3 py-2.5 text-xs leading-5">
                        <span className="font-mono text-primary">0{index + 1}</span>
                        {section}
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <FileCheck2 className="h-3.5 w-3.5 text-emerald-500" />
                    4 处引用均可回溯原始来源
                  </div>
                </article>

                <article className="rounded-xl border bg-background p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold">
                      <Map className="h-4 w-4 text-primary" />
                      思维导图
                    </div>
                    <Badge variant="outline">12 个节点</Badge>
                  </div>
                  <div className="relative mt-5 flex min-h-56 items-center justify-center rounded-xl bg-gradient-to-br from-primary/5 to-violet-500/10 p-4">
                    <span className="relative z-10 flex h-20 w-20 items-center justify-center rounded-full border-2 border-primary bg-background text-center text-sm font-semibold shadow-sm">
                      Attention
                    </span>
                    <div className="grid flex-1 grid-cols-2 gap-3 pl-6">
                      {AI_LEARNING_DEMO.mindMapBranches.map((branch) => (
                        <div key={branch.label} className="relative rounded-lg border bg-background px-3 py-2 shadow-sm">
                          <span className="absolute -left-6 top-1/2 h-px w-6 bg-primary/40" />
                          <p className="text-xs font-semibold text-primary">{branch.label}</p>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">{branch.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </article>

                <article className="rounded-xl border bg-background p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold">
                      <ImageIcon className="h-4 w-4 text-primary" />
                      辅助图片
                    </div>
                    <Badge variant="outline">1600 × 900</Badge>
                  </div>
                  <div className="mt-4 min-h-56 overflow-hidden rounded-xl border bg-gradient-to-br from-sky-950 via-indigo-950 to-violet-950 p-5 text-white">
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-sky-200">
                      <span>QKV information flow</span>
                      <span>01 / 03</span>
                    </div>
                    <div className="mt-6 flex items-center justify-between gap-2">
                      {[
                        ['Q', '查询'],
                        ['K', '索引'],
                        ['V', '内容'],
                      ].map(([symbol, label]) => (
                        <div key={symbol} className="flex flex-1 flex-col items-center">
                          <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/25 bg-white/10 text-xl font-semibold shadow-lg backdrop-blur">
                            {symbol}
                          </span>
                          <span className="mt-2 text-[10px] text-sky-100">{label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-5 flex items-center justify-center gap-2 text-[11px] font-medium">
                      <span className="rounded-full bg-sky-400/20 px-3 py-1.5">QKᵀ</span>
                      <ArrowRight className="h-3.5 w-3.5 text-sky-300" />
                      <span className="rounded-full bg-violet-400/20 px-3 py-1.5">softmax</span>
                      <ArrowRight className="h-3.5 w-3.5 text-violet-300" />
                      <span className="rounded-full bg-fuchsia-400/20 px-3 py-1.5">× Value</span>
                    </div>
                    <p className="mt-4 text-center text-[10px] leading-4 text-slate-300">
                      相似度决定权重，权重决定每条信息对当前输出的贡献
                    </p>
                  </div>
                </article>

                <article className="rounded-xl border bg-background p-5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 font-semibold">
                      <Video className="h-4 w-4 text-primary" />
                      讲解视频
                    </div>
                    <Badge variant="outline">03:18</Badge>
                  </div>
                  <div className="group relative mt-4 flex min-h-56 overflow-hidden rounded-xl bg-slate-950 text-white">
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_30%,rgba(56,189,248,.35),transparent_28%),radial-gradient(circle_at_78%_65%,rgba(168,85,247,.35),transparent_30%)]" />
                    <div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:28px_28px]" />
                    <div className="relative flex flex-1 flex-col justify-between p-4">
                      <div className="flex items-center justify-between">
                        <Badge className="bg-white/10 text-white hover:bg-white/10">动态讲解 · 第 2 章</Badge>
                        <Badge className="bg-black/50 text-white hover:bg-black/50">CC 字幕</Badge>
                      </div>
                      <div className="flex flex-col items-center">
                        <Button
                          size="icon"
                          className="h-14 w-14 rounded-full bg-white text-slate-950 shadow-xl hover:bg-white/90"
                          aria-label="播放讲解视频"
                        >
                          <Play className="ml-0.5 h-5 w-5 fill-current" />
                        </Button>
                        <p className="mt-3 text-sm font-semibold">一次注意力计算是怎样完成的？</p>
                        <p className="mt-1 text-[10px] text-slate-300">QKᵀ → softmax → Value 加权聚合</p>
                      </div>
                      <div>
                        <div className="h-1 overflow-hidden rounded-full bg-white/20">
                          <div className="h-full w-[42%] rounded-full bg-sky-400" />
                        </div>
                        <div className="mt-2 flex justify-between font-mono text-[10px] text-slate-300">
                          <span>01:23</span>
                          <span>03:18 · 1080p</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>

                <article className="rounded-xl border bg-background p-5 lg:col-span-2">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-violet-500 text-white">
                      <Volume2 className="h-6 w-6" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{AI_LEARNING_DEMO.podcast.title}</p>
                        <Badge variant="secondary">学习播客</Badge>
                        <Badge variant="outline">已生成字幕</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{AI_LEARNING_DEMO.podcast.transcript}</p>
                    </div>
                    <Button size="icon" className="h-10 w-10 shrink-0 rounded-full" aria-label="播放播客">
                      <Play className="h-4 w-4 fill-current" />
                    </Button>
                  </div>
                  <div className="mt-4 flex items-center gap-3">
                    <span className="font-mono text-xs text-muted-foreground">{AI_LEARNING_DEMO.podcast.currentTime}</span>
                    <Progress value={35} className="h-1.5 flex-1" />
                    <span className="font-mono text-xs text-muted-foreground">{AI_LEARNING_DEMO.podcast.duration}</span>
                  </div>
                </article>
              </div>
            )}

            {showQuiz && (
              <div className="mx-auto max-w-3xl space-y-4">
                {showUpdate && (
                  <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4" data-testid="profile-writeback">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white">
                        <Brain className="h-5 w-5" />
                      </span>
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">学习画像已自动回写</p>
                          <Badge className="bg-emerald-500 text-white hover:bg-emerald-500">+8%</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{AI_LEARNING_DEMO.profileUpdate.evidence}</p>
                      </div>
                      <div className="min-w-36">
                        <div className="flex items-center justify-between text-xs">
                          <span>{AI_LEARNING_DEMO.profileUpdate.dimension}</span>
                          <span className="font-semibold text-emerald-600">
                            {AI_LEARNING_DEMO.profileUpdate.before}% → {AI_LEARNING_DEMO.profileUpdate.after}%
                          </span>
                        </div>
                        <Progress value={AI_LEARNING_DEMO.profileUpdate.after} className="mt-2 h-2" />
                      </div>
                    </div>
                  </div>
                )}

                <article className="rounded-xl border bg-background p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-primary">第 3 / 5 题 · 概念理解</p>
                      <h2 className="mt-2 text-lg font-semibold leading-7">{AI_LEARNING_DEMO.quiz.question}</h2>
                    </div>
                    <Badge variant="outline">难度自适应</Badge>
                  </div>
                  <div className="mt-5 grid gap-2 sm:grid-cols-2">
                    {AI_LEARNING_DEMO.quiz.options.map((option, index) => {
                      const correct = option === AI_LEARNING_DEMO.quiz.answer
                      return (
                        <div
                          key={option}
                          className={cn(
                            'flex items-center gap-3 rounded-lg border px-3 py-3 text-sm',
                            correct && 'border-emerald-500/40 bg-emerald-500/5'
                          )}
                        >
                          <span className={cn(
                            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs',
                            correct && 'border-emerald-500 bg-emerald-500 text-white'
                          )}>
                            {correct ? <Check className="h-3.5 w-3.5" /> : String.fromCharCode(65 + index)}
                          </span>
                          {option}
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="h-4 w-4" />
                      回答正确
                    </div>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{AI_LEARNING_DEMO.quiz.explanation}</p>
                  </div>
                </article>

                {showUpdate && (
                  <div className="rounded-xl border bg-card p-4">
                    <p className="text-xs font-medium text-muted-foreground">下一步学习路径</p>
                    <div className="mt-2 flex items-center justify-between gap-4">
                      <p className="text-sm font-medium">{AI_LEARNING_DEMO.profileUpdate.next}</p>
                      <Button size="sm" className="shrink-0 gap-2">
                        继续学习
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function DemoControl({
  step,
  onRestart,
}: {
  step: number
  onRestart: () => void
}) {
  const complete = step >= AI_LEARNING_DEMO_TOTAL_STEPS
  const nextStep = AI_LEARNING_DEMO_STEPS[Math.min(step + 1, AI_LEARNING_DEMO_TOTAL_STEPS)]

  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full border bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      {complete ? (
        <>
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          <span className="font-medium">展示完成</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-full"
            onClick={onRestart}
            aria-label="重新开始"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        </>
      ) : (
        <>
          <Keyboard className="h-4 w-4 text-primary" />
          <span className="hidden text-muted-foreground sm:inline">空格</span>
          <span className="hidden font-medium md:inline">下一步：{nextStep.label}</span>
        </>
      )}
      <span className="border-l pl-2 font-mono text-[11px] text-muted-foreground" data-testid="demo-step-counter">
        {step} / {AI_LEARNING_DEMO_TOTAL_STEPS}
      </span>
    </div>
  )
}

export function AiLearningDemo() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const rawRequestedStep = searchParams?.get('step')
  const requestedStep = rawRequestedStep === null || rawRequestedStep === undefined
    ? Number.NaN
    : Number(rawRequestedStep)
  const initialStep = Number.isInteger(requestedStep) && requestedStep >= 0
    ? Math.min(requestedStep, AI_LEARNING_DEMO_TOTAL_STEPS)
    : defaultDemoStepForPath(pathname)
  const [step, setStep] = useState(initialStep)

  useEffect(() => {
    setStep(initialStep)
  }, [initialStep])

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
  }, [step])

  useEffect(() => {
    const advance = (event: KeyboardEvent) => {
      if (event.repeat || (event.code !== 'Space' && event.key !== ' ')) return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      const next = Math.min(step + 1, AI_LEARNING_DEMO_TOTAL_STEPS)
      if (next === step) return
      setStep(next)
      router.push(demoStepHref(next))
    }

    window.addEventListener('keydown', advance)
    return () => window.removeEventListener('keydown', advance)
  }, [router, step])

  const scene = useMemo(() => AI_LEARNING_DEMO_STEPS[step].scene, [step])

  return (
    <div
      ref={scrollContainerRef}
      className="relative min-h-0 flex-1 overflow-y-auto bg-muted/10"
      data-testid="ai-learning-demo"
      data-scene={scene}
    >
      {scene === 'notebook' && <NotebookScene step={step} />}
      {scene === 'search' && <SearchScene step={step} />}
      {scene === 'workflow' && <WorkflowScene step={step} />}
      {scene === 'studio' && <StudioScene step={step} />}
      <DemoControl
        step={step}
        onRestart={() => {
          setStep(0)
          router.push(demoStepHref(0))
        }}
      />
    </div>
  )
}

export function AiLearningDemoPage() {
  const pathname = usePathname()
  const title = pathname?.startsWith('/search/')
    ? 'DeepSearch'
    : pathname?.startsWith('/workflow/')
      ? 'Agent 监督台'
      : AI_LEARNING_DEMO.notebookName

  return (
    <AppShell runtimeStatus={false} title={<span className="truncate text-xl font-semibold tracking-tight">{title}</span>}>
      <AiLearningDemo />
    </AppShell>
  )
}
