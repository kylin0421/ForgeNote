'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Brain,
  CheckCircle2,
  Loader2,
  RotateCcw,
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
import { cn } from '@/lib/utils'

type SurveyKey =
  | 'goal'
  | 'motivation'
  | 'major'
  | 'knowledge'
  | 'history'
  | 'cognitiveStyle'
  | 'mistakes'
  | 'pace'
  | 'resourcePreference'

type SurveyAnswers = Partial<Record<SurveyKey, string>>

type SurveyQuestion = {
  key: SurveyKey
  eyebrow: string
  prompt: string
  helper: string
  suggestions: string[]
}

const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    key: 'goal',
    eyebrow: '学习目标',
    prompt: '这次你具体想学什么？希望在什么时间点达到怎样的程度？',
    helper: '可以像聊天一样回答，例如“3 周内学会概率论基础，能独立做完期末综合题”。',
    suggestions: ['备考一门课程', '完成一个项目', '系统入门新领域'],
  },
  {
    key: 'motivation',
    eyebrow: '学习动机',
    prompt: '为什么现在想学它？什么结果会让你觉得这次学习真的有价值？',
    helper: '考试、升学、工作、兴趣或项目都可以，越具体越容易制定合适路径。',
    suggestions: ['通过近期考试', '解决工作问题', '为项目补齐能力'],
  },
  {
    key: 'major',
    eyebrow: '专业背景',
    prompt: '说说你的专业、年级或工作方向，以及与这个主题有关的背景。',
    helper: '不需要填写表格，直接介绍自己即可。',
    suggestions: ['大学本科在读', '跨专业学习', '已经参加工作'],
  },
  {
    key: 'knowledge',
    eyebrow: '知识基础',
    prompt: '你现在已经会哪些？哪些只是听过，哪些还完全陌生？',
    helper: '如果方便，也可以用 0–10 分描述信心，并举一道能做或不会做的题。',
    suggestions: ['几乎从零开始', '懂概念但不会应用', '有基础想系统进阶'],
  },
  {
    key: 'history',
    eyebrow: '学习历史',
    prompt: '过去学过哪些相关课程、书、视频或项目？之前卡在哪里、为什么停下来？',
    helper: '这些历史会帮助系统避免重复讲解，也能识别真实先修缺口。',
    suggestions: ['看过一些视频', '做过相关项目', '学过但忘得比较多'],
  },
  {
    key: 'cognitiveStyle',
    eyebrow: '认知风格',
    prompt: '遇到新概念时，怎样讲你最容易理解？你通常先想看结构、例子、推导还是动手做？',
    helper: '也可以说说你最不喜欢的讲法。',
    suggestions: ['先看整体框架', '多举真实例子', '边写代码边理解'],
  },
  {
    key: 'mistakes',
    eyebrow: '易错点',
    prompt: '你学习时最常见的困难或错误是什么？最近有没有一道典型错题或一次卡住的经历？',
    helper: '例如记混概念、公式不会迁移、看懂但做不出、容易跳步骤。',
    suggestions: ['概念容易混淆', '看懂但不会做题', '容易粗心或跳步骤'],
  },
  {
    key: 'pace',
    eyebrow: '学习节奏',
    prompt: '你每周大概能投入多少时间？更适合短时间高频学习，还是集中成块学习？',
    helper: '也可以说明截止日期、容易学习的时段和希望多久测验一次。',
    suggestions: ['每天 30 分钟', '周末集中学习', '两周内冲刺完成'],
  },
  {
    key: 'resourcePreference',
    eyebrow: '资源偏好',
    prompt: '你更愿意用哪些资料学习？对视频、文章、网页、论文、语言和难度有什么偏好？',
    helper: '系统会据此组合视频封面卡、文章链接、网页资料和练习，并持续根据采纳行为调整。',
    suggestions: ['中文视频 + 讲义', '官方文档 + 实操', '论文 + 深度文章'],
  },
]

const PROFILE_LABELS: Array<{
  key: Exclude<SurveyKey, 'history'>
  label: string
}> = [
  { key: 'major', label: '专业背景' },
  { key: 'knowledge', label: '知识基础' },
  { key: 'goal', label: '学习目标' },
  { key: 'cognitiveStyle', label: '认知风格' },
  { key: 'pace', label: '学习节奏' },
  { key: 'mistakes', label: '易错点' },
  { key: 'resourcePreference', label: '资源偏好' },
  { key: 'motivation', label: '学习动机' },
]

function compactProfileValue(value?: string, fallback = '等待回答') {
  const normalized = (value || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return fallback
  return normalized.length > 70 ? `${normalized.slice(0, 69)}…` : normalized
}

function safeSummaryValue(value?: string) {
  return (value || '尚未明确')
    .replace(/[;\n\r]+/g, '，')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 420)
}

interface ProfileOnboardingDialogProps {
  open: boolean
  notebook: NotebookResponse | null
  onCompleted: (resourceSearchGoal: string) => void
}

export function ProfileOnboardingDialog({
  open,
  notebook,
  onCompleted,
}: ProfileOnboardingDialogProps) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<SurveyAnswers>({})
  const [draft, setDraft] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const reviewing = step >= SURVEY_QUESTIONS.length
  const currentQuestion = SURVEY_QUESTIONS[Math.min(step, SURVEY_QUESTIONS.length - 1)]
  const progress = reviewing ? 100 : Math.round((step / SURVEY_QUESTIONS.length) * 100)

  useEffect(() => {
    if (!open) return
    setStep(0)
    setAnswers({})
    setDraft('')
    setIsSaving(false)
  }, [notebook?.id, open])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [answers, step])

  const answeredQuestions = useMemo(
    () => SURVEY_QUESTIONS.slice(0, Math.min(step + (reviewing ? 0 : 1), SURVEY_QUESTIONS.length)),
    [reviewing, step]
  )

  const submitAnswer = () => {
    const answer = draft.trim()
    if (!answer || reviewing) return
    setAnswers((previous) => ({
      ...previous,
      [currentQuestion.key]: answer,
    }))
    setDraft('')
    setStep((current) => current + 1)
  }

  const saveProfile = async () => {
    if (!notebook || isSaving) return
    setIsSaving(true)
    const summary = [
      `major=${safeSummaryValue(answers.major)}`,
      `knowledge=${safeSummaryValue(answers.knowledge)}`,
      `history=${safeSummaryValue(answers.history)}`,
      `goal=${safeSummaryValue(answers.goal)}`,
      `cognitive_style=${safeSummaryValue(answers.cognitiveStyle)}`,
      `mistakes=${safeSummaryValue(answers.mistakes)}`,
      `pace=${safeSummaryValue(answers.pace)}`,
      `resource_preference=${safeSummaryValue(answers.resourcePreference)}`,
      `motivation=${safeSummaryValue(answers.motivation)}`,
    ].join('; ')

    try {
      await learningApi.ensureProfileSource(notebook.id)
      await learningApi.recordProfileEvent({
        learning_record_id: notebook.id,
        event_type: 'initial_profile',
        summary,
        auto_update_profile: true,
      })
      toast.success('初始学习画像已建立', {
        description: '接下来会按画像自动搜索视频、文章、网页和练习资料。',
      })
      onCompleted(safeSummaryValue(answers.goal).slice(0, 180))
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
        className="h-[min(90vh,840px)] grid-rows-[auto_minmax(0,1fr)] gap-0 p-0 sm:max-w-6xl"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="border-b bg-muted/20 px-6 py-5 pr-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Brain className="h-6 w-6" />
              </span>
              <div>
                <DialogTitle className="text-xl">先认识你，再开始找资料</DialogTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  对话式建立 8 维动态画像 · {notebook?.name || '新学习记录'}
                </p>
              </div>
            </div>
            <div className="min-w-48">
              <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                <span>{reviewing ? '画像预览' : `${step + 1} / ${SURVEY_QUESTIONS.length}`}</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} className="h-1.5" />
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,.8fr)]">
          <section className="flex min-h-0 flex-col border-r">
            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-6 sm:px-8">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div className="max-w-[88%] rounded-2xl rounded-tl-sm bg-muted px-4 py-3 text-sm leading-6">
                  你好！我会先通过几轮自然对话了解你的目标、基础和学习方式。
                  没有标准答案，描述得越具体，后面的资料和练习越贴合你。
                </div>
              </div>

              {answeredQuestions.map((question, index) => {
                const answer = answers[question.key]
                const isCurrent = index === step && !reviewing
                return (
                  <div key={question.key} className="space-y-4">
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                        {index + 1}
                      </span>
                      <div
                        className={cn(
                          'max-w-[88%] rounded-2xl rounded-tl-sm border px-4 py-3',
                          isCurrent ? 'border-primary/30 bg-primary/5' : 'bg-muted/50'
                        )}
                      >
                        <p className="text-xs font-medium text-primary">{question.eyebrow}</p>
                        <p className="mt-1 text-sm font-medium leading-6">{question.prompt}</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{question.helper}</p>
                      </div>
                    </div>
                    {answer && (
                      <div className="flex justify-end">
                        <div className="max-w-[84%] rounded-2xl rounded-tr-sm bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">
                          {answer}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              {reviewing && (
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" />
                  </span>
                  <div className="max-w-[88%] rounded-2xl rounded-tl-sm border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-950">
                    初始画像已经整理好。确认后我会先按画像搜索视频、文章、网页、论文和练习；
                    以后每次对话、测验和资料选择都会继续更新它。
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="border-t bg-background p-4 sm:p-5">
              {!reviewing ? (
                <>
                  <div className="mb-3 flex flex-wrap gap-2">
                    {currentQuestion.suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
                        onClick={() =>
                          setDraft((current) => current ? `${current}，${suggestion}` : suggestion)
                        }
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-end gap-2">
                    <Textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      placeholder="像聊天一样详细说说……"
                      className="min-h-20 resize-none"
                      autoFocus
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                          event.preventDefault()
                          submitAnswer()
                        }
                      }}
                    />
                    <Button
                      type="button"
                      size="icon"
                      className="h-11 w-11 shrink-0 rounded-full"
                      disabled={!draft.trim()}
                      onClick={submitAnswer}
                      aria-label="发送回答"
                    >
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Enter 发送，Shift + Enter 换行</span>
                    {step > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => {
                          const previousStep = step - 1
                          const previousQuestion = SURVEY_QUESTIONS[previousStep]
                          setDraft(answers[previousQuestion.key] || '')
                          setAnswers((current) => {
                            const next = { ...current }
                            delete next[previousQuestion.key]
                            return next
                          })
                          setStep(previousStep)
                        }}
                      >
                        返回上一题
                      </Button>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setStep(0)
                      setAnswers({})
                      setDraft('')
                    }}
                    disabled={isSaving}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    重新回答
                  </Button>
                  <Button type="button" onClick={saveProfile} disabled={isSaving}>
                    {isSaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-2 h-4 w-4" />
                    )}
                    建立画像并查找资料
                  </Button>
                </div>
              )}
            </div>
          </section>

          <aside className="hidden min-h-0 flex-col bg-muted/15 lg:flex">
            <div className="border-b px-5 py-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">动态画像预览</h3>
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                  自动更新
                </span>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                画像是学习路径、资料推荐和难度调整的首要上下文。
              </p>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {PROFILE_LABELS.map(({ key, label }, index) => {
                const value = answers[key]
                return (
                  <div
                    key={key}
                    className={cn(
                      'rounded-xl border bg-background p-3 transition-colors',
                      value && 'border-primary/25'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-muted-foreground">{label}</p>
                      <span className="text-[10px] text-muted-foreground">
                        {value ? '已提取' : `${index + 1}/8`}
                      </span>
                    </div>
                    <p className={cn('mt-1.5 text-sm leading-5', !value && 'text-muted-foreground')}>
                      {compactProfileValue(value)}
                    </p>
                  </div>
                )
              })}
            </div>
            <div className="border-t p-4 text-xs leading-5 text-muted-foreground">
              完成后仍可随时查看并手动修改；新的对话、Quiz 和资料采纳会留下更新证据。
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  )
}
