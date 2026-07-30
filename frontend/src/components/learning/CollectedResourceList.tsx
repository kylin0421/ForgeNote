'use client'

import type { ReactNode } from 'react'
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  PlayCircle,
  Plus,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { LearningCollectedResource } from '@/lib/types/learning'
import { cn } from '@/lib/utils'

const RESOURCE_CONTENT_LABELS: Record<string, string> = {
  video: '视频',
  article: '文章',
  webpage: '网页',
  paper: '论文',
  course: '课程',
  practice: '练习',
  code: '代码',
}

function BadgeText({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-md border bg-background px-2 py-0.5 text-xs text-muted-foreground">
      {children}
    </span>
  )
}

export interface CollectedResourceListProps {
  resources: LearningCollectedResource[]
  acceptedResourceUrls?: Readonly<Record<string, boolean>>
  acceptingResourceIds?: Readonly<Record<string, boolean>>
  onAccept: (resource: LearningCollectedResource) => void
  className?: string
}

/**
 * The shared result surface for both live resource collection and cached demos.
 * Data acquisition stays outside this component, so cached results exercise the
 * same links, metadata, video affordance, and adoption interaction as live jobs.
 */
export function CollectedResourceList({
  resources,
  acceptedResourceUrls = {},
  acceptingResourceIds = {},
  onAccept,
  className,
}: CollectedResourceListProps) {
  if (resources.length === 0) return null

  return (
    <div className={cn('grid gap-3 2xl:grid-cols-2', className)}>
      {resources.map((resource) => {
        const accepted =
          resource.adoption_status === 'accepted' ||
          Boolean(resource.url && acceptedResourceUrls[resource.url])
        const isAccepting = Boolean(acceptingResourceIds[resource.id])
        const isVideo =
          resource.content_type === 'video' ||
          resource.resource_kind === 'video_lecture'

        return (
          <article
            key={resource.id}
            className="overflow-hidden rounded-xl border bg-background"
            data-testid={`collected-resource-${resource.id}`}
          >
            {isVideo && (
              <a
                href={resource.url || undefined}
                target="_blank"
                rel="noreferrer"
                aria-label={`播放资料：${resource.title}`}
                className="group relative block aspect-video overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-primary/70"
                style={
                  resource.thumbnail_url
                    ? {
                        backgroundImage: `linear-gradient(to top, rgba(15,23,42,.58), rgba(15,23,42,.06)), url("${resource.thumbnail_url}")`,
                        backgroundPosition: 'center',
                        backgroundSize: 'cover',
                      }
                    : undefined
                }
              >
                <span className="absolute inset-0 flex items-center justify-center">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-slate-950 shadow-lg transition-transform group-hover:scale-105">
                    <PlayCircle className="h-7 w-7" />
                  </span>
                </span>
                <span className="absolute bottom-2 left-2 rounded-md bg-black/65 px-2 py-1 text-[11px] font-medium text-white">
                  视频课程
                </span>
              </a>
            )}

            <div className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {resource.url ? (
                    <a
                      href={resource.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex break-words text-sm font-medium hover:text-primary hover:underline"
                    >
                      {resource.title}
                      <ExternalLink className="ml-1 mt-0.5 h-3.5 w-3.5 shrink-0" />
                    </a>
                  ) : (
                    <p className="break-words text-sm font-medium">{resource.title}</p>
                  )}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {resource.content_type && (
                      <BadgeText>
                        {RESOURCE_CONTENT_LABELS[resource.content_type] || resource.content_type}
                      </BadgeText>
                    )}
                    {typeof resource.quality_score === 'number' && (
                      <BadgeText>质量 {Math.round(resource.quality_score * 100)}</BadgeText>
                    )}
                    {resource.resource_kind && <BadgeText>{resource.resource_kind}</BadgeText>}
                    {resource.search_intent && <BadgeText>{resource.search_intent}</BadgeText>}
                    {(resource.tags || []).map((tag) => (
                      <BadgeText key={`${resource.id}-${tag}`}>{tag}</BadgeText>
                    ))}
                  </div>
                </div>

                <Button
                  type="button"
                  size="sm"
                  variant={accepted ? 'secondary' : 'outline'}
                  className="shrink-0"
                  onClick={() => onAccept(resource)}
                  disabled={accepted || isAccepting || !resource.url}
                  aria-label={`${accepted ? '已采纳' : '采纳'}资料：${resource.title}`}
                >
                  {isAccepting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : accepted ? (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  {accepted ? '已采纳' : '采纳'}
                </Button>
              </div>

              {resource.snippet && (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{resource.snippet}</p>
              )}
              {resource.learning_value && (
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  {resource.learning_value}
                </p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">
                {resource.provider || 'Web Search'} · {resource.reason}
              </p>
            </div>
          </article>
        )
      })}
    </div>
  )
}
