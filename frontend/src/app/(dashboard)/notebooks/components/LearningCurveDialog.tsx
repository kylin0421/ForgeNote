'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Activity, BarChart3, Lightbulb, TrendingUp } from 'lucide-react'

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
  const coordinates = points.map((point, index) => {
    const x = 22 + index * (336 / Math.max(points.length - 1, 1))
    const y = 122 - (point.quality / 100) * 92
    return { x, y }
  })
  const path = coordinates.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')

  return (
    <div className="overflow-x-auto rounded-lg border bg-background p-3">
      <svg viewBox="0 0 390 160" className="h-56 min-w-[520px] w-full" role="img" aria-label="学习曲线">
        <line x1="20" y1="122" x2="372" y2="122" className="stroke-muted-foreground/25" />
        <line x1="20" y1="30" x2="20" y2="122" className="stroke-muted-foreground/25" />
        {points.map((point, index) => {
          const x = 16 + index * (344 / Math.max(points.length - 1, 1))
          const barHeight = Math.max(3, (point.activities / maxActivities) * 54)
          return (
            <g key={point.key}>
              <rect
                x={x}
                y={122 - barHeight}
                width="10"
                height={barHeight}
                rx="3"
                className={cn(point.activities > 0 ? 'fill-primary/25' : 'fill-muted')}
              />
              {index % 2 === 0 ? (
                <text x={x + 5} y="145" textAnchor="middle" className="fill-muted-foreground text-[8px]">
                  {point.label}
                </text>
              ) : null}
            </g>
          )
        })}
        <path d={path} fill="none" className="stroke-primary" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        {coordinates.map((point, index) => (
          <circle key={points[index].key} cx={point.x} cy={point.y} r="4" className="fill-background stroke-primary" strokeWidth="2">
            <title>{`${points[index].label}: 质量 ${points[index].quality}，学习 ${points[index].activities} 项`}</title>
          </circle>
        ))}
      </svg>
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

        <div className="grid gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">近 7 天学习量</p>
              <p className="mt-2 text-2xl font-semibold">{totals.activities}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">活跃天数</p>
              <p className="mt-2 text-2xl font-semibold">{totals.activeDays}/7</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">学习质量</p>
              <p className="mt-2 text-2xl font-semibold">{totals.quality}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">测验正确率</p>
              <p className="mt-2 text-2xl font-semibold">{totals.accuracy === null ? '待评估' : `${totals.accuracy}%`}</p>
            </CardContent>
          </Card>
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
              <span className="inline-flex items-center gap-1"><span className="h-2 w-4 rounded bg-primary/25" />学习量</span>
              <span className="inline-flex items-center gap-1"><span className="h-0.5 w-4 rounded bg-primary" />质量评分</span>
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
                <div key={point.key} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                  <div>
                    <p className="font-medium">{point.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      资料 {point.sources} · 笔记 {point.notes} · 问答 {point.chats} · 生成 {point.generated} · 练习 {point.quizTotal}
                    </p>
                  </div>
                  <Badge variant="outline">质量 {point.quality}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </DialogContent>
    </Dialog>
  )
}
