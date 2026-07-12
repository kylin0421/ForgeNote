'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, BarChart3, BookOpen, CheckCircle2, Lightbulb, Sparkles, TrendingUp, type LucideIcon } from 'lucide-react'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { learningApi } from '@/lib/api/learning'
import type { NoteResponse, SourceListResponse } from '@/lib/types/api'
import { cn } from '@/lib/utils'

type LearningCurveDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  notebookId: string
  sources?: SourceListResponse[]
  notes?: NoteResponse[]
}

type TimelinePoint = {
  key: string
  label: string
  activities: number
  quality: number
  quizTotal: number
  quizCorrect: number
  sources: number
  notes: number
  chats: number
  generated: number
}

const DAY_MS = 24 * 60 * 60 * 1000

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function dayKey(date: Date) {
  const day = startOfLocalDay(date)
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}

function shortDayLabel(key: string) {
  const [, month, day] = key.split('-')
  return `${month}/${day}`
}

function parseProfileEvents(content?: string | null) {
  return (content || '')
    .split('\n')
    .map((line) => line.trim().replace(/^[-*]\s*/, ''))
    .map((line) => {
      const match = line.match(/^(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}:\d{2}Z\s+\[([^\]]+)\]\s*(.*)$/)
      if (!match) return null
      return {
        key: match[1],
        type: match[2],
        summary: match[3],
      }
    })
    .filter(Boolean) as Array<{ key: string; type: string; summary: string }>
}

function buildTimeline(
  profileContent: string | undefined,
  sources: SourceListResponse[] = [],
  notes: NoteResponse[] = []
) {
  const today = startOfLocalDay(new Date())
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(today.getTime() - (13 - index) * DAY_MS)
    const key = dayKey(date)
    return [
      key,
      {
        key,
        label: shortDayLabel(key),
        activities: 0,
        quality: 0,
        quizTotal: 0,
        quizCorrect: 0,
        sources: 0,
        notes: 0,
        chats: 0,
        generated: 0,
      } satisfies TimelinePoint,
    ] as const
  })
  const byDay = new Map<string, TimelinePoint>(days)

  const ensureDay = (key: string) => byDay.get(key)

  for (const source of sources) {
    const point = ensureDay(dayKey(new Date(source.created || source.updated)))
    if (!point) continue
    point.sources += 1
    point.activities += 1
  }

  for (const note of notes) {
    const point = ensureDay(dayKey(new Date(note.created || note.updated)))
    if (!point) continue
    point.notes += 1
    point.activities += 1
  }

  for (const event of parseProfileEvents(profileContent)) {
    const point = ensureDay(event.key)
    if (!point) continue
    point.activities += 1
    if (event.type === 'quiz_answer') {
      point.quizTotal += 1
      if (/\bcorrect\b/i.test(event.summary) && !/\bincorrect\b/i.test(event.summary)) {
        point.quizCorrect += 1
      }
    } else if (event.type.includes('chat')) {
      point.chats += 1
    } else if (event.type === 'generate_request') {
      point.generated += 1
    } else if (event.type === 'collect_request' || event.type === 'source_accept') {
      point.sources += 1
    }
  }

  for (const point of byDay.values()) {
    const quizQuality = point.quizTotal > 0 ? (point.quizCorrect / point.quizTotal) * 58 : 0
    const activityQuality = Math.min(point.activities * 7, 28)
    const diversityQuality = Math.min(
      [point.sources > 0, point.notes > 0, point.chats > 0, point.generated > 0].filter(Boolean).length * 4,
      14
    )
    point.quality = Math.min(100, Math.round(quizQuality + activityQuality + diversityQuality))
  }

  return Array.from(byDay.values())
}

function buildAdvice(points: TimelinePoint[]) {
  const recent = points.slice(-7)
  const previous = points.slice(0, 7)
  const recentActivities = recent.reduce((sum, point) => sum + point.activities, 0)
  const previousActivities = previous.reduce((sum, point) => sum + point.activities, 0)
  const quizTotal = recent.reduce((sum, point) => sum + point.quizTotal, 0)
  const quizCorrect = recent.reduce((sum, point) => sum + point.quizCorrect, 0)
  const recentQuality = Math.round(recent.reduce((sum, point) => sum + point.quality, 0) / Math.max(recent.length, 1))
  const accuracy = quizTotal > 0 ? Math.round((quizCorrect / quizTotal) * 100) : null

  if (recentActivities === 0) {
    return {
      tone: '需要启动',
      summary: '最近 7 天还没有明显学习记录。',
      items: ['先选择 1-2 份核心资料阅读', '生成一次测验建立当前水平基线', '用问答区追问最不清楚的概念'],
    }
  }

  if (accuracy !== null && accuracy < 70) {
    return {
      tone: '优先补弱',
      summary: `最近测验正确率 ${accuracy}%，建议先降低推进速度。`,
      items: ['复盘错题对应来源位置', '生成相似题练习直到正确率超过 80%', '用闪卡巩固易混概念边界'],
    }
  }

  if (recentActivities < previousActivities) {
    return {
      tone: '节奏下降',
      summary: '最近学习量低于前一周，建议恢复稳定节奏。',
      items: ['每天安排 15-25 分钟小练习', '优先完成一组测验或闪卡', '把未读资料加入下一步计划'],
    }
  }

  if (recentQuality >= 70) {
    return {
      tone: '状态较好',
      summary: '近期学习质量较稳定，可以进入综合应用。',
      items: ['生成代码实验或综合题', '补充高质量拓展阅读', '用导图整理跨章节关系'],
    }
  }

  return {
    tone: '继续巩固',
    summary: '已有学习行为，但质量信号还需要更多测验和复盘支撑。',
    items: ['补做一组诊断测验', '把问答中的疑问整理成笔记', '优先复习最近生成的学习资产'],
  }
}

function CurveChart({ points }: { points: TimelinePoint[] }) {
  const maxActivities = Math.max(...points.map((point) => point.activities), 1)
  const averageQuality = Math.round(points.reduce((sum, point) => sum + point.quality, 0) / Math.max(points.length, 1))
  const averageY = 122 - (averageQuality / 100) * 92
  const coordinates = points.map((point, index) => {
    const x = 22 + index * (336 / Math.max(points.length - 1, 1))
    const y = 122 - (point.quality / 100) * 92
    return { x, y }
  })
  const path = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
  const areaPath = `${path} L ${coordinates[coordinates.length - 1]?.x ?? 22} 122 L ${coordinates[0]?.x ?? 22} 122 Z`

  return (
    <div className="overflow-x-auto rounded-lg border bg-slate-50 p-3 dark:bg-slate-950/40">
      <svg viewBox="0 0 390 172" className="h-64 min-w-[560px] w-full" role="img" aria-label="学习曲线">
        <defs>
          <linearGradient id="learning-quality-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.26" />
            <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.03" />
          </linearGradient>
        </defs>
        {[30, 53, 76, 99, 122].map((y) => (
          <line key={y} x1="20" y1={y} x2="372" y2={y} className="stroke-slate-300/70 dark:stroke-slate-700/70" strokeDasharray={y === 122 ? undefined : '4 5'} />
        ))}
        <line x1="20" y1="30" x2="20" y2="122" className="stroke-slate-300 dark:stroke-slate-700" />
        <text x="24" y="24" className="fill-slate-500 text-[9px]">质量评分</text>
        <text x="330" y={averageY - 5} className="fill-amber-600 text-[9px]">均线 {averageQuality}</text>
        <line x1="20" y1={averageY} x2="372" y2={averageY} stroke="#d97706" strokeWidth="1.2" strokeDasharray="5 5" />
        {points.map((point, index) => {
          const x = 16 + index * (344 / Math.max(points.length - 1, 1))
          const barHeight = Math.max(3, (point.activities / maxActivities) * 54)
          const active = point.activities > 0
          return (
            <g key={point.key}>
              <rect
                x={x}
                y={122 - barHeight}
                width="11"
                height={barHeight}
                rx="3"
                fill={active ? '#38bdf8' : '#e2e8f0'}
                opacity={active ? 0.58 : 0.55}
              />
              {index % 2 === 0 ? (
                <text x={x + 5.5} y="151" textAnchor="middle" className="fill-slate-500 text-[8px]">
                  {point.label}
                </text>
              ) : null}
            </g>
          )
        })}
        <path d={areaPath} fill="url(#learning-quality-area)" />
        <path d={path} fill="none" stroke="#2563eb" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
        {coordinates.map((point, index) => (
          <circle key={points[index].key} cx={point.x} cy={point.y} r={points[index].activities > 0 ? 4.6 : 3.2} fill="#ffffff" stroke={points[index].activities > 0 ? '#2563eb' : '#94a3b8'} strokeWidth="2">
            <title>{`${points[index].label}: 质量 ${points[index].quality}，学习 ${points[index].activities} 项`}</title>
          </circle>
        ))}
      </svg>
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent,
}: {
  label: string
  value: string
  hint: string
  icon: LucideIcon
  accent: string
}) {
  return (
    <div className="rounded-lg border bg-background p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-semibold">{value}</p>
        </div>
        <span className={cn('flex h-10 w-10 items-center justify-center rounded-md', accent)}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">{hint}</p>
    </div>
  )
}

export function LearningCurveDialog({
  open,
  onOpenChange,
  notebookId,
  sources,
  notes,
}: LearningCurveDialogProps) {
  const { data: profile } = useQuery({
    queryKey: ['learning', 'profile-source', notebookId],
    queryFn: () => learningApi.ensureProfileSource(notebookId),
    enabled: open && Boolean(notebookId),
    staleTime: 0,
  })
  const points = useMemo(
    () => buildTimeline(profile?.content, sources, notes),
    [notes, profile?.content, sources]
  )
  const advice = useMemo(() => buildAdvice(points), [points])
  const totals = useMemo(() => {
    const recent = points.slice(-7)
    const activities = recent.reduce((sum, point) => sum + point.activities, 0)
    const quality = Math.round(recent.reduce((sum, point) => sum + point.quality, 0) / Math.max(recent.length, 1))
    const quizTotal = recent.reduce((sum, point) => sum + point.quizTotal, 0)
    const quizCorrect = recent.reduce((sum, point) => sum + point.quizCorrect, 0)
    return {
      activities,
      quality,
      accuracy: quizTotal > 0 ? Math.round((quizCorrect / quizTotal) * 100) : null,
      activeDays: recent.filter((point) => point.activities > 0).length,
    }
  }, [points])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            学习曲线与状态建议
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="近 7 天学习量" value={String(totals.activities)} hint="资料、笔记、问答、生成和练习的综合活动数。" icon={Activity} accent="bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300" />
          <StatCard label="活跃天数" value={`${totals.activeDays}/7`} hint="越连续，曲线越能反映真实学习节奏。" icon={BookOpen} accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" />
          <StatCard label="学习质量" value={String(totals.quality)} hint="由测验表现、学习量和行为多样性估算。" icon={Sparkles} accent="bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" />
          <StatCard label="测验正确率" value={totals.accuracy === null ? '待评估' : `${totals.accuracy}%`} hint="做过测验后会成为复习优先级的重要信号。" icon={CheckCircle2} accent="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" />
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4" />
              最近 14 天趋势
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CurveChart points={points} />
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded bg-sky-300" />学习量</span>
              <span className="inline-flex items-center gap-1"><span className="h-0.5 w-4 rounded bg-blue-600" />质量评分</span>
              <span className="inline-flex items-center gap-1"><span className="h-0.5 w-4 rounded bg-amber-600" />质量均线</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between gap-3 text-base">
              <span className="flex items-center gap-2">
                <Lightbulb className="h-4 w-4" />
                根据最近状态的建议
              </span>
              <Badge variant="secondary">{advice.tone}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{advice.summary}</p>
            <div className="mt-3 grid gap-2 md:grid-cols-3">
              {advice.items.map((item) => (
                <div key={item} className="rounded-lg border bg-muted/20 p-3 text-sm leading-6">
                  {item}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4" />
              每日明细
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 md:grid-cols-2">
              {points.filter((point) => point.activities > 0).slice(-8).reverse().map((point) => (
                <div key={point.key} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{point.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      资料 {point.sources} · 笔记 {point.notes} · 问答 {point.chats} · 生成 {point.generated} · 练习 {point.quizTotal}
                    </p>
                  </div>
                  <Badge variant="outline">质量 {point.quality}</Badge>
                  </div>
                  <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
                    <span className="bg-sky-400" style={{ width: `${Math.min(100, point.sources * 18)}%` }} />
                    <span className="bg-emerald-400" style={{ width: `${Math.min(100, point.notes * 18)}%` }} />
                    <span className="bg-violet-400" style={{ width: `${Math.min(100, point.chats * 18)}%` }} />
                    <span className="bg-amber-400" style={{ width: `${Math.min(100, (point.generated + point.quizTotal) * 18)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  )
}
