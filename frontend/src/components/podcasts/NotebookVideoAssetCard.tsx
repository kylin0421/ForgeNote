'use client'

import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  Download,
  Maximize2,
  RotateCcw,
  Trash2,
  Video,
} from 'lucide-react'

import { resolvePodcastAssetUrl } from '@/lib/api/podcasts'
import {
  ACTIVE_EPISODE_STATUSES,
  FAILED_EPISODE_STATUSES,
  type EpisodeStatus,
  type PodcastEpisode,
} from '@/lib/types/podcasts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type NotebookVideoAssetCardProps = {
  episode: PodcastEpisode
  displayMode?: 'card' | 'studio'
  onOpenStudio?: (episode: PodcastEpisode) => void
  onBack?: () => void
  onExport?: (episode: PodcastEpisode) => void
  onDelete?: (episode: PodcastEpisode) => void
  onRetry?: (episode: PodcastEpisode) => void
  isRetrying?: boolean
}

export function isExplainerVideoEpisode(episode: PodcastEpisode) {
  return Boolean(
    episode.video_requested
    || episode.video_url
    || episode.video_file
    || episode.keyframes?.length
    || episode.video_error
  )
}

function getStatusLabel(status?: EpisodeStatus | null) {
  if (status === 'completed') return '已生成'
  if (status && ACTIVE_EPISODE_STATUSES.includes(status)) return '生成中'
  if (status && FAILED_EPISODE_STATUSES.includes(status)) return '失败'
  return '等待中'
}

function getAuthenticationToken() {
  if (typeof window === 'undefined') {
    return undefined
  }
  try {
    const raw = window.localStorage.getItem('auth-storage')
    if (!raw) {
      return undefined
    }
    return JSON.parse(raw)?.state?.token as string | undefined
  } catch {
    return undefined
  }
}

export function NotebookVideoAssetCard({
  episode,
  displayMode = 'card',
  onOpenStudio,
  onBack,
  onExport,
  onDelete,
  onRetry,
  isRetrying = false,
}: NotebookVideoAssetCardProps) {
  const [videoSrc, setVideoSrc] = useState<string | undefined>()
  const [subtitleSrc, setSubtitleSrc] = useState<string | undefined>()
  const [audioSrc, setAudioSrc] = useState<string | undefined>()
  const [videoError, setVideoError] = useState<string | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)
  const status = episode.job_status ?? 'unknown'
  const isActive = ACTIVE_EPISODE_STATUSES.includes(status)
  const isFailed = FAILED_EPISODE_STATUSES.includes(status)

  useEffect(() => {
    let revokeUrl: string | undefined
    let active = true
    setVideoSrc(undefined)
    setVideoError(null)

    const loadVideo = async () => {
      if (!episode.video_url && !episode.video_file) {
        return
      }

      const directVideoUrl = await resolvePodcastAssetUrl(
        episode.video_url ?? episode.video_file
      )
      if (!directVideoUrl || !active) {
        return
      }

      const token = getAuthenticationToken()
      if (!episode.video_url || !token) {
        setVideoSrc(directVideoUrl)
        return
      }

      try {
        const response = await fetch(directVideoUrl, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) {
          throw new Error(`Video request failed with status ${response.status}`)
        }
        revokeUrl = URL.createObjectURL(await response.blob())
        if (active) {
          setVideoSrc(revokeUrl)
        }
      } catch (error) {
        console.error('Unable to load notebook explainer video', error)
        if (active) {
          setVideoError('视频暂不可播放')
        }
      }
    }

    void loadVideo()
    return () => {
      active = false
      if (revokeUrl) {
        URL.revokeObjectURL(revokeUrl)
      }
    }
  }, [episode.id, episode.video_file, episode.video_url])

  useEffect(() => {
    let revokeUrl: string | undefined
    let active = true
    setSubtitleSrc(undefined)

    const loadSubtitle = async () => {
      if (!episode.video_subtitle_url) {
        return
      }
      const directSubtitleUrl = await resolvePodcastAssetUrl(
        episode.video_subtitle_url
      )
      if (!directSubtitleUrl || !active) {
        return
      }
      const token = getAuthenticationToken()
      if (!token) {
        setSubtitleSrc(directSubtitleUrl)
        return
      }
      try {
        const response = await fetch(directSubtitleUrl, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) {
          return
        }
        revokeUrl = URL.createObjectURL(
          new Blob([await response.text()], { type: 'text/vtt' })
        )
        if (active) {
          setSubtitleSrc(revokeUrl)
        }
      } catch {
        // Captions are an enhancement; burned captions remain visible if the
        // optional browser track cannot be loaded.
      }
    }

    void loadSubtitle()
    return () => {
      active = false
      if (revokeUrl) {
        URL.revokeObjectURL(revokeUrl)
      }
    }
  }, [episode.id, episode.video_subtitle_url])

  useEffect(() => {
    let revokeUrl: string | undefined
    let active = true
    setAudioSrc(undefined)
    setAudioError(null)

    const loadAudio = async () => {
      if (!episode.audio_url && !episode.audio_file) {
        return
      }

      const directAudioUrl = await resolvePodcastAssetUrl(
        episode.audio_url ?? episode.audio_file
      )
      if (!directAudioUrl || !active) {
        return
      }

      const token = getAuthenticationToken()
      if (!episode.audio_url || !token) {
        setAudioSrc(directAudioUrl)
        return
      }

      try {
        const response = await fetch(directAudioUrl, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) {
          throw new Error(`Audio request failed with status ${response.status}`)
        }
        revokeUrl = URL.createObjectURL(await response.blob())
        if (active) {
          setAudioSrc(revokeUrl)
        }
      } catch (error) {
        console.error('Unable to load retained podcast audio', error)
        if (active) {
          setAudioError('配套播客音频暂不可播放')
        }
      }
    }

    void loadAudio()
    return () => {
      active = false
      if (revokeUrl) {
        URL.revokeObjectURL(revokeUrl)
      }
    }
  }, [episode.audio_file, episode.audio_url, episode.id])

  const failurePlayer = (message: string) => (
    <div className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
      <div>
        <p className="font-medium">讲解视频生成失败</p>
        <p className="mt-1 break-words text-xs">{message}</p>
      </div>
      {audioSrc ? (
        <div className="space-y-2">
          <p className="text-xs">播客音频已保留，可直接播放。</p>
          <audio
            controls
            preload="metadata"
            src={audioSrc}
            className="w-full"
            aria-label={`${episode.name} 保留的播客音频`}
          />
        </div>
      ) : audioError ? (
        <p className="text-xs">{audioError}</p>
      ) : null}
      {onRetry ? (
        <div className="space-y-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onRetry(episode)}
            disabled={isRetrying}
          >
            <RotateCcw className={cn('mr-2 h-4 w-4', isRetrying && 'animate-spin')} />
            重新生成音频和视频
          </Button>
          <p className="text-[11px]">重新生成会替换当前保留的音频。</p>
        </div>
      ) : null}
    </div>
  )

  const player = videoSrc ? (
    <video
      controls
      preload="metadata"
      src={videoSrc}
      className={cn(
        'w-full bg-black',
        displayMode === 'studio'
          ? 'max-h-full rounded-lg object-contain'
          : 'aspect-video rounded-md object-contain'
      )}
      aria-label={`${episode.name} 讲解视频`}
      onError={() => setVideoError('视频暂不可播放')}
    >
      {subtitleSrc ? (
        <track
          kind="captions"
          src={subtitleSrc}
          srcLang="zh-CN"
          label="中文字幕"
        />
      ) : null}
    </video>
  ) : episode.video_error ? (
    failurePlayer(episode.video_error)
  ) : videoError ? (
    failurePlayer(videoError)
  ) : isActive ? (
    <div className="flex aspect-video items-center justify-center rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
      讲解视频正在生成：脚本、配音、关键画面和 MP4 会依次完成。
    </div>
  ) : isFailed ? (
    failurePlayer(episode.error_message || '讲解视频生成失败')
  ) : (
    <div className="flex aspect-video items-center justify-center rounded-md border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
      视频文件暂不可用。
    </div>
  )

  if (displayMode === 'studio') {
    return (
      <div
        className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-background"
        data-testid="notebook-video-studio"
      >
        <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            返回
          </Button>
          <div className="min-w-0 flex-1 text-center">
            <p className="text-xs tracking-wide text-muted-foreground">讲解视频</p>
            <h3 className="truncate text-base font-semibold">{episode.name}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {onExport ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onExport(episode)}
                disabled={!episode.video_url && !episode.video_file}
              >
                <Download className="mr-2 h-4 w-4" />
                导出 MP4
              </Button>
            ) : null}
            {onDelete ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => onDelete(episode)}
                aria-label="删除讲解视频及配套播客"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </header>
        <main className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/20 p-4">
          <div className="flex h-full w-full items-center justify-center">{player}</div>
        </main>
        {episode.keyframes?.length ? (
          <footer className="border-t px-4 py-2 text-xs text-muted-foreground">
            {episode.keyframes.length} 个关键画面 · 与真实语音时间轴同步
          </footer>
        ) : null}
      </div>
    )
  }

  return (
    <article
      className="space-y-3 rounded-lg border p-3"
      data-testid={`notebook-video-card-${episode.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300">
            <Video className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold">{episode.name}</h3>
              <Badge variant="secondary">讲解视频</Badge>
              <Badge variant="outline">
                {episode.video_error ? '视频失败 · 音频可用' : getStatusLabel(status)}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              配套音频、字幕与 {episode.keyframes?.length ?? 0} 个关键画面
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onOpenStudio ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onOpenStudio(episode)}
              aria-label="全屏播放讲解视频"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          ) : null}
          {onExport ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onExport(episode)}
              disabled={!episode.video_url && !episode.video_file}
              aria-label="导出讲解视频 MP4"
            >
              <Download className="h-4 w-4" />
            </Button>
          ) : null}
          {onDelete ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => onDelete(episode)}
              aria-label="删除讲解视频及配套播客"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>
      {player}
    </article>
  )
}
