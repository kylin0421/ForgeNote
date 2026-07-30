import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { PodcastEpisode } from '@/lib/types/podcasts'
import {
  NotebookPodcastAssetCard,
  shouldShowNoteInStudio,
  shouldShowPodcastEpisodeInStudio,
} from './NotesColumn'

function buildEpisode(patch: Partial<PodcastEpisode> = {}): PodcastEpisode {
  return {
    id: 'episode:podcast-failed',
    name: '注意力机制播客',
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
    notebook_id: 'notebook:test',
    job_status: 'failed',
    error_message: 'TTS 服务暂不可用',
    audio_file: null,
    audio_url: null,
    video_requested: false,
    ...patch,
  }
}

describe('NotesColumn Studio visibility', () => {
  it('keeps ordinary text notes while assessment remains in its dedicated section', () => {
    expect(
      shouldShowNoteInStudio({
        title: '我的课堂笔记',
        content: 'Q、K、V 分别负责检索、匹配和被聚合的信息。',
      })
    ).toBe(true)

    expect(
      shouldShowNoteInStudio({
        title: '[学习效果评估] Transformer 掌握度评估',
        content: '根据练习记录更新掌握度与下一步策略。',
      })
    ).toBe(false)
  })

  it('keeps failed audio-only podcasts visible without weakening video visibility', () => {
    expect(shouldShowPodcastEpisodeInStudio(buildEpisode())).toBe(true)
    expect(
      shouldShowPodcastEpisodeInStudio(
        buildEpisode({
          job_status: 'running',
          error_message: null,
        })
      )
    ).toBe(false)
    expect(
      shouldShowPodcastEpisodeInStudio(
        buildEpisode({
          job_status: 'running',
          video_requested: true,
        })
      )
    ).toBe(true)
  })

  it('renders a retry action for an audio-only podcast failure', () => {
    const onRetry = vi.fn()
    const episode = buildEpisode()

    render(
      <NotebookPodcastAssetCard
        episode={episode}
        onRetry={onRetry}
      />
    )

    expect(screen.getByText('TTS 服务暂不可用')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '重试生成播客' }))
    expect(onRetry).toHaveBeenCalledWith(episode)
  })
})
