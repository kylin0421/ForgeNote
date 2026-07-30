'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  Brain,
  CheckCircle2,
  Gauge,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'
import { learningApi } from '@/lib/api/learning'
import type { NotebookResponse } from '@/lib/types/api'
import type {
  LearningProfileInterviewQuestion,
  LearningProfileInterviewResponse,
  LearningProfileInterviewTurn,
} from '@/lib/types/learning'
import { cn } from '@/lib/utils'

export type ProfileInterviewTurn = {
  question: LearningProfileInterviewQuestion
  answer: string
}

export type CachedProfileOnboardingState = {
  turns: ProfileInterviewTurn[]
  interview: LearningProfileInterviewResponse | null
  initialInterview?: LearningProfileInterviewResponse | null
  nextInterview?: LearningProfileInterviewResponse | null
  isLoadingQuestion?: boolean
}

function compactProfileValue(value?: string) {
  const normalized = (value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return '等待对话中提取'
  return normalized.length > 86 ? `${normalized.slice(0, 85)}…` : normalized
}

function safeSummaryValue(value?: string) {
  return (value || '尚未明确')
    .replace(/[;\n\r]+/g, '；')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 600)
}

function apiErrorMessage(error: unknown) {
  if (
    error &&
    typeof error === 'object' &&
    'response' in error &&
    error.response &&
    typeof error.response === 'object' &&
    'data' in error.response &&
    error.response.data &&
    typeof error.response.data === 'object' &&
    'detail' in error.response.data &&
    typeof error.response.data.detail === 'string'
  ) {
    return error.response.data.detail
  }
  return '动态问题生成失败，请检查语言模型设置后重试。'
}

const PROFILE_VISUAL_META: Record<string, { label: string; short: string; accent: string }> = {
  major: { label: '专业背景', short: '背景', accent: 'bg-sky-500' },
  goal: { label: '学习目标', short: '目标', accent: 'bg-emerald-500' },
  knowledge: { label: '知识基础', short: '基础', accent: 'bg-indigo-500' },
  learning_history: { label: '学习经历', short: '经历', accent: 'bg-amber-500' },
  cognitive_style: { label: '认知风格', short: '风格', accent: 'bg-fuchsia-500' },
  mistakes: { label: '易错点', short: '风险', accent: 'bg-rose-500' },
  pace: { label: '学习节奏', short: '节奏', accent: 'bg-cyan-500' },
  resource_preference: { label: '资源偏好', short: '资源', accent: 'bg-lime-500' },
}

function profileConfidenceScore(value?: string, confidence = 0) {
  if (!value?.trim()) return 0
  return Math.max(0, Math.min(100, Math.round(confidence * 100)))
}

function ProfileRadar({
  dimensions,
}: {
  dimensions: LearningProfileInterviewResponse['profile']
}) {
  const size = 214
  const center = size / 2
  const radius = 76
  const axes = dimensions
  const points = axes.map((dimension, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(axes.length, 1)) * Math.PI * 2
    const score = profileConfidenceScore(dimension.value, dimension.confidence) / 100
    return {
      x: center + Math.cos(angle) * radius * score,
      y: center + Math.sin(angle) * radius * score,
      labelX: center + Math.cos(angle) * (radius + 22),
      labelY: center + Math.sin(angle) * (radius + 22),
      axisX: center + Math.cos(angle) * radius,
      axisY: center + Math.sin(angle) * radius,
      short: PROFILE_VISUAL_META[dimension.key]?.short || dimension.label.slice(0, 2),
    }
  })
  const polygon = points.map((point) => `${point.x},${point.y}`).join(' ')

  return (
    <div className="rounded-2xl border bg-background p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">画像雷达</p>
          <p className="text-xs text-muted-foreground">越靠外，证据越充分</p>
        </div>
        <Gauge className="h-4 w-4 text-primary" />
      </div>
      <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto h-56 w-full max-w-64" role="img" aria-label="学习画像雷达图">
        <defs>
          <linearGradient id="profile-radar-fill" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#22c55e" stopOpacity="0.2" />
          </linearGradient>
        </defs>
        {[0.35, 0.65, 1].map((scale) => (
          <circle
            key={scale}
            cx={center}
            cy={center}
            r={radius * scale}
            className="fill-none stroke-border"
            strokeDasharray={scale === 1 ? undefined : '4 5'}
          />
        ))}
        {points.map((point) => (
          <g key={point.short}>
            <line x1={center} y1={center} x2={point.axisX} y2={point.axisY} className="stroke-border" />
            <text x={point.labelX} y={point.labelY} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-[10px]">
              {point.short}
            </text>
          </g>
        ))}
        {polygon && <polygon points={polygon} fill="url(#profile-radar-fill)" stroke="#0284c7" strokeWidth="2.5" />}
        {points.map((point) => (
          <circle key={`${point.short}-point`} cx={point.x} cy={point.y} r="4" className="fill-background stroke-primary" strokeWidth="2" />
        ))}
      </svg>
    </div>
  )
}

function ProfileDimensionCard({
  dimension,
  index,
}: {
  dimension: LearningProfileInterviewResponse['profile'][number]
  index: number
}) {
  const meta = PROFILE_VISUAL_META[dimension.key] || {
    label: dimension.label,
    short: dimension.label.slice(0, 2),
    accent: 'bg-primary',
  }
  const score = profileConfidenceScore(dimension.value, dimension.confidence)
  const filled = Boolean(dimension.value?.trim())

  return (
    <div className={cn('rounded-xl border bg-background p-3 shadow-sm transition-colors', filled && 'border-primary/25')}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('h-2.5 w-2.5 rounded-full', meta.accent)} />
          <p className="truncate text-sm font-medium">{meta.label}</p>
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">{filled ? `${score}%` : `${index + 1}/8`}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <span className={cn('block h-full rounded-full', meta.accent)} style={{ width: `${score}%` }} />
      </div>
      <p className={cn('mt-2 line-clamp-2 text-xs leading-5', !filled && 'text-muted-foreground')}>
        {compactProfileValue(dimension.value)}
      </p>
      {dimension.evidence && (
        <p className="mt-2 line-clamp-2 rounded-lg bg-muted/45 px-2 py-1.5 text-[11px] leading-4 text-muted-foreground">
          证据：{dimension.evidence}
        </p>
      )}
    </div>
  )
}

function toApiTurns(turns: ProfileInterviewTurn[]): LearningProfileInterviewTurn[] {
  return turns.map(({ question, answer }) => ({
    question_id: question.id,
    dimension: question.dimension,
    question: question.prompt,
    answer,
  }))
}

interface ProfileOnboardingDialogProps {
  open: boolean
  notebook: NotebookResponse | null
  onCompleted: (resourceSearchGoal: string) => void
  cachedState?: CachedProfileOnboardingState
}

export function ProfileOnboardingDialog({
  open,
  notebook,
  onCompleted,
  cachedState,
}: ProfileOnboardingDialogProps) {
  const [turns, setTurns] = useState<ProfileInterviewTurn[]>([])
  const [interview, setInterview] = useState<LearningProfileInterviewResponse | null>(null)
  const [draft, setDraft] = useState('')
  const [isLoadingQuestion, setIsLoadingQuestion] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [questionError, setQuestionError] = useState('')
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  const notebookId = notebook?.id || ''
  const notebookTitle = notebook?.name || '新的学习主题'
  const notebookContext = [notebookTitle, notebook?.description]
    .filter(Boolean)
    .join('；')
    .slice(0, 300)
  const currentQuestion = interview?.question || null
  const reviewing = Boolean(interview?.complete)
  const progress = interview?.progress ?? Math.min(94, turns.length * 12)
  const profileDimensions = interview?.profile || []
  const filledProfileCount = profileDimensions.filter((dimension) => dimension.value.trim()).length
  const averageConfidence = profileDimensions.length > 0
    ? Math.round(
      profileDimensions.reduce(
        (sum, dimension) => sum + profileConfidenceScore(dimension.value, dimension.confidence),
        0
      ) / profileDimensions.length
    )
    : 0

  const requestNextQuestion = async (
    nextTurns: ProfileInterviewTurn[],
    options?: { silentReset?: boolean }
  ) => {
    if (cachedState) return
    if (!notebookId) return
    if (!options?.silentReset) {
      setQuestionError('')
    }
    setIsLoadingQuestion(true)
    try {
      const response = await learningApi.nextProfileInterviewQuestion({
        learning_record_id: notebookId,
        topic: notebookContext,
        turns: toApiTurns(nextTurns),
        target_language: 'zh-CN',
      })
      setInterview(response)
      setQuestionError('')
    } catch (error) {
      console.error('Failed to generate adaptive profile question:', error)
      setInterview(null)
      setQuestionError(apiErrorMessage(error))
    } finally {
      setIsLoadingQuestion(false)
    }
  }

  useEffect(() => {
    if (!open || !notebookId) return

    if (cachedState) {
      setTurns(cachedState.turns)
      setInterview(cachedState.interview)
      setDraft('')
      setIsSaving(false)
      setQuestionError('')
      setIsLoadingQuestion(Boolean(cachedState.isLoadingQuestion))
      return
    }

    let cancelled = false

    setTurns([])
    setInterview(null)
    setDraft('')
    setIsSaving(false)
    setQuestionError('')
    setIsLoadingQuestion(true)

    learningApi.nextProfileInterviewQuestion({
      learning_record_id: notebookId,
      topic: notebookContext,
      turns: [],
      target_language: 'zh-CN',
    }).then((response) => {
      if (cancelled) return
      setInterview(response)
    }).catch((error) => {
      if (cancelled) return
      console.error('Failed to start adaptive profile interview:', error)
      setQuestionError(apiErrorMessage(error))
    }).finally(() => {
      if (!cancelled) setIsLoadingQuestion(false)
    })

    return () => {
      cancelled = true
    }
  }, [cachedState, notebookContext, notebookId, open])

  useEffect(() => {
    if (typeof messagesEndRef.current?.scrollIntoView === 'function') {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [interview, isLoadingQuestion, turns])

  const submitAnswer = async () => {
    const answer = draft.trim()
    if (!answer || !currentQuestion || reviewing || isLoadingQuestion) return

    const nextTurns = [...turns, { question: currentQuestion, answer }]
    setTurns(nextTurns)
    setInterview(null)
    setDraft('')

    if (cachedState) {
      setInterview(cachedState.nextInterview ?? cachedState.interview)
      return
    }

    await requestNextQuestion(nextTurns)
  }

  const restartInterview = () => {
    setTurns([])
    setDraft('')
    if (cachedState) {
      setInterview(cachedState.initialInterview ?? cachedState.interview)
      return
    }
    setInterview(null)
    void requestNextQuestion([])
  }

  const saveProfile = async () => {
    if (!notebook || !interview?.complete || isSaving) return

    if (cachedState) {
      onCompleted(interview.search_goal || notebook.name)
      return
    }

    setIsSaving(true)

    const dimensionSummary = interview.profile
      .map((dimension) => (
        `${dimension.key}=${safeSummaryValue(dimension.value)}`
      ))
      .join('; ')
    const evidenceSummary = interview.profile
      .filter((dimension) => dimension.evidence)
      .map((dimension) => (
        `${dimension.key}_evidence=${safeSummaryValue(dimension.evidence)}`
      ))
      .join('; ')
    const summary = `${dimensionSummary}; ${evidenceSummary}`.slice(0, 12000)

    try {
      await learningApi.ensureProfileSource(notebook.id)
      await learningApi.recordProfileEvent({
        learning_record_id: notebook.id,
        event_type: 'initial_profile',
        summary,
        auto_update_profile: true,
      })
      toast.success('初始学习画像已建立', {
        description: '正在进入学习空间，并按画像准备资料搜索。',
      })
      onCompleted(interview.search_goal || notebook.name)
    } catch (error) {
      console.error('Failed to create initial learning profile:', error)
      toast.error('画像建立失败，请重试')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        className="h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-none grid-rows-[auto_minmax(0,1fr)] gap-0 p-0 sm:h-[min(94dvh,900px)] sm:w-[calc(100vw-2rem)] sm:max-w-[calc(100vw-2rem)] 2xl:max-w-[1800px]"
        onOpenAutoFocus={(event) => {
          if (cachedState) event.preventDefault()
        }}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="border-b bg-muted/20 px-4 py-4 pr-4 sm:px-6 sm:py-5 sm:pr-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Brain className="h-6 w-6" />
              </span>
              <div>
                <DialogTitle className="text-xl">先认识你，再开始找资料</DialogTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  LLM 动态访谈构建 8 维画像 · {notebookTitle}
                </p>
              </div>
            </div>
            <div className="min-w-52">
              <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                <span>
                  {reviewing
                    ? '画像已就绪'
                    : `已完成 ${turns.length} 轮 · 已覆盖 ${interview?.covered_dimensions.length || 0}/8 维`}
                </span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-1.5" />
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,.72fr)]">
          <section className="flex min-h-0 flex-col xl:border-r">
            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-6 sm:px-8">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div className="max-w-[88%] rounded-2xl rounded-tl-sm bg-muted px-4 py-3 text-sm leading-6">
                  我会根据你每一轮提供的信息实时生成下一问，不使用固定问卷。
                  描述得越具体，后面的资料、练习和学习路径就越贴合你。
                </div>
              </div>

              {turns.map((turn, index) => (
                <div key={`${turn.question.id}-${index}`} className="space-y-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {index + 1}
                    </span>
                    <div className="max-w-[88%] rounded-2xl rounded-tl-sm border bg-muted/50 px-4 py-3">
                      <p className="text-xs font-medium text-primary">{turn.question.eyebrow}</p>
                      <p className="mt-1 text-sm font-medium leading-6">{turn.question.prompt}</p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="max-w-[84%] rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">
                      {turn.answer}
                    </div>
                  </div>
                </div>
              ))}

              {currentQuestion && !reviewing && (
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                    {turns.length + 1}
                  </span>
                  <div className="max-w-[88%] rounded-2xl rounded-tl-sm border border-primary/30 bg-primary/5 px-4 py-3">
                    {interview?.assistant_message && (
                      <p className="mb-2 text-xs leading-5 text-muted-foreground">
                        {interview.assistant_message}
                      </p>
                    )}
                    <p className="text-xs font-medium text-primary">{currentQuestion.eyebrow}</p>
                    <p className="mt-1 text-sm font-medium leading-6">{currentQuestion.prompt}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{currentQuestion.helper}</p>
                  </div>
                </div>
              )}

              {isLoadingQuestion && (
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                  </span>
                  <div className="rounded-2xl rounded-tl-sm border border-dashed px-4 py-3 text-sm text-muted-foreground">
                    LLM 正在结合前面的回答生成下一问…
                  </div>
                </div>
              )}

              {questionError && (
                <div className="ml-11 max-w-[88%] rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
                  <p className="text-sm font-medium text-destructive">{questionError}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    onClick={() => void requestNextQuestion(turns)}
                  >
                    <RefreshCw className="mr-2 h-3.5 w-3.5" />
                    重新调用模型
                  </Button>
                </div>
              )}

              {reviewing && (
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                  </span>
                  <div className="max-w-[88%] rounded-2xl rounded-tl-sm border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-950">
                    {interview?.assistant_message || '画像信息已经足够具体。'}
                    确认后会直接进入对应学习空间，并按当前画像搜索视频、文章、网页、论文和练习。
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="border-t bg-background p-4 sm:p-5">
              {!reviewing ? (
                <>
                  {currentQuestion && currentQuestion.suggestions.length > 0 && (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {currentQuestion.suggestions.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
                          onClick={() =>
                            setDraft((current) => current ? `${current}；${suggestion}` : suggestion)
                          }
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-end gap-2">
                    <Textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      aria-label="学习画像回答输入框"
                      placeholder={
                        isLoadingQuestion
                          ? '正在生成下一问…'
                          : questionError
                            ? '请先重新调用模型'
                            : '像聊天一样详细说说…'
                      }
                      className="min-h-20 resize-none"
                      autoFocus={!cachedState}
                      disabled={!currentQuestion || isLoadingQuestion || Boolean(questionError)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault()
                          void submitAnswer()
                        }
                      }}
                    />
                    <Button
                      type="button"
                      size="icon"
                      className="h-11 w-11 shrink-0 rounded-full"
                      disabled={!draft.trim() || !currentQuestion || isLoadingQuestion}
                      onClick={() => void submitAnswer()}
                      aria-label="发送回答"
                    >
                      {isLoadingQuestion ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Enter 发送，Shift + Enter 换行</span>
                    <span>下一问会根据本轮内容动态变化</span>
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={restartInterview}
                    disabled={isSaving}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    重新访谈
                  </Button>
                  <Button type="button" onClick={saveProfile} disabled={isSaving}>
                    {isSaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-2 h-4 w-4" />
                    )}
                    保存画像并进入学习空间
                  </Button>
                </div>
              )}
            </div>
          </section>

          <aside className="hidden min-h-0 flex-col bg-muted/15 xl:flex">
            <div className="border-b px-5 py-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">动态画像预览</h3>
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                  LLM 实时抽取
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                每轮回答都会重新分析全部上下文，画像是后续路径、资料推荐和难度调整的首要依据。
              </p>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {profileDimensions.length > 0 ? (
                <>
                  <ProfileRadar dimensions={profileDimensions} />
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border bg-background p-3 shadow-sm">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Activity className="h-3.5 w-3.5 text-emerald-600" />
                        覆盖维度
                      </div>
                      <p className="mt-2 text-2xl font-semibold">{filledProfileCount}/8</p>
                    </div>
                    <div className="rounded-xl border bg-background p-3 shadow-sm">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Gauge className="h-3.5 w-3.5 text-sky-600" />
                        平均置信
                      </div>
                      <p className="mt-2 text-2xl font-semibold">{averageConfidence}%</p>
                    </div>
                  </div>
                  <div className="grid gap-3">
                    {profileDimensions.map((dimension, index) => (
                      <ProfileDimensionCard
                        key={dimension.key}
                        dimension={dimension}
                        index={index}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {isLoadingQuestion ? '正在建立第一版画像...' : '等待模型返回画像'}
                </div>
              )}
            </div>
            <div className="hidden">
              {(interview?.profile || []).map((dimension, index) => (
                <div
                  key={dimension.key}
                  className={cn(
                    'rounded-xl border bg-background p-3 transition-colors',
                    dimension.value && 'border-primary/25'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">{dimension.label}</p>
                    <span className="text-[10px] text-muted-foreground">
                      {dimension.value
                        ? `置信度 ${Math.round(dimension.confidence * 100)}%`
                        : `${index + 1}/8`}
                    </span>
                  </div>
                  <p className={cn('mt-1.5 text-sm leading-5', !dimension.value && 'text-muted-foreground')}>
                    {compactProfileValue(dimension.value)}
                  </p>
                </div>
              ))}
              {!interview && (
                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {isLoadingQuestion ? '正在建立第一版画像…' : '等待模型返回画像'}
                </div>
              )}
            </div>
            <div className="border-t p-4 text-xs leading-5 text-muted-foreground">
              完成后仍可随时查看并手动修改；新的对话、Quiz 和资料采纳会继续留下更新证据。
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  )
}
