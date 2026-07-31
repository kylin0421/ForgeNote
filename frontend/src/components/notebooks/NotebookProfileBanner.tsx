'use client'

import { ArrowRight, Brain, Sparkles } from 'lucide-react'

import { cn } from '@/lib/utils'

type NotebookProfileBannerProps = {
  sourceCount?: number
  assetCount?: number
  onClick?: () => void
  className?: string
}

export function NotebookProfileBanner({
  sourceCount = 0,
  assetCount = 0,
  onClick,
  className,
}: NotebookProfileBannerProps) {
  const items: Array<[string, string, boolean]> = [
    ['画像', '已启用', true],
    ['资料', sourceCount ? `${sourceCount} 项` : '待检索', sourceCount > 0],
    ['资产', assetCount ? `${assetCount} 项` : '待生成', assetCount > 0],
    ['评估', 'Quiz 后回写', false],
  ]

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full shrink-0 flex-col gap-3 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-background px-3 py-2.5 text-left shadow-sm transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-md md:flex-row md:items-center',
        className
      )}
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
          <span className="mt-0.5 hidden text-xs leading-5 text-muted-foreground lg:block">
            正在用于个性化对话、资料推荐和难度调整；每次对话、Quiz 与资料选择后自动更新。
          </span>
        </span>
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground md:justify-center">
        {items.map(([label, value, ready], index) => (
          <span key={label} className="flex items-center gap-1.5">
            <span
              className={cn(
                'rounded-full border bg-background px-2.5 py-1',
                ready && 'border-emerald-500/25 text-emerald-700 dark:text-emerald-300'
              )}
            >
              <span className="font-medium text-foreground">{label}</span>
              <span className="mx-1 text-muted-foreground">·</span>
              {value}
            </span>
            {index < items.length - 1 && (
              <ArrowRight className="hidden h-3 w-3 text-muted-foreground/50 sm:block" />
            )}
          </span>
        ))}
      </span>
      <span className="shrink-0 rounded-full border bg-background px-2.5 py-1 text-[11px] font-medium text-primary">
        查看画像证据 / 编辑
      </span>
    </button>
  )
}
