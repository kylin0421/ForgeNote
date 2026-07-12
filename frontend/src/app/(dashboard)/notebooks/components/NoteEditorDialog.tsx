'use client'

import { Controller, useForm, useWatch } from 'react-hook-form'
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Download, Edit3, Eye, Maximize2, Minimize2, Save, Upload, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useCreateNote, useUpdateNote, useNote } from '@/lib/hooks/use-notes'
import { QUERY_KEYS } from '@/lib/api/query-client'
import { MarkdownEditor } from '@/components/ui/markdown-editor'
import { InlineEdit } from '@/components/common/InlineEdit'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/hooks/use-translation'
import {
  LearningAssetPreview,
  MindMapVisualEditor,
  MarkdownLikeAsset,
  getLearningAssetKindLabel,
  getLearningAssetTypeLabel,
  mindMapContentToSvg,
  parseLearningAssetNote,
  serializeLearningAssetNote,
  type MindMapMaterial,
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

const isLikelyMindMapContent = (
  content: string | null | undefined,
  title?: string | null
) => {
  if (!content) {
    return false
  }
  const combined = `${title ?? ''}\n${content}`
  return /思维导图|知识导图|知识图谱|mind\s*map|concept\s*map/i.test(combined)
    || /<!--\s*mind-map-visual/i.test(content)
    || /(^|\n)\s*mindmap\b/i.test(content)
    || /(^|\n)\s*```(?:mermaid|mindmap)?[\s\S]{0,80}\b(?:mindmap|flowchart\s+LR|graph\s+LR)\b/i.test(content)
    || /(^|\n)\s*(?:flowchart|graph)\s+LR\b/i.test(content)
}

const hasExecutableCodeBlock = (content: string | null | undefined) => {
  if (!content) {
    return false
  }

  const pattern = /```([A-Za-z0-9_+-]*)\s*\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content)) !== null) {
    const language = (match[1] || 'python').toLowerCase()
    const code = match[2].trim()
    if (code && /^(python|py|julia|r|javascript|js|typescript|ts|bash|sh|sql)$/.test(language)) {
      return true
    }
  }

  return false
}

const safeExportFilename = (value: string | null | undefined, fallback = 'learning-asset') => {
  const compact = (value || '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  return compact || fallback
}

const downloadTextFile = (content: string, filename: string, type = 'text/markdown;charset=utf-8') => {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const svgToPngBlob = (svg: string): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth || image.width
      canvas.height = image.naturalHeight || image.height
      const context = canvas.getContext('2d')
      if (!context) {
        URL.revokeObjectURL(url)
        reject(new Error('Canvas is not available'))
        return
      }
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(image, 0, 0)
      canvas.toBlob((blob) => {
        URL.revokeObjectURL(url)
        if (blob) {
          resolve(blob)
        } else {
          reject(new Error('Unable to create PNG'))
        }
      }, 'image/png')
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Unable to load SVG'))
    }
    image.src = url
  })

type CreateNoteFormData = z.infer<typeof createNoteSchema>

interface NoteEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  notebookId: string
  note?: { id: string; title: string | null; content: string | null; note_type?: string | null }
  initialFullscreen?: boolean
  mindMapMaterials?: MindMapMaterial[]
  onLearningEvent?: (event: LearningAssetInteractionEvent) => void
}

export function NoteEditorDialog({
  open,
  onOpenChange,
  notebookId,
  note,
  initialFullscreen = false,
  mindMapMaterials = [],
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
  const [isAssetEditing, setIsAssetEditing] = useState(false)
  const [mindMapImportOpen, setMindMapImportOpen] = useState(false)
  const [mindMapImportText, setMindMapImportText] = useState('')
  const [mindMapEditorVersion, setMindMapEditorVersion] = useState(0)
  const parsedLearningAsset = isEditing ? parseLearningAssetNote(watchContent) : null
  const inferredMindMapAsset =
    isEditing && !parsedLearningAsset && isLikelyMindMapContent(watchContent, watchTitle)
      ? {
          kind: 'mind_map' as const,
          type: 'Mind map',
          title: watchTitle || '思维导图',
          agent: 'studio',
          format: 'visual mind map',
          summary: '',
          content: watchContent || '',
          tags: [],
          payload: {},
        }
      : null
  const learningAsset = parsedLearningAsset ?? inferredMindMapAsset
  const isInferredMindMapAsset = Boolean(inferredMindMapAsset && !parsedLearningAsset)
  const learningAssetKindLabel = learningAsset
    ? getLearningAssetKindLabel(learningAsset.kind, t)
    : null
  const learningAssetTypeLabel = learningAsset
    ? getLearningAssetTypeLabel(learningAsset, t)
    : null
  const showLearningAssetPreview = Boolean(learningAsset)
  const canEditLearningAsset =
    learningAsset?.kind === 'mind_map' ||
    (
      learningAsset?.kind === 'code_lab' &&
      hasExecutableCodeBlock(learningAsset.content)
    )
  const currentNoteType = fetchedNote?.note_type ?? note?.note_type ?? null
  const showMarkdownPreview =
    !learningAsset &&
    currentNoteType === 'ai' &&
    isLikelyMarkdownContent(watchContent)
  const showLearningAssetReadOnlyPreview =
    showLearningAssetPreview && (!isAssetEditing || !canEditLearningAsset)
  const showReadOnlyPreview = showLearningAssetReadOnlyPreview || showMarkdownPreview
  const canExportCurrentContent = learningAsset?.kind === 'study_guide' || learningAsset?.kind === 'mind_map'
  const [activeHydrationKey, setActiveHydrationKey] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setIsEditorFullscreen(initialFullscreen)
    }
  }, [open, initialFullscreen])

  useEffect(() => {
    if (!open) {
      reset({ title: '', content: '' })
      setActiveHydrationKey(null)
      setIsAssetEditing(false)
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
    setIsAssetEditing(false)
    const title = stripLearningAssetTitlePrefix(source?.title ?? '')

    reset({ title, content: sourceContent })
  }, [open, note, fetchedNote, activeHydrationKey, reset])

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
    setIsAssetEditing(false)
    onOpenChange(false)
  }

  const handleClose = () => {
    reset()
    setIsEditorFullscreen(false)
    setIsAssetEditing(false)
    onOpenChange(false)
  }

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      handleClose()
    }
  }

  const handleLearningAssetContentChange = (value?: string) => {
    if (!learningAsset) {
      return
    }
    if (isInferredMindMapAsset) {
      setValue('content', value ?? '', { shouldDirty: true })
      return
    }
    const nextAsset = {
      ...learningAsset,
      content: value ?? '',
    }
    setValue(
      'content',
      serializeLearningAssetNote(
        nextAsset,
        learningAssetKindLabel ?? getLearningAssetKindLabel(nextAsset.kind, t)
      ),
      { shouldDirty: true }
    )
  }

  const handleExportCurrentContent = async (format: 'md' | 'png' = 'md') => {
    const title = watchTitle || learningAsset?.title || fetchedNote?.title || note?.title || '学习资料'
    if (format === 'png' && learningAsset?.kind === 'mind_map') {
      const svg = mindMapContentToSvg(learningAsset.content || '', title)
      const blob = await svgToPngBlob(svg)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${safeExportFilename(title)}.png`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      return
    }
    const body = learningAsset
      ? [
          `# ${title}`,
          '',
          `类型：${learningAssetKindLabel ?? getLearningAssetKindLabel(learningAsset.kind, t)}`,
          '',
          learningAsset.content || '',
        ].join('\n')
      : watchContent || ''
    downloadTextFile(body, `${safeExportFilename(title)}.md`)
  }

  const handleImportMindMap = () => {
    const nextContent = mindMapImportText.trim()
    if (!nextContent) {
      window.alert('请先粘贴 Mermaid、Markdown 或分级列表形式的思维导图内容。')
      return
    }
    handleLearningAssetContentChange(nextContent)
    setMindMapEditorVersion((current) => current + 1)
    setIsAssetEditing(true)
    setMindMapImportOpen(false)
    setMindMapImportText('')
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "sm:max-w-3xl w-full max-h-[90vh] overflow-hidden p-0 flex flex-col",
          isEditorFullscreen && "!h-screen !max-h-none !w-screen !max-w-none !rounded-none !border-0"
        )}
      >
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
                <div className="flex min-w-0 items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
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
                  <div className="flex shrink-0 items-center gap-2">
                    {learningAsset?.kind === 'mind_map' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setMindMapImportText(learningAsset.content || '')
                          setMindMapImportOpen(true)
                        }}
                      >
                        <Upload className="mr-2 h-4 w-4" />
                        导入
                      </Button>
                    )}
                    {canExportCurrentContent && (
                      learningAsset?.kind === 'mind_map' ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button type="button" variant="outline" size="sm">
                              <Download className="mr-2 h-4 w-4" />
                              导出
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => void handleExportCurrentContent('png')}>
                              导出图片 PNG
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => void handleExportCurrentContent('md')}>
                              导出 MD
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => void handleExportCurrentContent('md')}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          导出
                        </Button>
                      )
                    )}
                    {canEditLearningAsset && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setIsAssetEditing((current) => !current)}
                      >
                        {isAssetEditing ? (
                          <Eye className="mr-2 h-4 w-4" />
                        ) : (
                          <Edit3 className="mr-2 h-4 w-4" />
                        )}
                        {isAssetEditing ? '预览' : '编辑'}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsEditorFullscreen((current) => !current)}
                    >
                      {isEditorFullscreen ? (
                        <Minimize2 className="mr-2 h-4 w-4" />
                      ) : (
                        <Maximize2 className="mr-2 h-4 w-4" />
                      )}
                      {isEditorFullscreen ? '退出全屏' : '全屏'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9"
                      onClick={handleClose}
                      aria-label="关闭"
                      title="关闭"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>

              <div className={cn(
                  "min-h-0 flex-1 overflow-y-auto",
                  !isEditorFullscreen && "px-6 py-4")
              }>
                {showLearningAssetReadOnlyPreview && learningAsset ? (
                  <LearningAssetPreview
                    resource={learningAsset}
                    expanded={isEditorFullscreen}
                    onLearningEvent={onLearningEvent}
                  />
                ) : showLearningAssetPreview && learningAsset?.kind === 'mind_map' ? (
                  <MindMapVisualEditor
                    key={mindMapEditorVersion}
                    content={learningAsset.content}
                    expanded={isEditorFullscreen}
                    materials={mindMapMaterials}
                    onChange={handleLearningAssetContentChange}
                  />
                ) : showLearningAssetPreview && learningAsset ? (
                  <div className={cn("min-h-0", !isEditorFullscreen && "rounded-md border")}>
                    <MarkdownEditor
                      textareaId="learning-asset-content"
                      value={learningAsset.content}
                      onChange={handleLearningAssetContentChange}
                      height={isEditorFullscreen ? 720 : 520}
                      placeholder="编辑学习资产内容，保存后会更新预览。"
                      className="w-full h-full min-h-[520px] overflow-hidden [&_.w-md-editor]:!static [&_.w-md-editor]:!w-full [&_.w-md-editor-content]:overflow-y-auto"
                    />
                  </div>
                ) : showMarkdownPreview ? (
                  <MarkdownLikeAsset
                    content={watchContent || ''}
                    compactHeight={isEditorFullscreen ? 'h-[calc(100vh-210px)] max-h-none' : 'max-h-[calc(90vh-220px)]'}
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
                          height={isEditorFullscreen ? 720 : 420}
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
                <Save className="mr-2 h-4 w-4" />
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
        <Dialog open={mindMapImportOpen} onOpenChange={setMindMapImportOpen}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>导入知识图谱</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                粘贴 Mermaid mindmap、Markdown 分级列表或已有导图内容。确认后会覆盖当前导图，并继续在当前编辑窗口中编辑。
              </p>
              <Textarea
                value={mindMapImportText}
                onChange={(event) => setMindMapImportText(event.target.value)}
                className="min-h-80 font-mono text-sm"
                placeholder={'```mermaid\nmindmap\n  direction right\n  root((主题))\n    模块\n      关键概念\n```'}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMindMapImportOpen(false)}>
                取消
              </Button>
              <Button type="button" onClick={handleImportMindMap}>
                导入并覆盖
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}
