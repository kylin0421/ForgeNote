'use client'

import { useEffect, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  Circle,
  FileCode2,
  FileText,
  Gauge,
  Keyboard,
  LoaderCircle,
  MessageSquare,
  RotateCcw,
  Search,
  Sparkles,
  Target,
  WandSparkles,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import {
  AI_LEARNING_DEMO,
  AI_LEARNING_DEMO_STEP_LABELS,
  AI_LEARNING_DEMO_TOTAL_STEPS,
} from '@/lib/demo/ai-learning-demo'

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  if (target.matches('input, textarea, select')) return true
  return target.isContentEditable || Boolean(target.closest('[contenteditable="true"]'))
}

function StagePlaceholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-28 items-center justify-center rounded-xl border border-dashed bg-muted/20 px-5 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

function StageLabel({ step, active }: { step: number; active: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-full border bg-background/90 px-3 py-1.5 text-xs shadow-sm transition-colors',
        active && 'border-primary/40 text-primary'
      )}
      aria-current={active ? 'step' : undefined}
    >
      <span className="font-mono text-[11px]">{String(step).padStart(2, '0')}</span>
      <span className="font-medium">{AI_LEARNING_DEMO_STEP_LABELS[step]}</span>
    </div>
  )
}

export function AiLearningDemo() {
  const [step, setStep] = useState(0)

  useEffect(() => {
    // This page intentionally starts as a new notebook on every mount. Nothing
    // is persisted: the entire demo timeline is bundled with the frontend.
    setStep(0)

    const advance = (event: KeyboardEvent) => {
      if (event.repeat || (event.code !== 'Space' && event.key !== ' ')) return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      setStep((current) => Math.min(current + 1, AI_LEARNING_DEMO_TOTAL_STEPS))
    }

    window.addEventListener('keydown', advance)
    return () => window.removeEventListener('keydown', advance)
  }, [])

  const progress = (step / AI_LEARNING_DEMO_TOTAL_STEPS) * 100
  const isComplete = step === AI_LEARNING_DEMO_TOTAL_STEPS

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="ai-learning-demo">
      <div className="shrink-0 border-b bg-gradient-to-r from-primary/10 via-background to-violet-500/10 px-4 py-3 lg:px-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
              <Brain className="h-5 w-5" />
              {step >= 2 && (
                <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-background">
                  <Check className="h-2.5 w-2.5 text-white" />
                </span>
              )}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">8 维动态学生画像</h2>
                <Badge variant="secondary" className="gap-1 bg-primary/10 text-primary">
                  <Sparkles className="h-3 w-3" />
                  演示模式
                </Badge>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {step < 2
                  ? '等待画像访谈完成，随后将贯穿对话、资料推荐、生成与评估。'
                  : '已启用：图解优先 · 实践导向 · 自动根据学习证据更新'}
              </p>
            </div>
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto xl:justify-center">
            {[0, 2, 4, 6, 8, 9].map((value, index, values) => (
              <div key={value} className="flex shrink-0 items-center gap-2">
                <StageLabel step={value} active={step === value} />
                {index < values.length - 1 && (
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50" />
                )}
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-2 self-start rounded-full xl:self-auto"
            onClick={() => setStep(0)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            重新演示
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3 lg:p-4">
        <div className="grid min-h-full grid-cols-1 gap-3 lg:grid-cols-[minmax(17rem,0.9fr)_minmax(30rem,1.5fr)_minmax(18rem,0.9fr)]">
          <section className="flex min-h-[34rem] min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
            <header className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2 font-semibold">
                <MessageSquare className="h-4 w-4 text-primary" />
                对话
              </div>
              <Badge variant="outline" className="text-[10px]">画像驱动</Badge>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4" aria-live="polite">
              {step === 0 && (
                <StagePlaceholder>
                  这是一个崭新的学习记录。按下空格，从画像访谈开始。
                </StagePlaceholder>
              )}

              {step >= 1 && (
                <div className="rounded-2xl rounded-tl-md bg-muted px-4 py-3 text-sm leading-6">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
                    <Brain className="h-3.5 w-3.5" />
                    画像访谈
                  </div>
                  {AI_LEARNING_DEMO.profileQuestion}
                </div>
              )}

              {step >= 2 && (
                <>
                  <div className="ml-8 rounded-2xl rounded-tr-md bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">
                    {AI_LEARNING_DEMO.profileAnswer}
                  </div>
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="h-4 w-4" />
                      学习画像已建立
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      {AI_LEARNING_DEMO.profileDimensions.map((dimension) => (
                        <div key={dimension.label} className="rounded-lg bg-background/80 p-2">
                          <div className="text-[10px] text-muted-foreground">{dimension.label}</div>
                          <div className="mt-0.5 text-xs font-medium">{dimension.value}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {step >= 3 && (
                <div className="ml-8 rounded-2xl rounded-tr-md bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">
                  {AI_LEARNING_DEMO.userQuestion}
                </div>
              )}

              {step >= 4 && (
                <div className="rounded-2xl rounded-tl-md border bg-background px-4 py-3 text-sm leading-6 shadow-sm">
                  <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
                    <Bot className="h-3.5 w-3.5" />
                    AI 导师 · 已按画像调整
                  </div>
                  {AI_LEARNING_DEMO.assistantAnswer}
                </div>
              )}

              {step >= 5 && (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs">
                  <div className="mb-2 flex items-center gap-2 font-medium text-primary">
                    <Target className="h-3.5 w-3.5" />
                    Agent 已制定下一步学习路径
                  </div>
                  <ol className="space-y-1.5 text-muted-foreground">
                    {AI_LEARNING_DEMO.orchestration.map((item, index) => (
                      <li key={item} className="flex gap-2">
                        <span className="font-mono text-primary">{index + 1}.</span>
                        {item}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>

            <div className="border-t p-3">
              <input
                aria-label="演示输入框"
                className="h-10 w-full rounded-xl border bg-muted/20 px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
                placeholder="演示模式下无需输入，按空格继续…"
              />
            </div>
          </section>

          <section className="flex min-h-[34rem] min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
            <header className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2 font-semibold">
                <BookOpen className="h-4 w-4 text-primary" />
                学习资料
              </div>
              <Badge variant={step >= 6 ? 'default' : 'secondary'}>
                {step >= 6 ? '3 项已就绪' : '等待调度'}
              </Badge>
            </header>

            <div className="flex-1 overflow-auto p-4" aria-live="polite">
              {step < 5 && (
                <StagePlaceholder>提出问题后，Agent 会在这里自动调度和筛选资料。</StagePlaceholder>
              )}

              {step === 5 && (
                <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border bg-primary/5 text-center">
                  <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Search className="h-5 w-5" />
                    <LoaderCircle className="absolute h-12 w-12 animate-spin text-primary/40" />
                  </span>
                  <p className="mt-3 text-sm font-medium">正在并行检索与评估资料</p>
                  <p className="mt-1 text-xs text-muted-foreground">相关性 · 权威性 · 画像适配度</p>
                </div>
              )}

              {step >= 6 && (
                <div className="space-y-3">
                  {AI_LEARNING_DEMO.sources.map((source, index) => (
                    <article
                      key={source.title}
                      className={cn(
                        'rounded-xl border bg-gradient-to-br p-4 transition-colors',
                        source.accent
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-background/80 text-primary shadow-sm">
                          {index === 0 ? <FileText className="h-4 w-4" /> : index === 1 ? <Gauge className="h-4 w-4" /> : <FileCode2 className="h-4 w-4" />}
                        </span>
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold">{source.title}</h3>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">{source.meta}</p>
                          <p className="mt-2 text-xs leading-5">{source.insight}</p>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}

              {step >= 7 && (
                <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
                  <div className="flex items-center gap-2 text-sm font-medium text-primary">
                    {step === 7 ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    {step === 7 ? AI_LEARNING_DEMO.generationTask.title : '学习资产生成完成'}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    {AI_LEARNING_DEMO.generationTask.detail}
                  </p>
                  <Progress value={step === 7 ? 68 : 100} className="mt-3 h-1.5" />
                </div>
              )}
            </div>
          </section>

          <section className="flex min-h-[34rem] min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
            <header className="flex items-center justify-between border-b px-4 py-3">
              <div className="flex items-center gap-2 font-semibold">
                <WandSparkles className="h-4 w-4 text-primary" />
                Studio
              </div>
              <Badge variant="outline">学习资产</Badge>
            </header>

            <div className="flex-1 overflow-auto p-4" aria-live="polite">
              {step < 8 ? (
                <StagePlaceholder>资料准备好后，生成的学习资产会出现在这里。</StagePlaceholder>
              ) : (
                <div className="space-y-3">
                  <article className="overflow-hidden rounded-xl border bg-background shadow-sm">
                    <div className="bg-gradient-to-br from-primary/20 via-violet-500/10 to-background p-5">
                      <div className="flex items-center justify-between">
                        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                          <WandSparkles className="h-5 w-5" />
                        </span>
                        <Badge className="bg-emerald-500 text-white hover:bg-emerald-500">已生成</Badge>
                      </div>
                      <h3 className="mt-5 text-lg font-semibold leading-6">{AI_LEARNING_DEMO.studioAsset.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {AI_LEARNING_DEMO.studioAsset.type} · {AI_LEARNING_DEMO.studioAsset.duration}
                      </p>
                    </div>
                    <div className="space-y-2 p-4">
                      {AI_LEARNING_DEMO.studioAsset.sections.map((section, index) => (
                        <div key={section} className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                          <span className="font-mono text-muted-foreground">0{index + 1}</span>
                          {section}
                        </div>
                      ))}
                    </div>
                  </article>

                  {step >= 9 && (
                    <article className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
                      <div className="flex items-center gap-2 text-sm font-semibold text-violet-700 dark:text-violet-300">
                        <Target className="h-4 w-4" />
                        课后 Quiz
                      </div>
                      <p className="mt-3 text-sm leading-6">{AI_LEARNING_DEMO.quiz.question}</p>
                      <div className="mt-3 space-y-2">
                        {AI_LEARNING_DEMO.quiz.options.map((option) => {
                          const correct = option === AI_LEARNING_DEMO.quiz.answer
                          return (
                            <div
                              key={option}
                              className={cn(
                                'flex items-center gap-2 rounded-lg border bg-background px-3 py-2 text-xs',
                                correct && 'border-emerald-500/30 bg-emerald-500/5'
                              )}
                            >
                              {correct ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                              ) : (
                                <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                              {option}
                            </div>
                          )
                        })}
                      </div>
                      <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                        {AI_LEARNING_DEMO.quiz.feedback}
                      </div>
                    </article>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>

      <footer className="shrink-0 border-t bg-background/95 px-4 py-3 backdrop-blur lg:px-6">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Keyboard className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium">
                {isComplete ? '演示完成' : '按空格键进入下一步'}
              </span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground" data-testid="demo-step-counter">
                {step} / {AI_LEARNING_DEMO_TOTAL_STEPS}
              </span>
            </div>
            <Progress value={progress} className="mt-2 h-1.5" />
          </div>
          <kbd className="hidden rounded-lg border bg-muted px-3 py-1.5 font-mono text-xs font-semibold shadow-sm sm:block">
            SPACE
          </kbd>
        </div>
      </footer>
    </div>
  )
}
