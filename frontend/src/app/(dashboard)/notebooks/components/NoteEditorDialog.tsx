'use client'

import { Controller, useForm, useWatch } from 'react-hook-form'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useCreateNote, useUpdateNote, useNote } from '@/lib/hooks/use-notes'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { MarkdownEditor } from '@/components/ui/markdown-editor'
import { InlineEdit } from '@/components/common/InlineEdit'
import { cn } from "@/lib/utils";
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  LearningAssetPreview,
  MarkdownLikeAsset,
  getLearningAssetKindLabel,
  getLearningAssetTypeLabel,
  parseLearningAssetNote,
  type LearningAssetInteractionEvent,
} from '@/components/learning/LearningAssetPreview'

const createNoteSchema = z.object({
  title: z.string().optional(),
  content: z.string().min(1, 'Content is required'),
})

const stripLearningAssetTitlePrefix = (title: string | null | undefined) => {
  if (!title) {
    return ''
  }
  return title.replace(/^(?:\[[^\]]+\]\s*)+/, '')
}

const isLikelyMarkdownContent = (content: string | null | undefined) => {
  if (!content) {
    return false
  }
  return /(^|\n)\s{0,3}#{1,6}\s+\S/.test(content)
    || /(^|\n)\s{0,3}[-*+]\s+\S/.test(content)
    || /(^|\n)\s{0,3}\d+\.\s+\S/.test(content)
    || /(^|\n)```/.test(content)
    || /(^|\n)\|.+\|/.test(content)
}

type CreateNoteFormData = z.infer<typeof createNoteSchema>

interface NoteEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  notebookId: string
  note?: { id: string; title: string | null; content: string | null; note_type?: string | null }
  onLearningEvent?: (event: LearningAssetInteractionEvent) => void
}

export function NoteEditorDialog({
  open,
  onOpenChange,
  notebookId,
  note,
  onLearningEvent,
}: NoteEditorDialogProps) {
  const { t } = useTranslation()
  const createNote = useCreateNote()
  const updateNote = useUpdateNote()
  const queryClient = useQueryClient()
  const isEditing = Boolean(note)

  // Ensure note ID has 'note:' prefix for API calls
  const noteIdWithPrefix = note?.id
    ? (note.id.includes(':') ? note.id : `note:${note.id}`)
    : ''

  const { data: fetchedNote, isLoading: noteLoading } = useNote(noteIdWithPrefix, { enabled: open && !!note?.id })
  const isSaving = isEditing ? updateNote.isPending : createNote.isPending
  const {
    handleSubmit,
    control,
    formState: { errors },
    reset,
    setValue,
  } = useForm<CreateNoteFormData>({
    resolver: zodResolver(createNoteSchema),
    defaultValues: {
      title: '',
      content: '',
    },
  })
  const watchTitle = useWatch({ control, name: 'title' })
  const watchContent = useWatch({ control, name: 'content' })
  const [isEditorFullscreen, setIsEditorFullscreen] = useState(false)
  const learningAsset = isEditing ? parseLearningAssetNote(watchContent) : null
  const learningAssetKindLabel = learningAsset
    ? getLearningAssetKindLabel(learningAsset.kind, t)
    : null
  const learningAssetTypeLabel = learningAsset
    ? getLearningAssetTypeLabel(learningAsset, t)
    : null
  const showLearningAssetPreview = Boolean(learningAsset)
  const currentNoteType = fetchedNote?.note_type ?? note?.note_type ?? null
  const showMarkdownPreview =
    !learningAsset &&
    currentNoteType === 'ai' &&
    isLikelyMarkdownContent(watchContent)
  const showReadOnlyPreview = showLearningAssetPreview || showMarkdownPreview
  const [activeHydrationKey, setActiveHydrationKey] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      reset({ title: '', content: '' })
      setActiveHydrationKey(null)
      return
    }

    const source = fetchedNote ?? note
    const sourceId = source?.id ?? null
    const sourceContent = source?.content ?? ''
    const hydrationKey = [
      sourceId ?? 'new',
      source?.title ?? '',
      sourceContent.length,
      sourceContent.slice(0, 80),
      sourceContent.slice(-80),
    ].join(':')
    const shouldHydrate = hydrationKey !== activeHydrationKey
    if (!shouldHydrate) {
      return
    }

    setActiveHydrationKey(hydrationKey)
    const title = stripLearningAssetTitlePrefix(source?.title ?? '')

    reset({ title, content: sourceContent })
  }, [open, note, fetchedNote, activeHydrationKey, reset])

  useEffect(() => {
    if (!open) return

    const observer = new MutationObserver(() => {
      setIsEditorFullscreen(!!document.querySelector('.w-md-editor-fullscreen'))
    })
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [open])

  const onSubmit = async (data: CreateNoteFormData) => {
    const title = stripLearningAssetTitlePrefix(data.title)
    if (note) {
      await updateNote.mutateAsync({
        id: noteIdWithPrefix,
        data: {
          title: title || undefined,
          content: data.content,
        },
      })
      // Only invalidate notebook-specific queries if we have a notebookId
      if (notebookId) {
        queryClient.invalidateQueries({ queryKey: QUERY_KEYS.notes(notebookId) })
      }
    } else {
      // Creating a note requires a notebookId
      if (!notebookId) {
        console.error('Cannot create note without notebook_id')
        return
      }
      await createNote.mutateAsync({
        title: title || undefined,
        content: data.content,
        note_type: 'human',
        notebook_id: notebookId,
      })
    }

    reset()
    onOpenChange(false)
  }

  const handleClose = () => {
    reset()
    setIsEditorFullscreen(false)
    onOpenChange(false)
  }

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleClose()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className={cn(
          "sm:max-w-3xl w-full max-h-[90vh] overflow-hidden p-0 flex flex-col",
          isEditorFullscreen && "!max-w-screen !max-h-screen border-none w-screen h-screen"
        )}>
        <DialogTitle className="sr-only">
          {learningAsset ? '学习资产' : isEditing ? t('sources.editNote') : t('sources.createNote')}
        </DialogTitle>
        <form
          onSubmit={handleSubmit(onSubmit)}
          className={cn(
            "flex flex-col min-w-0",
            isEditorFullscreen ? "h-screen max-h-screen" : "max-h-[90vh]"
          )}
        >
          {isEditing && noteLoading ? (
            <div className="flex-1 flex items-center justify-center py-10">
              <span className="text-sm text-muted-foreground">{t('common.loading')}</span>
            </div>
          ) : (
            <>
              <div className="border-b px-6 py-4">
                {showLearningAssetPreview && learningAsset ? (
                  <div className="min-w-0">
                    <h2 className="break-words text-xl font-semibold">
                      {learningAssetKindLabel ? `[${learningAssetKindLabel}] ` : ''}
                      {watchTitle || learningAsset.title || '未命名学习资产'}
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {learningAssetTypeLabel}
                    </p>
                  </div>
                ) : showMarkdownPreview ? (
                  <div className="min-w-0">
                    <h2 className="break-words text-xl font-semibold">
                      {watchTitle || t('sources.untitledNote')}
                    </h2>
                  </div>
                ) : (
                  <InlineEdit
                    id="note-title"
                    name="title"
                    value={watchTitle ?? ''}
                    onSave={(value) => setValue('title', value || '')}
                    placeholder={learningAsset ? '添加资产标题' : t('sources.addTitle')}
                    emptyText={learningAsset ? '未命名学习资产' : t('sources.untitledNote')}
                    className="text-xl font-semibold"
                    inputClassName="text-xl font-semibold"
                  />
                )}
              </div>

              <div className={cn(
                  "min-h-0 flex-1 overflow-y-auto",
                  !isEditorFullscreen && "px-6 py-4")
              }>
                {showLearningAssetPreview && learningAsset ? (
                  <LearningAssetPreview
                    resource={learningAsset}
                    onLearningEvent={onLearningEvent}
                  />
                ) : showMarkdownPreview ? (
                  <MarkdownLikeAsset
                    content={watchContent || ''}
                    compactHeight="max-h-[calc(90vh-220px)]"
                  />
                ) : (
                  <>
                    <Controller
                      control={control}
                      name="content"
                      render={({ field }) => (
                        <MarkdownEditor
                          key={note?.id ?? 'new'}
                          textareaId="note-content"
                          value={field.value}
                          onChange={field.onChange}
                          height={420}
                          placeholder={t('sources.writeNotePlaceholder')}
                          className={cn(
                              "w-full h-full min-h-[420px] overflow-hidden [&_.w-md-editor]:!static [&_.w-md-editor]:!w-full [&_.w-md-editor]:!h-full [&_.w-md-editor-content]:overflow-y-auto",
                              !isEditorFullscreen && "rounded-md border"
                          )}
                        />
                      )}
                    />
                    {errors.content && (
                      <p className="text-sm text-red-600 mt-1">{errors.content.message}</p>
                    )}
                  </>
                )}
              </div>
            </>
          )}

          <div className="border-t px-6 py-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              {showReadOnlyPreview ? t('common.close') : t('common.cancel')}
            </Button>
            {!showReadOnlyPreview && (
              <Button
                type="submit"
                disabled={isSaving || (isEditing && noteLoading)}
              >
                {isSaving
                  ? isEditing ? `${t('common.saving')}...` : `${t('common.creating')}...`
                  : learningAsset
                    ? '保存资产'
                    : isEditing
                      ? t('sources.saveNote')
                      : t('sources.createNoteBtn')}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
