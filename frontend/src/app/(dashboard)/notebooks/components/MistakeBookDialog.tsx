'use client'

import { useEffect, useMemo, useState } from 'react'
import { BookMarked, Play, RefreshCw, Star, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  LearningAssetPreview,
  readQuizMistakeBook,
  writeQuizMistakeBook,
  type QuizMistakeBookItem,
  type QuizMistakeContext,
} from '@/components/learning/LearningAssetPreview'
import type { LearningResource } from '@/lib/types/learning'
import { cn } from '@/lib/utils'

type MistakeBookDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  notebookId: string
  notebookName?: string
}

type GroupedNotebook = {
  id: string
  title: string
  items: QuizMistakeBookItem[]
  resources: Array<{
    title: string
    items: QuizMistakeBookItem[]
  }>
}

const UNKNOWN_NOTEBOOK_ID = '__unknown__'

function shuffleItems<T>(items: T[]) {
  return [...items].sort(() => Math.random() - 0.5)
}

function buildPracticeQuestion(item: QuizMistakeBookItem, index: number, similar = false) {
  const options = shuffleItems(item.options)
  const answerText = item.options[item.answerIndex] ?? ''
  const answerIndex = Math.max(0, options.findIndex((option) => option === answerText))
  return {
    id: `${item.id}-${similar ? 'similar' : 'retry'}-${index}`,
    prompt: similar
      ? `相似练习：围绕「${item.prompt}」考察同一知识点。`
      : item.prompt,
    options,
    answer_index: answerIndex,
    explanation: similar
      ? `这道题由错题本根据原错题自动生成，用于复练同一知识点。原解析：${item.explanation}`
      : item.explanation,
    source_title: item.sourceTitle,
    source_ref: item.location,
    evidence: item.evidence,
  }
}

function buildPracticeResource(items: QuizMistakeBookItem[], totalCount: number): LearningResource {
  const oldItems = shuffleItems(items)
  const oldCount = Math.min(oldItems.length, totalCount)
  const selectedOld = oldItems.slice(0, oldCount)
  const extraCount = Math.max(0, totalCount - selectedOld.length)
  const seedPool = selectedOld.length > 0 ? selectedOld : oldItems
  const generated = Array.from({ length: extraCount }, (_, index) => {
    const base = seedPool[index % Math.max(seedPool.length, 1)]
    return buildPracticeQuestion(base, index, true)
  })
  const questions = shuffleItems([
    ...selectedOld.map((item, index) => buildPracticeQuestion(item, index)),
    ...generated,
  ])

  return {
    kind: 'quiz',
    type: '错题复练',
    title: '错题本重新练习',
    agent: '错题本',
    format: 'interactive_quiz',
    summary: `包含 ${selectedOld.length} 道原错题和 ${generated.length} 道相似练习。`,
    content: '基于错题本生成的重新练习。',
    tags: ['错题本', '重新练习'],
    payload: { questions },
  }
}

function groupMistakes(items: QuizMistakeBookItem[]): GroupedNotebook[] {
  const notebookMap = new Map<string, QuizMistakeBookItem[]>()
  items.forEach((item) => {
    const id = item.notebookId || UNKNOWN_NOTEBOOK_ID
    notebookMap.set(id, [...(notebookMap.get(id) ?? []), item])
  })

  return Array.from(notebookMap.entries()).map(([id, notebookItems]) => {
    const title = notebookItems[0]?.notebookTitle || (id === UNKNOWN_NOTEBOOK_ID ? '未归类错题' : '未命名笔记本')
    const resourceMap = new Map<string, QuizMistakeBookItem[]>()
    notebookItems.forEach((item) => {
      resourceMap.set(item.resourceTitle, [...(resourceMap.get(item.resourceTitle) ?? []), item])
    })
    return {
      id,
      title,
      items: notebookItems,
      resources: Array.from(resourceMap.entries()).map(([resourceTitle, resourceItems]) => ({
        title: resourceTitle,
        items: resourceItems,
      })),
    }
  })
}

export function MistakeBookDialog({
  open,
  onOpenChange,
  notebookId,
  notebookName,
}: MistakeBookDialogProps) {
  const [items, setItems] = useState<QuizMistakeBookItem[]>([])
  const [selectedNotebookId, setSelectedNotebookId] = useState<string>('all')
  const [selectedResourceTitle, setSelectedResourceTitle] = useState<string>('all')
  const [practiceCount, setPracticeCount] = useState(6)
  const [practiceResource, setPracticeResource] = useState<LearningResource | null>(null)

  useEffect(() => {
    if (open) {
      const current = readQuizMistakeBook()
      setItems(current)
      setSelectedNotebookId(current.some((item) => item.notebookId === notebookId) ? notebookId : 'all')
      setSelectedResourceTitle('all')
      setPracticeResource(null)
    }
  }, [notebookId, open])

  const grouped = useMemo(() => groupMistakes(items), [items])
  const selectedNotebook = grouped.find((group) => group.id === selectedNotebookId)
  const visibleItems = useMemo(() => {
    let current = selectedNotebookId === 'all'
      ? items
      : items.filter((item) => (item.notebookId || UNKNOWN_NOTEBOOK_ID) === selectedNotebookId)
    if (selectedResourceTitle !== 'all') {
      current = current.filter((item) => item.resourceTitle === selectedResourceTitle)
    }
    return current
  }, [items, selectedNotebookId, selectedResourceTitle])
  const starredCount = visibleItems.filter((item) => item.starred).length

  const syncItems = (next: QuizMistakeBookItem[]) => {
    setItems(next)
    writeQuizMistakeBook(next)
  }

  const removeMistake = (id: string) => {
    syncItems(items.filter((item) => item.id !== id))
  }

  const toggleStar = (id: string) => {
    syncItems(items.map((item) => item.id === id ? { ...item, starred: !item.starred } : item))
  }

  const startPractice = () => {
    if (visibleItems.length === 0) return
    setPracticeResource(buildPracticeResource(visibleItems, Math.max(1, practiceCount)))
  }

  const mistakeContext: QuizMistakeContext = {
    notebookId,
    notebookTitle: notebookName || '当前学习记录',
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col overflow-hidden sm:max-w-5xl">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <BookMarked className="h-5 w-5" />
            错题本
          </DialogTitle>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="space-y-3 overflow-y-auto rounded-lg border bg-muted/20 p-3">
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-md border bg-background p-2">
                <p className="text-lg font-semibold">{items.length}</p>
                <p className="text-muted-foreground">全部</p>
              </div>
              <div className="rounded-md border bg-background p-2">
                <p className="text-lg font-semibold">{visibleItems.length}</p>
                <p className="text-muted-foreground">当前</p>
              </div>
              <div className="rounded-md border bg-background p-2">
                <p className="text-lg font-semibold">{starredCount}</p>
                <p className="text-muted-foreground">收藏</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label>笔记本</Label>
              <Select
                value={selectedNotebookId}
                onValueChange={(value) => {
                  setSelectedNotebookId(value)
                  setSelectedResourceTitle('all')
                  setPracticeResource(null)
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部错题本</SelectItem>
                  {grouped.map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.title}（{group.items.length}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>测验/资产</Label>
              <Select
                value={selectedResourceTitle}
                onValueChange={(value) => {
                  setSelectedResourceTitle(value)
                  setPracticeResource(null)
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部测验</SelectItem>
                  {(selectedNotebook?.resources ?? groupMistakes(items).flatMap((group) => group.resources)).map((resource) => (
                    <SelectItem key={`${resource.title}-${resource.items.length}`} value={resource.title}>
                      {resource.title}（{resource.items.length}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mistake-practice-count">重新练习总题数</Label>
              <Input
                id="mistake-practice-count"
                type="number"
                min={1}
                max={30}
                value={practiceCount}
                onChange={(event) => setPracticeCount(Number(event.target.value) || 1)}
              />
              <Button type="button" className="w-full gap-2" onClick={startPractice} disabled={visibleItems.length === 0}>
                <Play className="h-4 w-4" />
                重新练习
              </Button>
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto rounded-lg border p-4">
            {practiceResource ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">错题复练</p>
                    <p className="text-xs text-muted-foreground">{practiceResource.summary}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={startPractice}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    重新打乱
                  </Button>
                </div>
                <LearningAssetPreview resource={practiceResource} mistakeContext={mistakeContext} />
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="flex min-h-80 items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                暂无错题。完成测验后，答错的题会自动进入这里。
              </div>
            ) : (
              <div className="space-y-3">
                {visibleItems.map((item, index) => (
                  <article key={item.id} className="rounded-lg border bg-background p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">
                          {item.notebookTitle || '未归类'} / {item.resourceTitle}
                        </p>
                        <h3 className="mt-1 text-sm font-semibold leading-6">
                          {index + 1}. {item.prompt}
                        </h3>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant={item.starred ? 'secondary' : 'ghost'}
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => toggleStar(item.id)}
                          aria-label={item.starred ? '取消收藏' : '收藏'}
                        >
                          <Star className={cn('h-4 w-4', item.starred && 'fill-current')} />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => removeMistake(item.id)}
                          aria-label="移出错题本"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-3 space-y-1 text-sm leading-6 text-muted-foreground">
                      {item.selectedIndex !== undefined && <p>你的答案：{item.options[item.selectedIndex] ?? '未记录'}</p>}
                      <p>正确答案：{item.options[item.answerIndex] ?? '未记录'}</p>
                      <p>{item.explanation}</p>
                      {(item.sourceTitle || item.evidence) && (
                        <p>来源：{item.sourceTitle || '当前学习资产'}{item.location ? ` · ${item.location}` : ''}{item.evidence ? ` · ${item.evidence}` : ''}</p>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
