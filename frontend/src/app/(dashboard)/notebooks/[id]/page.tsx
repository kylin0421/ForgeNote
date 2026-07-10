'use client'

import { useState, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { InlineEdit } from '@/components/common/InlineEdit'
import { SourcesColumn } from '../components/SourcesColumn'
import { NotesColumn } from '../components/NotesColumn'
import { ChatColumn } from '../components/ChatColumn'
import { LearningCurveDialog } from '../components/LearningCurveDialog'
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
import { FileText, StickyNote, MessageSquare, TrendingUp } from 'lucide-react'
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
  sources: 30,
  chat: 40,
  notes: 30,
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
    handle: 'sources-chat' | 'chat-notes'
    startX: number
    containerWidth: number
    startWidths: NotebookColumnWidths
  } | null>(null)
  const [columnWidths, setColumnWidths] = useState<NotebookColumnWidths>(DEFAULT_NOTEBOOK_COLUMN_WIDTHS)

  // Detect desktop to avoid double-mounting ChatColumn
  const isDesktop = useIsDesktop()

  // Mobile tab state (Sources, Notes, or Chat)
  const [mobileActiveTab, setMobileActiveTab] = useState<'sources' | 'notes' | 'chat'>(
    initialSourceSearch ? 'sources' : 'chat'
  )

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
      const stored = window.localStorage.getItem(`notebook-column-widths:${notebookId}`)
      if (!stored) return
      const parsed = JSON.parse(stored) as Partial<NotebookColumnWidths>
      if (
        typeof parsed.sources === 'number' &&
        typeof parsed.chat === 'number' &&
        typeof parsed.notes === 'number'
      ) {
        setColumnWidths({
          sources: clampColumnWidth(parsed.sources, 16, 55),
          chat: clampColumnWidth(parsed.chat, 24, 68),
          notes: clampColumnWidth(parsed.notes, 18, 55),
        })
      }
    } catch {
      // Ignore malformed local layout state.
    }
  }, [notebookId])

  useEffect(() => {
    if (!notebookId) return
    window.localStorage.setItem(
      `notebook-column-widths:${notebookId}`,
      JSON.stringify(columnWidths)
    )
  }, [columnWidths, notebookId])

  const startColumnResize = (
    handle: 'sources-chat' | 'chat-notes',
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

    if (drag.handle === 'sources-chat') {
      const total = startWidths.sources + startWidths.chat
      const sources = clampColumnWidth(startWidths.sources + delta, 16, total - 24)
      setColumnWidths({
        sources,
        chat: total - sources,
        notes: startWidths.notes,
      })
      return
    }

    const total = startWidths.chat + startWidths.notes
    const chat = clampColumnWidth(startWidths.chat + delta, 24, total - 18)
    setColumnWidths({
      sources: startWidths.sources,
      chat,
      notes: total - chat,
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
        <div className="flex min-w-0 items-center gap-2">
          <InlineEdit
            id="notebook-top-title"
            name="notebook-top-title"
            value={notebook.name}
            onSave={handleUpdateNotebookName}
            className="max-w-full truncate text-xl font-semibold tracking-tight"
            inputClassName="h-9 max-w-md text-xl font-semibold tracking-tight"
            placeholder={t('notebooks.namePlaceholder')}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="shrink-0 gap-1.5 rounded-full"
            onClick={() => setLearningCurveOpen(true)}
          >
            <TrendingUp className="h-4 w-4" />
            学习曲线
          </Button>
        </div>
      }
    >
      <LearningCurveDialog
        open={learningCurveOpen}
        onOpenChange={setLearningCurveOpen}
        notebookId={notebookId}
        sources={sources}
        notes={notes}
      />
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <div className="flex-1 min-h-0 p-6 overflow-x-auto overflow-y-auto flex flex-col">
          <div className="mb-4 flex flex-col gap-3 rounded-xl border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between lg:hidden">
            <div>
              <p className="text-base font-semibold">学习曲线</p>
              <p className="mt-1 text-sm text-muted-foreground">查看学习量、质量变化和最近学习建议。</p>
            </div>
            <Button
              type="button"
              variant="default"
              className="w-full gap-2 rounded-full sm:w-auto"
              onClick={() => setLearningCurveOpen(true)}
            >
              <TrendingUp className="h-4 w-4" />
              打开学习曲线
            </Button>
          </div>

          <div className="mb-4 hidden items-center justify-between rounded-xl border bg-muted/20 p-4 lg:flex">
            <div>
              <p className="text-base font-semibold">学习曲线</p>
              <p className="mt-1 text-sm text-muted-foreground">查看最近 14 天学习量、学习质量、测验表现和下一步建议。</p>
            </div>
            <Button
              type="button"
              variant="default"
              className="gap-2 rounded-full px-5"
              onClick={() => setLearningCurveOpen(true)}
            >
              <TrendingUp className="h-4 w-4" />
              打开学习曲线
            </Button>
          </div>

          {/* Mobile: Tabbed interface - only render on mobile to avoid double-mounting */}
          {!isDesktop && (
            <>
              <div className="lg:hidden mb-4">
                <Tabs value={mobileActiveTab} onValueChange={(value) => setMobileActiveTab(value as 'sources' | 'notes' | 'chat')}>
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="sources" className="gap-2">
                      <FileText className="h-4 w-4" />
                      {t('navigation.sources')}
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
            'hidden lg:flex h-full min-h-0 gap-6 transition-all duration-150',
            'flex-row'
            )}
            onPointerMove={updateColumnResize}
            onPointerUp={stopColumnResize}
            onPointerCancel={stopColumnResize}
          >
            {/* Sources Column */}
            <div className={cn(
              'transition-all duration-150',
              sourcesCollapsed ? 'w-12 flex-shrink-0' : 'min-w-[16rem] flex-none'
            )}
              style={sourcesCollapsed ? undefined : { flexBasis: `${columnWidths.sources}%` }}
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
              />
            </div>

            {!sourcesCollapsed && (
              <div
                role="separator"
                aria-orientation="vertical"
                className="-mx-4 flex w-2 shrink-0 cursor-col-resize items-stretch justify-center"
                onPointerDown={(event) => startColumnResize('sources-chat', event)}
              >
                <span className="my-2 w-px rounded-full bg-border transition-colors hover:bg-primary" />
              </div>
            )}

            {/* Chat Column - always expanded, takes remaining space */}
            <div
              className="min-w-[20rem] flex-none transition-all duration-150"
              style={{
                flexBasis: `${columnWidths.chat}%`,
              }}
            >
              <ChatColumn
                notebookId={notebookId}
                contextSelections={contextSelections}
                sources={sources}
                sourcesLoading={sourcesLoading}
                autoUpdateProfile={learningProfileOptions.autoUpdateProfile}
                useProfileSource={learningProfileOptions.useProfileSource}
              />
            </div>

            {!notesCollapsed && (
              <div
                role="separator"
                aria-orientation="vertical"
                className="-mx-4 flex w-2 shrink-0 cursor-col-resize items-stretch justify-center"
                onPointerDown={(event) => startColumnResize('chat-notes', event)}
              >
                <span className="my-2 w-px rounded-full bg-border transition-colors hover:bg-primary" />
              </div>
            )}

            {/* Notes Column */}
            <div className={cn(
              'transition-all duration-150',
              notesCollapsed ? 'w-12 flex-shrink-0' : 'min-w-[18rem] flex-none lg:pr-6 lg:-mr-6'
            )}
              style={notesCollapsed ? undefined : { flexBasis: `${columnWidths.notes}%` }}
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
