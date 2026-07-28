'use client'

import { useState, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { InlineEdit } from '@/components/common/InlineEdit'
import { SourcesColumn } from '../components/SourcesColumn'
import { NotesColumn } from '../components/NotesColumn'
import { ChatColumn } from '../components/ChatColumn'
import { LearningCurveDialog } from '../components/LearningCurveDialog'
import { MistakeBookDialog } from '../components/MistakeBookDialog'
import { useNotebook, useUpdateNotebook } from '@/lib/hooks/use-notebooks'
import { useNotebookSources } from '@/lib/hooks/use-sources'
import { useNotes } from '@/lib/hooks/use-notes'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { useIsDesktop } from '@/lib/hooks/use-media-query'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  BookMarked,
  Brain,
  FileText,
  MessageSquare,
  Sparkles,
  StickyNote,
  TrendingUp,
} from 'lucide-react'
import {
  applyBulkSourceContext,
  applyBulkNoteContext,
  computeSourceSelections,
  computeNoteSelections,
  type SourceContextDefault,
  type SourceBulkAction,
  type NoteContextDefault,
} from '@/lib/utils/source-context'

// Re-exported from the shared types module for backward compatibility; several
// components historically import these from this route file.
import type { ContextMode, ContextSelections, NoteContextMode } from '@/lib/types/notebook-context'
export type { ContextMode, ContextSelections, NoteContextMode }

type NotebookColumnWidths = {
  sources: number
  chat: number
  notes: number
}

const DEFAULT_NOTEBOOK_COLUMN_WIDTHS: NotebookColumnWidths = {
  sources: 54,
  chat: 24,
  notes: 22,
}

const clampColumnWidth = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export default function NotebookPage() {
  const { t } = useTranslation()
  const params = useParams()
  const searchParams = useSearchParams()

  // Ensure the notebook ID is properly decoded from URL
  const notebookId = params?.id ? decodeURIComponent(params.id as string) : ''
  const initialSourceSearch = searchParams.get('sourceSearch') ?? ''

  const { data: notebook, isLoading: notebookLoading } = useNotebook(notebookId)
  const updateNotebook = useUpdateNotebook()
  const {
    sources,
    isLoading: sourcesLoading,
    refetch: refetchSources,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useNotebookSources(notebookId)
  const { data: notes, isLoading: notesLoading } = useNotes(notebookId)

  // Get collapse states for dynamic layout
  const { sourcesCollapsed, notesCollapsed } = useNotebookColumnsStore()
  const desktopLayoutRef = useRef<HTMLDivElement | null>(null)
  const columnDragRef = useRef<{
    handle: 'chat-sources' | 'sources-notes'
    startX: number
    containerWidth: number
    startWidths: NotebookColumnWidths
  } | null>(null)
  const [columnWidths, setColumnWidths] = useState<NotebookColumnWidths>(DEFAULT_NOTEBOOK_COLUMN_WIDTHS)

  // Detect desktop to avoid double-mounting ChatColumn
  const isDesktop = useIsDesktop()

  // Mobile tab state (Sources, Notes, or Chat)
  const [mobileActiveTab, setMobileActiveTab] = useState<'sources' | 'notes' | 'chat'>('sources')

  useEffect(() => {
    if (initialSourceSearch) {
      setMobileActiveTab('sources')
    }
  }, [initialSourceSearch])

  // Context selection state
  const [contextSelections, setContextSelections] = useState<ContextSelections>({
    sources: {},
    notes: {}
  })

  // The default context mode applied to sources as they load. A bulk
  // include/exclude updates this so sources loaded later via pagination follow
  // the same intent instead of reverting to "included" (#223/#915).
  const [sourceContextDefault, setSourceContextDefault] = useState<SourceContextDefault>('include')

  // Same idea for notes loaded later (notes are binary: included/off).
  const [noteContextDefault, setNoteContextDefault] = useState<NoteContextDefault>('include')

  const [learningProfileOptions, setLearningProfileOptions] = useState({
    autoUpdateProfile: true,
    useProfileSource: true,
  })
  const [learningCurveOpen, setLearningCurveOpen] = useState(false)
  const [mistakeBookOpen, setMistakeBookOpen] = useState(false)
  const [profileOpenSignal, setProfileOpenSignal] = useState(0)

  const openLearningProfile = () => {
    setMobileActiveTab('sources')
    setProfileOpenSignal(Date.now())
  }

  useEffect(() => {
    if (!notebookId) return
    try {
      const stored = window.localStorage.getItem(`learning-profile-options:${notebookId}`)
      if (stored) {
        const parsed = JSON.parse(stored)
        setLearningProfileOptions({
          autoUpdateProfile: parsed.autoUpdateProfile !== false,
          useProfileSource: parsed.useProfileSource !== false,
        })
      }
    } catch {
      // Ignore malformed local state.
    }
  }, [notebookId])

  useEffect(() => {
    if (!notebookId) return
    window.localStorage.setItem(
      `learning-profile-options:${notebookId}`,
      JSON.stringify(learningProfileOptions)
    )
  }, [notebookId, learningProfileOptions])

  useEffect(() => {
    if (!notebookId) return
    try {
      const stored = window.localStorage.getItem(`notebook-column-widths:v2:${notebookId}`)
      if (!stored) return
      const parsed = JSON.parse(stored) as Partial<NotebookColumnWidths>
      if (
        typeof parsed.sources === 'number' &&
        typeof parsed.chat === 'number' &&
        typeof parsed.notes === 'number'
      ) {
        setColumnWidths({
          sources: clampColumnWidth(parsed.sources, 40, 70),
          chat: clampColumnWidth(parsed.chat, 18, 34),
          notes: clampColumnWidth(parsed.notes, 18, 32),
        })
      }
    } catch {
      // Ignore malformed local layout state.
    }
  }, [notebookId])

  useEffect(() => {
    if (!notebookId) return
    window.localStorage.setItem(
      `notebook-column-widths:v2:${notebookId}`,
      JSON.stringify(columnWidths)
    )
  }, [columnWidths, notebookId])

  const startColumnResize = (
    handle: 'chat-sources' | 'sources-notes',
    event: ReactPointerEvent<HTMLDivElement>
  ) => {
    const rect = desktopLayoutRef.current?.getBoundingClientRect()
    if (!rect) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    columnDragRef.current = {
      handle,
      startX: event.clientX,
      containerWidth: rect.width,
      startWidths: columnWidths,
    }
  }

  const updateColumnResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = columnDragRef.current
    if (!drag) return
    const delta = ((event.clientX - drag.startX) / Math.max(drag.containerWidth, 1)) * 100
    const { startWidths } = drag

    if (drag.handle === 'chat-sources') {
      const total = startWidths.chat + startWidths.sources
      const chat = clampColumnWidth(startWidths.chat + delta, 18, Math.min(34, total - 40))
      setColumnWidths({
        sources: total - chat,
        chat,
        notes: startWidths.notes,
      })
      return
    }

    const total = startWidths.sources + startWidths.notes
    const sources = clampColumnWidth(startWidths.sources + delta, 40, total - 18)
    setColumnWidths({
      sources,
      chat: startWidths.chat,
      notes: total - sources,
    })
  }

  const stopColumnResize = () => {
    columnDragRef.current = null
  }

  // Initialize and update selections when sources load or change
  useEffect(() => {
    if (sources && sources.length > 0) {
      setContextSelections(prev => ({
        ...prev,
        sources: computeSourceSelections(prev.sources, sources, sourceContextDefault),
      }))
    }
  }, [sources, sourceContextDefault])

  useEffect(() => {
    if (notes && notes.length > 0) {
      setContextSelections(prev => ({
        ...prev,
        notes: computeNoteSelections(prev.notes, notes, noteContextDefault),
      }))
    }
  }, [notes, noteContextDefault])

  const handleSourceContextModeChange = (sourceId: string, mode: ContextMode) => {
    setContextSelections(prev => ({
      ...prev,
      sources: {
        ...prev.sources,
        [sourceId]: mode
      }
    }))
  }

  const handleNoteContextModeChange = (noteId: string, mode: NoteContextMode) => {
    setContextSelections(prev => ({
      ...prev,
      notes: {
        ...prev.notes,
        [noteId]: mode
      }
    }))
  }

  // Bulk-apply a context action (insights-only / full / exclude) to every
  // source at once (#223). Also records the action as the default for sources
  // loaded later (#915).
  const handleBulkSourceContext = (action: SourceBulkAction) => {
    setSourceContextDefault(action)
    setContextSelections(prev => ({
      ...prev,
      sources: applyBulkSourceContext(prev.sources, sources ?? [], action),
    }))
  }

  // Bulk include/exclude every note from the chat context at once (#223).
  const handleBulkNoteContext = (action: NoteContextDefault) => {
    setNoteContextDefault(action)
    setContextSelections(prev => ({
      ...prev,
      notes: applyBulkNoteContext(prev.notes, notes ?? [], action),
    }))
  }

  const handleUpdateNotebookName = async (name: string) => {
    if (!name || name === notebook?.name) return

    await updateNotebook.mutateAsync({
      id: notebookId,
      data: { name },
    })
  }

  const notebookActionButtons = (buttonClassName: string) => (
    <>
      <Button
        type="button"
        size="sm"
        variant="default"
        className={cn('gap-1.5 rounded-full text-xs', buttonClassName)}
        onClick={openLearningProfile}
      >
        <Brain className="h-4 w-4" />
        我的画像
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={cn('gap-1.5 rounded-full text-xs', buttonClassName)}
        onClick={() => setLearningCurveOpen(true)}
      >
        <TrendingUp className="h-4 w-4" />
        学习曲线
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={cn('gap-1.5 rounded-full text-xs', buttonClassName)}
        onClick={() => setMistakeBookOpen(true)}
      >
        <BookMarked className="h-4 w-4" />
        错题本
      </Button>
    </>
  )

  if (notebookLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    )
  }

  if (!notebook) {
    return (
      <AppShell>
        <div className="p-6">
          <h1 className="text-2xl font-bold mb-4">{t('notebooks.notFound')}</h1>
          <p className="text-muted-foreground">{t('notebooks.notFoundDesc')}</p>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell
      title={
        <InlineEdit
          id="notebook-top-title"
          name="notebook-top-title"
          value={notebook.name}
          onSave={handleUpdateNotebookName}
          className="max-w-full truncate text-xl font-semibold tracking-tight"
          inputClassName="h-9 max-w-md text-xl font-semibold tracking-tight"
          placeholder={t('notebooks.namePlaceholder')}
        />
      }
      titleActions={notebookActionButtons('h-8 px-3')}
    >
      <LearningCurveDialog
        open={learningCurveOpen}
        onOpenChange={setLearningCurveOpen}
        notebookId={notebookId}
        sources={sources}
        notes={notes}
      />
      <MistakeBookDialog
        open={mistakeBookOpen}
        onOpenChange={setMistakeBookOpen}
        notebookId={notebookId}
        notebookName={notebook?.name}
      />
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0 overflow-x-auto overflow-y-auto p-3 lg:p-4 flex flex-col">
          <div className="mb-3 flex items-center gap-2 md:hidden">
            {notebookActionButtons('h-9 flex-1 px-3')}
          </div>

          <button
            type="button"
            onClick={openLearningProfile}
            className="mb-3 flex w-full shrink-0 flex-col gap-2.5 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-background px-3 py-2.5 text-left transition-colors hover:border-primary/40 sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Brain className="h-5 w-5" />
                <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-background" />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-semibold">
                  8 维动态学生画像
                  <Sparkles className="h-4 w-4 text-primary" />
                </span>
                <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
                  正在用于个性化对话、资料推荐和难度调整；每次对话、Quiz 与资料选择后自动更新。
                </span>
              </span>
            </span>
            <span className="flex shrink-0 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="rounded-full border bg-background px-2.5 py-1">随学随新</span>
              <span className="rounded-full border bg-background px-2.5 py-1">有证据可追溯</span>
              <span className="rounded-full border bg-background px-2.5 py-1 text-primary">查看 / 编辑</span>
            </span>
          </button>

          {/* Mobile: Tabbed interface - only render on mobile to avoid double-mounting */}
          {!isDesktop && (
            <>
              <div className="lg:hidden mb-3">
                <Tabs value={mobileActiveTab} onValueChange={(value) => setMobileActiveTab(value as 'sources' | 'notes' | 'chat')}>
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="sources" className="gap-2">
                      <FileText className="h-4 w-4" />
                      学习资料
                    </TabsTrigger>
                    <TabsTrigger value="chat" className="gap-2">
                      <MessageSquare className="h-4 w-4" />
                      {t('common.chat')}
                    </TabsTrigger>
                    <TabsTrigger value="notes" className="gap-2">
                      <StickyNote className="h-4 w-4" />
                      Studio
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              {/* Mobile: Show only active tab */}
              <div className="flex-1 overflow-hidden lg:hidden">
                {mobileActiveTab === 'sources' && (
                  <SourcesColumn
                    sources={sources}
                    isLoading={sourcesLoading}
                    notebookId={notebookId}
                    notebookName={notebook?.name}
                    onRefresh={refetchSources}
                    contextSelections={contextSelections.sources}
                    onContextModeChange={handleSourceContextModeChange}
                    onBulkContextModeChange={handleBulkSourceContext}
                    hasNextPage={hasNextPage}
                    isFetchingNextPage={isFetchingNextPage}
                    fetchNextPage={fetchNextPage}
                    initialResourceSearchGoal={initialSourceSearch}
                    autoCollectInitialResourceSearch
                    profileOpenSignal={profileOpenSignal}
                  />
                )}
                {mobileActiveTab === 'notes' && (
                  <NotesColumn
                    notes={notes}
                    isLoading={notesLoading}
                    notebookId={notebookId}
                    notebookName={notebook?.name}
                    sources={sources}
                    profileOptions={learningProfileOptions}
                    onProfileOptionsChange={setLearningProfileOptions}
                    contextSelections={contextSelections.notes}
                    onContextModeChange={handleNoteContextModeChange}
                    onBulkContextModeChange={handleBulkNoteContext}
                  />
                )}
                {mobileActiveTab === 'chat' && (
                  <ChatColumn
                    notebookId={notebookId}
                    notebookName={notebook?.name}
                    contextSelections={contextSelections}
                    sources={sources}
                    sourcesLoading={sourcesLoading}
                    autoUpdateProfile={learningProfileOptions.autoUpdateProfile}
                    useProfileSource={learningProfileOptions.useProfileSource}
                  />
                )}
              </div>
            </>
          )}

          {/* Desktop: Collapsible columns layout */}
          <div
            ref={desktopLayoutRef}
            className={cn(
            'hidden lg:flex h-full min-h-0 gap-3 transition-all duration-150',
            'flex-row'
            )}
            onPointerMove={updateColumnResize}
            onPointerUp={stopColumnResize}
            onPointerCancel={stopColumnResize}
          >
            {/* Chat Column - compact and always visible on the left */}
            <div
              className="min-w-[17rem] flex-none transition-all duration-150"
              style={{
                flexBasis: 0,
                flexGrow: columnWidths.chat,
              }}
            >
              <ChatColumn
                notebookId={notebookId}
                notebookName={notebook?.name}
                contextSelections={contextSelections}
                sources={sources}
                sourcesLoading={sourcesLoading}
                autoUpdateProfile={learningProfileOptions.autoUpdateProfile}
                useProfileSource={learningProfileOptions.useProfileSource}
              />
            </div>

            {!sourcesCollapsed && (
              <div
                role="separator"
                aria-orientation="vertical"
                className="-mx-2 flex w-2 shrink-0 cursor-col-resize items-stretch justify-center"
                onPointerDown={(event) => startColumnResize('chat-sources', event)}
              >
                <span className="my-2 w-px rounded-full bg-border transition-colors hover:bg-primary" />
              </div>
            )}

            {/* Sources Column - the primary learning workspace */}
            <div className={cn(
              'transition-all duration-150',
              sourcesCollapsed ? 'w-12 flex-shrink-0' : 'min-w-[32rem] flex-none'
            )}
              style={sourcesCollapsed ? undefined : { flexBasis: 0, flexGrow: columnWidths.sources }}
            >
              <SourcesColumn
                sources={sources}
                isLoading={sourcesLoading}
                notebookId={notebookId}
                notebookName={notebook?.name}
                onRefresh={refetchSources}
                contextSelections={contextSelections.sources}
                onContextModeChange={handleSourceContextModeChange}
                onBulkContextModeChange={handleBulkSourceContext}
                hasNextPage={hasNextPage}
                isFetchingNextPage={isFetchingNextPage}
                fetchNextPage={fetchNextPage}
                initialResourceSearchGoal={initialSourceSearch}
                autoCollectInitialResourceSearch
                profileOpenSignal={profileOpenSignal}
              />
            </div>

            {!notesCollapsed && (
              <div
                role="separator"
                aria-orientation="vertical"
                className="-mx-2 flex w-2 shrink-0 cursor-col-resize items-stretch justify-center"
                onPointerDown={(event) => startColumnResize('sources-notes', event)}
              >
                <span className="my-2 w-px rounded-full bg-border transition-colors hover:bg-primary" />
              </div>
            )}

            {/* Notes Column */}
            <div className={cn(
              'transition-all duration-150',
              notesCollapsed ? 'w-12 flex-shrink-0' : 'min-w-[18rem] flex-none'
            )}
              style={notesCollapsed ? undefined : { flexBasis: 0, flexGrow: columnWidths.notes }}
            >
              <NotesColumn
                notes={notes}
                isLoading={notesLoading}
                notebookId={notebookId}
                notebookName={notebook?.name}
                sources={sources}
                profileOptions={learningProfileOptions}
                onProfileOptionsChange={setLearningProfileOptions}
                contextSelections={contextSelections.notes}
                onContextModeChange={handleNoteContextModeChange}
                onBulkContextModeChange={handleBulkNoteContext}
              />
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
