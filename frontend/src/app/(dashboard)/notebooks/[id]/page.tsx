'use client'

import { useState, useEffect } from 'react'
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
import { NotebookProfileBanner } from '@/components/notebooks/NotebookProfileBanner'
import { NotebookDesktopLayout } from '@/components/notebooks/NotebookDesktopLayout'
import { useNotebookColumnsStore } from '@/lib/stores/notebook-columns-store'
import { useIsDesktop } from '@/lib/hooks/use-media-query'
import { useTranslation } from '@/lib/hooks/use-translation'
import { cn } from '@/lib/utils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import {
  BookMarked,
  Brain,
  FileText,
  MessageSquare,
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
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden bg-muted/10">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 lg:p-4">
          <div className="mb-3 flex items-center gap-2 md:hidden">
            {notebookActionButtons('h-9 flex-1 px-3')}
          </div>

          <NotebookProfileBanner
            sourceCount={sources?.length ?? 0}
            assetCount={notes?.length ?? 0}
            onClick={openLearningProfile}
            className="mb-3"
          />

          {/* Mobile: Tabbed interface - only render on mobile to avoid double-mounting */}
          {!isDesktop && (
            <Tabs
              value={mobileActiveTab}
              onValueChange={(value) =>
                setMobileActiveTab(value as 'sources' | 'notes' | 'chat')
              }
              className="min-h-0 flex-1 gap-0 xl:hidden"
            >
              <TabsList className="mb-3 grid h-11 w-full shrink-0 grid-cols-3 rounded-xl border bg-background/90 p-1 shadow-sm">
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

              <TabsContent
                value="sources"
                className="mt-0 flex min-h-0 overflow-hidden"
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
                  forceExpanded
                />
              </TabsContent>
              <TabsContent
                value="notes"
                className="mt-0 flex min-h-0 overflow-hidden"
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
                  forceExpanded
                />
              </TabsContent>
              <TabsContent
                value="chat"
                className="mt-0 flex min-h-0 overflow-hidden"
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
              </TabsContent>
            </Tabs>
          )}

          {/* Desktop: Collapsible columns layout */}
          {isDesktop && (
            <NotebookDesktopLayout
              sourcesCollapsed={sourcesCollapsed}
              notesCollapsed={notesCollapsed}
              chat={
                <ChatColumn
                  notebookId={notebookId}
                  notebookName={notebook?.name}
                  contextSelections={contextSelections}
                  sources={sources}
                  sourcesLoading={sourcesLoading}
                  autoUpdateProfile={learningProfileOptions.autoUpdateProfile}
                  useProfileSource={learningProfileOptions.useProfileSource}
                />
              }
              sources={
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
              }
              notes={
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
              }
            />
          )}
        </div>
      </div>
    </AppShell>
  )
}
