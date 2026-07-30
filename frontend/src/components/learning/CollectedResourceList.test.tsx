import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { LearningCollectedResource } from '@/lib/types/learning'
import { CollectedResourceList } from './CollectedResourceList'

const resources: LearningCollectedResource[] = [
  {
    id: 'paper',
    title: 'Attention Is All You Need',
    source_type: 'web',
    query: 'QKV',
    reason: '原始定义',
    url: 'https://arxiv.org/abs/1706.03762',
    provider: 'arXiv',
    quality_score: 0.98,
    content_type: 'paper',
    adoption_status: 'recommended',
  },
  {
    id: 'video',
    title: 'QKV 视频课',
    source_type: 'web',
    query: 'QKV',
    reason: '动画讲解',
    url: 'https://example.com/video',
    provider: 'Video',
    resource_kind: 'video_lecture',
    content_type: 'video',
    adoption_status: 'recommended',
  },
]

describe('CollectedResourceList', () => {
  it('keeps source links and adoption controls interactive for cached data', () => {
    const onAccept = vi.fn()
    render(<CollectedResourceList resources={resources} onAccept={onAccept} />)

    expect(screen.getByRole('link', { name: 'Attention Is All You Need' })).toHaveAttribute(
      'href',
      'https://arxiv.org/abs/1706.03762'
    )
    expect(screen.getByRole('link', { name: '播放资料：QKV 视频课' })).toHaveAttribute(
      'href',
      'https://example.com/video'
    )

    fireEvent.click(screen.getByRole('button', { name: '采纳资料：Attention Is All You Need' }))
    expect(onAccept).toHaveBeenCalledWith(resources[0])
  })

  it('shows accepted and pending states from the same controlled props used by live search', () => {
    render(
      <CollectedResourceList
        resources={resources}
        acceptedResourceUrls={{ 'https://arxiv.org/abs/1706.03762': true }}
        acceptingResourceIds={{ video: true }}
        onAccept={vi.fn()}
      />
    )

    expect(
      screen.getByRole('button', { name: '已采纳资料：Attention Is All You Need' })
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: '采纳资料：QKV 视频课' })).toBeDisabled()
  })
})
