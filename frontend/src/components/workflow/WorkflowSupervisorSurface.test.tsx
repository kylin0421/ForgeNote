import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { CommandJob } from '@/lib/api/commands'
import { WorkflowSupervisorSurface } from './WorkflowSupervisorSurface'

const NOW = Date.parse('2026-07-30T10:00:20.000Z')

const jobs: CommandJob[] = [
  {
    job_id: 'command:running-demo',
    command: 'collect_learning_resources',
    status: 'running',
    target: { goal: '理解注意力机制' },
    created: '2026-07-30T10:00:00.000Z',
    updated: '2026-07-30T10:00:12.000Z',
    progress: {
      percent: 50,
      current_agent_id: 'collector-agent',
      current_task: '并行检索论文与教学视频',
      steps: [
        {
          id: 'profile-agent',
          name: '学习画像智能体',
          role: '读取学习目标',
          status: 'completed',
          duration_seconds: 3,
        },
        {
          id: 'collector-agent',
          name: '资源搜集智能体',
          role: '检索可信来源',
          status: 'running',
          started_at: '2026-07-30T10:00:10.000Z',
        },
      ],
    },
  },
  {
    job_id: 'command:completed-demo',
    command: 'generate_learning_asset',
    status: 'completed',
    target: { goal: '生成交互式学习资产' },
    created: '2026-07-30T09:58:00.000Z',
    updated: '2026-07-30T09:58:15.000Z',
    result_summary: { processing_time: 15 },
  },
]

describe('WorkflowSupervisorSurface', () => {
  it('renders cached jobs with the same filtering and timing UI as production', () => {
    render(
      <WorkflowSupervisorSurface
        jobs={jobs}
        nowMs={NOW}
        refreshLabel="演示缓存"
      />
    )

    expect(screen.getByText('Multi-Agent 工作流监督台')).toBeInTheDocument()
    expect(screen.getByText('演示缓存')).toBeInTheDocument()
    expect(screen.getAllByText('并行检索论文与教学视频').length).toBeGreaterThan(0)
    expect(screen.getByText('本步已运行 10 秒')).toBeInTheDocument()
    expect(screen.getByText('耗时 3 秒')).toBeInTheDocument()
    expect(screen.queryByText('耗时 20 秒')).not.toBeInTheDocument()
    expect(screen.queryByText('生成交互式学习资产')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '完成' }))

    expect(screen.getAllByText('生成交互式学习资产').length).toBeGreaterThan(0)
    expect(screen.queryByText('理解注意力机制')).not.toBeInTheDocument()
    expect(screen.getAllByText('无步骤遥测').length).toBeGreaterThan(0)
    expect(screen.getByText('后台任务状态')).toBeInTheDocument()
    expect(
      screen.getByText('该任务未上报步骤级遥测；这里只反映任务整体状态，不代表多 Agent 执行记录。')
    ).toBeInTheDocument()
    expect(screen.getByText('耗时 未记录')).toBeInTheDocument()
    expect(screen.queryByText('资源生成智能体')).not.toBeInTheDocument()
  })

  it('shows queue wait separately and keeps every queued step unstarted', () => {
    render(
      <WorkflowSupervisorSurface
        jobs={[
          {
            job_id: 'command:queued-demo',
            command: 'generate_podcast',
            status: 'queued',
            target: { episode_name: '注意力机制播客' },
            created: '2026-07-30T10:00:00.000Z',
            updated: '2026-07-30T10:00:00.000Z',
          },
        ]}
        nowMs={NOW}
      />
    )

    expect(screen.getAllByText('已等待 20 秒').length).toBeGreaterThan(0)
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('待运行')).toBeInTheDocument()
    expect(screen.getAllByText('无步骤遥测').length).toBeGreaterThan(0)
    expect(screen.queryByText('已运行 20 秒')).not.toBeInTheDocument()
  })

  it('maps the active step to canceled and keeps its local elapsed value', () => {
    render(
      <WorkflowSupervisorSurface
        jobs={[
          {
            job_id: 'command:canceled-demo',
            command: 'generate_learning_asset',
            status: 'canceled',
            target: { goal: '生成讲解' },
            created: '2026-07-30T10:00:00.000Z',
            updated: '2026-07-30T10:00:09.000Z',
            progress: {
              percent: 46,
              current_agent_id: 'resource-agent',
              current_task: '仍在生成旧文案',
              steps: [
                {
                  id: 'resource-agent',
                  name: '资源生成智能体',
                  role: '生成讲解',
                  status: 'running',
                  started_at: '2026-07-30T10:00:01.000Z',
                  elapsed_seconds: 4,
                },
              ],
            },
          },
        ]}
        initialFilter="all"
        nowMs={NOW}
      />
    )

    expect(screen.getAllByText('已取消').length).toBeGreaterThan(0)
    expect(screen.getByText('耗时 4 秒')).toBeInTheDocument()
    expect(
      screen.getAllByText('任务已取消，未执行的步骤不会继续运行').length
    ).toBeGreaterThan(0)
    expect(screen.queryByText('已运行 19 秒')).not.toBeInTheDocument()
  })

  it('freezes a failed running step at the job update time', () => {
    render(
      <WorkflowSupervisorSurface
        jobs={[
          {
            job_id: 'command:failed-demo',
            command: 'collect_learning_resources',
            status: 'failed',
            target: { goal: '检索资料' },
            created: '2026-07-30T10:00:00.000Z',
            updated: '2026-07-30T10:00:08.000Z',
            error_message: '上游服务失败',
            progress: {
              percent: 35,
              current_agent_id: 'collector-agent',
              steps: [
                {
                  id: 'collector-agent',
                  name: '资源搜集智能体',
                  role: '检索可信来源',
                  status: 'running',
                  started_at: '2026-07-30T10:00:02.000Z',
                },
              ],
            },
          },
        ]}
        initialFilter="failed"
        nowMs={NOW}
      />
    )

    expect(screen.getAllByText('失败').length).toBeGreaterThan(0)
    expect(screen.getByText('耗时 6 秒')).toBeInTheDocument()
    expect(screen.queryByText('已运行 18 秒')).not.toBeInTheDocument()
  })
})
