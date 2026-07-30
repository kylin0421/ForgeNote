import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { PodcastEpisode } from '@/lib/types/podcasts'
import {
  isExplainerVideoEpisode,
  NotebookVideoAssetCard,
} from './NotebookVideoAssetCard'

const resolvePodcastAssetUrl = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api/podcasts', () => ({
  resolvePodcastAssetUrl,
}))

function buildEpisode(patch: Partial<PodcastEpisode> = {}): PodcastEpisode {
  return {
    id: 'episode:video-test',
    name: '注意力机制讲解',
    episode_profile: {
      id: 'episode_profile:test',
      name: 'study',
      description: '',
      speaker_config: 'solo',
      default_briefing: '',
      num_segments: 4,
    },
    speaker_profile: {
      id: 'speaker_profile:test',
      name: 'solo',
      description: '',
      speakers: [],
    },
    briefing: '',
    job_status: 'completed',
    video_requested: true,
    video_file: 'C:/ForgeNote/explainer-video.mp4',
    video_subtitle_url: '/api/podcasts/episodes/video-test/video/subtitles',
    keyframes: [
      {
        index: 1,
        turn_index: 0,
        time_index: 0,
        prompt: 'attention overview',
      },
    ],
    ...patch,
  }
}

describe('NotebookVideoAssetCard', () => {
  beforeEach(() => {
    resolvePodcastAssetUrl.mockReset()
    resolvePodcastAssetUrl.mockImplementation(async (value: string) => (
      value.includes('subtitles')
        ? 'http://127.0.0.1:5055/video.vtt'
        : 'http://127.0.0.1:5055/video.mp4'
    ))
  })

  it('renders a real interactive video player and asset actions', async () => {
    const onOpenStudio = vi.fn()
    const onExport = vi.fn()
    const episode = buildEpisode()

    render(
      <NotebookVideoAssetCard
        episode={episode}
        onOpenStudio={onOpenStudio}
        onExport={onExport}
      />
    )

    const player = await screen.findByLabelText('注意力机制讲解 讲解视频')
    expect(player).toBeInstanceOf(HTMLVideoElement)
    expect(player).toHaveAttribute('controls')
    expect(player).toHaveAttribute('src', 'http://127.0.0.1:5055/video.mp4')
    await waitFor(() => {
      const captions = player.querySelector('track[kind="captions"]')
      expect(captions).toHaveAttribute('src', 'http://127.0.0.1:5055/video.vtt')
      expect(captions).toHaveAttribute('srclang', 'zh-CN')
      expect(captions).not.toHaveAttribute('default')
    })
    expect(screen.getByText('1 个关键画面', { exact: false })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '全屏播放讲解视频' }))
    fireEvent.click(screen.getByRole('button', { name: '导出讲解视频 MP4' }))

    expect(onOpenStudio).toHaveBeenCalledWith(episode)
    expect(onExport).toHaveBeenCalledWith(episode)
  })

  it('shows generation progress before the cached MP4 is ready', () => {
    render(
      <NotebookVideoAssetCard
        episode={buildEpisode({
          job_status: 'running',
          video_file: null,
          keyframes: null,
        })}
      />
    )

    expect(screen.getByText('讲解视频正在生成：脚本、配音、关键画面和 MP4 会依次完成。')).toBeInTheDocument()
  })

  it('recognizes requested, completed, and failed explainer video episodes', () => {
    expect(isExplainerVideoEpisode(buildEpisode())).toBe(true)
    expect(
      isExplainerVideoEpisode(buildEpisode({
        video_requested: false,
        video_file: null,
        keyframes: null,
        video_error: 'ffmpeg failed',
      }))
    ).toBe(true)
    expect(
      isExplainerVideoEpisode(buildEpisode({
        video_requested: false,
        video_file: null,
        video_url: null,
        keyframes: null,
        video_error: null,
      }))
    ).toBe(false)
  })

  it('keeps completed podcast audio playable when only video generation fails', async () => {
    const onRetry = vi.fn()
    resolvePodcastAssetUrl.mockImplementation(async (value: string) => (
      value.includes('audio')
        ? 'http://127.0.0.1:5055/retained-audio.mp3'
        : value
    ))
    const episode = buildEpisode({
      video_file: null,
      video_url: null,
      video_error: '视频合成失败',
      audio_file: 'C:/ForgeNote/retained-audio.mp3',
    })

    render(<NotebookVideoAssetCard episode={episode} onRetry={onRetry} />)

    const audio = await screen.findByLabelText('注意力机制讲解 保留的播客音频')
    expect(audio).toBeInstanceOf(HTMLAudioElement)
    expect(audio).toHaveAttribute('controls')
    expect(audio).toHaveAttribute(
      'src',
      'http://127.0.0.1:5055/retained-audio.mp3'
    )
    expect(screen.getByText('播客音频已保留，可直接播放。')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '重新生成音频和视频' }))
    expect(onRetry).toHaveBeenCalledWith(episode)
  })
})
