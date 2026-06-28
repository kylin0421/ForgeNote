'use client'

import { FormEvent } from 'react'
import { Check, Loader2, Sparkles, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useTranslation } from '@/lib/hooks/use-translation'
import { getLearningAssetKindLabel } from '@/components/learning/LearningAssetPreview'
import type { LearningOutputKind } from '@/lib/types/learning'
import { cn } from '@/lib/utils'

export const DEFAULT_ASSET_GOAL =
  '请基于当前学习记录中的来源生成通用但具体的学习资产。覆盖核心概念、方法脉络、关键术语、易混点、可自测问题和复习卡片；所有内容必须严格依据来源。'

export type LearningAssetLength = 'short' | 'default' | 'long'

export interface LearningProfileOptions {
  autoUpdateProfile: boolean
  useProfileSource: boolean
}

export interface LearningAssetDetailConfig {
  format: string
  language: string
  length: LearningAssetLength
  focus: string
}

export interface LearningAssetGenerationConfig extends LearningProfileOptions {
  goal: string
  outputs: LearningOutputKind[]
}

export const LEARNING_ASSET_OPTIONS: Array<{
  kind: LearningOutputKind
  label: string
  description: string
  formats: Array<{ id: string; label: string; description: string }>
}> = [
  {
    kind: 'study_guide',
    label: '讲解文档',
    description: '长文档，解释概念、方法、证据和易混点。',
    formats: [
      { id: 'deep_dive', label: 'Deep dive', description: '系统长文，适合完整学习。' },
      { id: 'brief', label: 'Brief', description: '抓住核心概念和结论。' },
      { id: 'exam_prep', label: 'Exam prep', description: '面向考试和复习检查点。' },
      { id: 'critique', label: 'Critique', description: '强调边界、假设和局限。' },
    ],
  },
  {
    kind: 'quiz',
    label: 'Quiz',
    description: '可互动测验，包含选项、得分和解析。',
    formats: [
      { id: 'diagnostic', label: 'Diagnostic', description: '先诊断薄弱点。' },
      { id: 'concept_check', label: 'Concept check', description: '检查核心概念。' },
      { id: 'application', label: 'Application', description: '偏应用和迁移。' },
      { id: 'exam_style', label: 'Exam style', description: '偏考试题型。' },
    ],
  },
  {
    kind: 'flashcards',
    label: '知识闪卡',
    description: '可翻面卡片，用于主动回忆。',
    formats: [
      { id: 'core_terms', label: 'Core terms', description: '术语、定义和边界。' },
      { id: 'qa', label: 'Q&A', description: '问题正面，答案背面。' },
      { id: 'mistakes', label: 'Mistakes', description: '常见误解和纠偏。' },
      { id: 'cloze', label: 'Cloze', description: '填空式回忆。' },
    ],
  },
  {
    kind: 'mind_map',
    label: '知识图谱',
    description: '把概念关系组织成结构图。',
    formats: [
      { id: 'concept_map', label: 'Concept map', description: '概念和依赖关系。' },
      { id: 'process', label: 'Process', description: '流程和阶段。' },
      { id: 'comparison', label: 'Comparison', description: '对比相似概念。' },
      { id: 'mermaid', label: 'Mermaid', description: '输出 Mermaid 结构。' },
    ],
  },
  {
    kind: 'reading',
    label: '阅读材料',
    description: '扩展阅读与精读路线。',
    formats: [
      { id: 'guided', label: 'Guided', description: '带阅读问题。' },
      { id: 'annotated', label: 'Annotated', description: '重点标注。' },
      { id: 'roadmap', label: 'Roadmap', description: '分阶段阅读路线。' },
      { id: 'source_first', label: 'Source first', description: '严格按来源组织。' },
    ],
  },
  {
    kind: 'code_lab',
    label: '代码实验',
    description: '技术主题的实验步骤和检查点。',
    formats: [
      { id: 'notebook', label: 'Notebook', description: 'Notebook 风格实验。' },
      { id: 'minimal', label: 'Minimal', description: '最小可复现实验。' },
      { id: 'debugging', label: 'Debugging', description: '调试和排错导向。' },
      { id: 'project', label: 'Project', description: '小项目导向。' },
    ],
  },
]

export function getDefaultLearningAssetDetail(
  kind: LearningOutputKind
): LearningAssetDetailConfig {
  const option = LEARNING_ASSET_OPTIONS.find((item) => item.kind === kind)
  return {
    format: option?.formats[0]?.id ?? 'default',
    language: '中文',
    length: 'default',
    focus: '',
  }
}

export function buildLearningAssetGoal(
  kind: LearningOutputKind,
  detail: LearningAssetDetailConfig
) {
  const option = LEARNING_ASSET_OPTIONS.find((item) => item.kind === kind)
  const format = option?.formats.find((item) => item.id === detail.format)
  const lengthLabel: Record<LearningAssetLength, string> = {
    short: '短',
    default: '默认',
    long: '长',
  }
  const focus = detail.focus.trim()

  return [
    DEFAULT_ASSET_GOAL,
    `资产类型：${option?.label ?? kind}`,
    `具体格式：${format?.label ?? detail.format}。${format?.description ?? ''}`,
    `语言：${detail.language}`,
    `长度：${lengthLabel[detail.length]}`,
    focus ? `额外聚焦：${focus}` : '额外聚焦：按来源自动判断最值得学习的重点。',
  ].join('\n')
}

interface LearningAssetGenerateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  outputKind: LearningOutputKind | null
  detailConfig: LearningAssetDetailConfig
  onDetailConfigChange: (config: LearningAssetDetailConfig) => void
  profileOptions: LearningProfileOptions
  onProfileOptionsChange: (options: LearningProfileOptions) => void
  onGenerate: (config: LearningAssetGenerationConfig) => void
  isGenerating: boolean
  sourceCount: number
}

export function LearningAssetGenerateDialog({
  open,
  onOpenChange,
  outputKind,
  detailConfig,
  onDetailConfigChange,
  profileOptions,
  onProfileOptionsChange,
  onGenerate,
  isGenerating,
  sourceCount,
}: LearningAssetGenerateDialogProps) {
  const option = LEARNING_ASSET_OPTIONS.find((item) => item.kind === outputKind)
  const { t } = useTranslation()
  const optionLabel = option
    ? getLearningAssetKindLabel(option.kind, t)
    : t('common.aiGenerated')

  const updateDetail = (patch: Partial<LearningAssetDetailConfig>) => {
    onDetailConfigChange({ ...detailConfig, ...patch })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!outputKind) return

    onGenerate({
      goal: buildLearningAssetGoal(outputKind, detailConfig),
      outputs: [outputKind],
      autoUpdateProfile: profileOptions.autoUpdateProfile,
      useProfileSource: profileOptions.useProfileSource,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto p-0 sm:max-w-5xl">
        <DialogHeader className="border-b px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle className="text-xl">
                {`自定义 ${optionLabel}`}
              </DialogTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                这些设置只会应用到这一次资产生成。
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              aria-label="关闭"
            >
              <X className="h-5 w-5" />
            </Button>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-8 px-6 py-6">
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold">Format</h3>
                <span className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground">
                  {sourceCount} 个内容来源
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(option?.formats ?? []).map((format) => {
                  const selected = detailConfig.format === format.id
                  return (
                    <button
                      key={format.id}
                      type="button"
                      onClick={() => updateDetail({ format: format.id })}
                      disabled={isGenerating}
                      className={cn(
                        'min-h-36 rounded-lg border bg-muted/20 p-4 text-left transition-colors',
                        selected
                          ? 'border-primary bg-primary/10'
                          : 'hover:border-primary/50 hover:bg-muted/40'
                      )}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="font-semibold">{format.label}</span>
                        {selected && <Check className="h-5 w-5" />}
                      </span>
                      <span className="mt-5 block text-sm leading-6 text-muted-foreground">
                        {format.description}
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
              <section className="space-y-3">
                <h3 className="text-base font-semibold">Choose language</h3>
                <Select
                  value={detailConfig.language}
                  onValueChange={(language) => updateDetail({ language })}
                  disabled={isGenerating}
                >
                  <SelectTrigger className="h-12 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="中文">中文</SelectItem>
                    <SelectItem value="English">English</SelectItem>
                    <SelectItem value="中英双语">中英双语</SelectItem>
                  </SelectContent>
                </Select>
              </section>

              <section className="space-y-3">
                <h3 className="text-base font-semibold">Length</h3>
                <div className="inline-flex overflow-hidden rounded-full border">
                  {(['short', 'default', 'long'] as LearningAssetLength[]).map((length) => (
                    <button
                      key={length}
                      type="button"
                      disabled={isGenerating}
                      onClick={() => updateDetail({ length })}
                      className={cn(
                        'flex h-12 min-w-24 items-center justify-center gap-2 border-r px-4 text-sm last:border-r-0',
                        detailConfig.length === length
                          ? 'bg-primary/10 font-medium'
                          : 'bg-background hover:bg-muted'
                      )}
                    >
                      {detailConfig.length === length && <Check className="h-4 w-4" />}
                      {length === 'short' ? 'Short' : length === 'long' ? 'Long' : 'Default'}
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <section className="space-y-3">
              <h3 className="text-base font-semibold">这次生成要重点关注什么？</h3>
              <Textarea
                value={detailConfig.focus}
                onChange={(event) => updateDetail({ focus: event.target.value })}
                placeholder={
                  '可选：例如「只覆盖第二篇论文」「更关注方法和实验」「面向第一次接触这个主题的人解释」。留空则自动根据来源生成。'
                }
                className="min-h-36 resize-none"
                disabled={isGenerating}
              />
            </section>

            <section className="space-y-3 rounded-lg border bg-muted/30 p-4">
              <h3 className="text-base font-semibold">学习画像</h3>
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <Checkbox
                  checked={profileOptions.useProfileSource}
                  onCheckedChange={(checked) =>
                    onProfileOptionsChange({
                      ...profileOptions,
                      useProfileSource: checked === true,
                    })
                  }
                  disabled={isGenerating}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium">默认参考学习画像</span>
                  <span className="block text-xs leading-5 text-muted-foreground">
                    生成资产时把「学习画像」来源作为上下文。
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <Checkbox
                  checked={profileOptions.autoUpdateProfile}
                  onCheckedChange={(checked) =>
                    onProfileOptionsChange({
                      ...profileOptions,
                      autoUpdateProfile: checked === true,
                    })
                  }
                  disabled={isGenerating}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium">自动更新学习画像</span>
                  <span className="block text-xs leading-5 text-muted-foreground">
                    生成、对话和 Quiz 答题会把可解释的学习信号写回画像来源。
                  </span>
                </span>
              </label>
            </section>
          </div>

          <DialogFooter className="border-t px-6 py-4">
            <Button type="submit" disabled={isGenerating || !outputKind}>
              {isGenerating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              生成
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
