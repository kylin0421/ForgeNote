'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { BookMarked, Brain, FileText, MessageSquare, StickyNote, TrendingUp } from 'lucide-react'

import { AppShell } from '@/components/layout/AppShell'
import { serializeLearningAssetNote } from '@/components/learning/LearningAssetPreview'
import {
  ProfileOnboardingDialog,
  type CachedProfileOnboardingState,
} from '@/components/learning/ProfileOnboardingDialog'
import { NotebookProfileBanner } from '@/components/notebooks/NotebookProfileBanner'
import { NotebookDesktopLayout } from '@/components/notebooks/NotebookDesktopLayout'
import { CreateNotebookDialog } from '@/components/notebooks/CreateNotebookDialog'
import { WorkflowSupervisorSurface } from '@/components/workflow/WorkflowSupervisorSurface'
import { NotebookChatSurface } from '@/app/(dashboard)/notebooks/components/ChatColumn'
import { SourcesColumn } from '@/app/(dashboard)/notebooks/components/SourcesColumn'
import { NotesColumn } from '@/app/(dashboard)/notebooks/components/NotesColumn'
import { LearningCurveDialog } from '@/app/(dashboard)/notebooks/components/LearningCurveDialog'
import { MistakeBookDialog } from '@/app/(dashboard)/notebooks/components/MistakeBookDialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useIsDesktop } from '@/lib/hooks/use-media-query'
import type { CommandJob } from '@/lib/api/commands'
import {
  AI_LEARNING_DEMO,
  AI_LEARNING_DEMO_COLLECTED_RESOURCES,
  AI_LEARNING_DEMO_MEDIA,
  AI_LEARNING_DEMO_RESOURCES,
  AI_LEARNING_DEMO_STEPS,
  AI_LEARNING_DEMO_TOTAL_STEPS,
  defaultDemoStepForPath,
  demoStepHref,
} from '@/lib/demo/ai-learning-demo'
import type {
  BaseChatSession,
  NotebookResponse,
  NoteResponse,
  SourceChatMessage,
  SourceListResponse,
} from '@/lib/types/api'
import type {
  LearningCollectedResource,
  LearningProfileInterviewDimension,
  LearningProfileInterviewQuestion,
  LearningProfileInterviewResponse,
} from '@/lib/types/learning'
import type { PodcastEpisode } from '@/lib/types/podcasts'

const DEMO_NOTEBOOK: NotebookResponse = {
  id: 'notebook:ai-learning-demo',
  name: AI_LEARNING_DEMO.notebookName,
  description: AI_LEARNING_DEMO.topic,
  archived: false,
  created: '2026-07-30T10:00:00.000Z',
  updated: '2026-07-30T10:00:00.000Z',
  source_count: 0,
  note_count: 0,
}

const DEMO_CHAT_SESSION: BaseChatSession = {
  id: 'chat-session:ai-learning-demo',
  title: '注意力机制学习',
  created: '2026-07-30T10:00:00.000Z',
  updated: '2026-07-30T10:00:00.000Z',
  message_count: 0,
  model_override: null,
}

const DEMO_ACCEPTED_SOURCES: SourceListResponse[] =
  AI_LEARNING_DEMO_COLLECTED_RESOURCES.map((resource, index) => ({
    id: `source:ai-learning-demo-${index + 1}`,
    title: resource.title,
    topics: resource.tags,
    asset: resource.url ? { url: resource.url } : null,
    embedded: false,
    embedded_chunks: 0,
    insights_count: 0,
    created: '2026-07-30T10:00:00.000Z',
    updated: '2026-07-30T10:00:00.000Z',
    file_available: true,
    status: 'completed',
  }))

const DEMO_ASSET_NOTES: NoteResponse[] = (
  [
    ['blog', AI_LEARNING_DEMO_RESOURCES.blog],
    ['mind-map', AI_LEARNING_DEMO_RESOURCES['mind-map']],
    ['quiz', AI_LEARNING_DEMO_RESOURCES.quiz],
    ['visual-aid', AI_LEARNING_DEMO_RESOURCES['visual-aid']],
  ] as const
).map(([id, resource], index) => ({
  id: `note:ai-learning-demo-${id}`,
  title: resource.title,
  content: serializeLearningAssetNote(resource),
  note_type: 'ai',
  created: `2026-07-30T10:00:${20 + index}.000Z`,
  updated: `2026-07-30T10:00:${20 + index}.000Z`,
}))

const DEMO_ACCEPTED_RESOURCE_URLS = Object.fromEntries(
  AI_LEARNING_DEMO_COLLECTED_RESOURCES.flatMap((resource) =>
    resource.url ? [[resource.url, true] as const] : []
  )
)

const DEMO_PROFILE_QUESTION: LearningProfileInterviewQuestion = {
  id: 'knowledge-and-style',
  dimension: 'knowledge',
  eyebrow: '从你的基础开始',
  prompt: AI_LEARNING_DEMO.profileQuestion,
  helper: '可以说说学过的课程、做过的项目，以及你希望看到的例子。',
  suggestions: ['会 Python', '学过基础神经网络', '喜欢图解和可运行代码'],
}

const DEMO_PROFILE_DIMENSIONS: LearningProfileInterviewDimension[] = [
  {
    key: 'major',
    label: '专业方向',
    value: '计算机科学 / 人工智能',
    evidence: '正在学习神经网络与 Transformer',
    confidence: 0.91,
  },
  {
    key: 'goal',
    label: '学习目标',
    value: '理解并实现注意力机制',
    evidence: '希望从直觉过渡到可运行代码',
    confidence: 0.94,
  },
  {
    key: 'knowledge',
    label: '知识基础',
    value: '会 Python，掌握基础神经网络',
    evidence: '已明确说明当前先修知识',
    confidence: 0.96,
  },
  {
    key: 'learning_history',
    label: '学习经历',
    value: '学过机器学习入门内容',
    evidence: '能理解权重和基础张量概念',
    confidence: 0.84,
  },
  {
    key: 'cognitive_style',
    label: '认知风格',
    value: '图解、类比与代码验证',
    evidence: '主动选择直观解释和可运行示例',
    confidence: 0.97,
  },
  {
    key: 'mistakes',
    label: '当前瓶颈',
    value: 'Q、K、V 的分工与张量关系',
    evidence: '知道分配权重，但不清楚三者设计',
    confidence: 0.93,
  },
  {
    key: 'pace',
    label: '学习节奏',
    value: '短路径、边学边练',
    evidence: '希望讲解后立即通过代码验证',
    confidence: 0.82,
  },
  {
    key: 'resource_preference',
    label: '资源偏好',
    value: '图解教程、权威论文、可运行代码',
    evidence: '明确偏好图解、类比和实践',
    confidence: 0.95,
  },
]

const DEMO_PROFILE_INITIAL_INTERVIEW: LearningProfileInterviewResponse = {
  assistant_message: '我先从你的现有基础和理解偏好开始。',
  question: DEMO_PROFILE_QUESTION,
  profile: DEMO_PROFILE_DIMENSIONS.map((dimension) => ({
    ...dimension,
    value: '',
    evidence: '',
    confidence: 0,
  })),
  covered_dimensions: [],
  missing_dimensions: DEMO_PROFILE_DIMENSIONS.map((dimension) => dimension.key),
  complete: false,
  progress: 8,
  search_goal: AI_LEARNING_DEMO.searchQuery,
}

const DEMO_PROFILE_COMPLETE_INTERVIEW: LearningProfileInterviewResponse = {
  assistant_message: '信息已经足够具体，我会优先使用图解和类比，再用代码验证关键张量关系。',
  question: null,
  profile: DEMO_PROFILE_DIMENSIONS,
  covered_dimensions: DEMO_PROFILE_DIMENSIONS.map((dimension) => dimension.key),
  missing_dimensions: [],
  complete: true,
  progress: 100,
  search_goal: AI_LEARNING_DEMO.searchQuery,
}

function demoProfileSource(withQuizEvidence: boolean) {
  const recentSignals = [
    '2026-07-30 10:00:06Z [chat_message] 主动追问 Q、K、V 的分工与张量关系。',
    '2026-07-30 10:00:12Z [source_accept] 采纳原论文、图解教程、官方文档与视频讲解。',
    ...(withQuizEvidence
      ? ['2026-07-30 10:00:28Z [quiz_answer] correct; 已理解 Key 相似度会提高对应 Value 的输出权重。']
      : []),
  ]
  return {
    source_id: 'source:ai-learning-demo-profile',
    title: '学习画像',
    content: [
      '稳定画像',
      '专业背景：计算机科学 / 人工智能；正在学习神经网络与 Transformer。',
      '知识基础：会 Python，掌握基础神经网络与张量概念。',
      '学习目标：理解并实现注意力机制，重点厘清 Q、K、V 的分工与张量关系。',
      '认知风格：优先图解、生活类比，再用公式与可运行代码验证。',
      '学习节奏：短路径、边学边练、即时反馈。',
      withQuizEvidence
        ? '易错点：已掌握相似度与 Value 权重的关系；下一步需要巩固多头注意力中的形状变换。'
        : '易错点：Q、K、V 的分工与张量关系仍需通过例题验证。',
      '资源偏好：权威论文、官方文档、图解教程、短视频与可运行代码。',
      '学习动机：希望把注意力机制用于实际项目。',
      '',
      '最近学习信号',
      ...recentSignals,
    ].join('\n'),
    updated: withQuizEvidence
      ? '2026-07-30T10:00:28.000Z'
      : '2026-07-30T10:00:12.000Z',
    updated_profile: withQuizEvidence,
  }
}

function NotebookScene({
  step,
  onProfileCompleted,
  onStepRequested,
  onExit,
}: {
  step: number
  onProfileCompleted: () => void
  onStepRequested: (step: number) => void
  onExit: () => void
}) {
  const [demoNotebook, setDemoNotebook] = useState(DEMO_NOTEBOOK)
  const [createDialogOpen, setCreateDialogOpen] = useState(true)
  const [chatSessions, setChatSessions] = useState<BaseChatSession[]>([DEMO_CHAT_SESSION])
  const [currentChatSessionId, setCurrentChatSessionId] = useState(DEMO_CHAT_SESSION.id)
  const [chatModelOverride, setChatModelOverride] = useState<string | undefined>()
  const [savedChatNotes, setSavedChatNotes] = useState<NoteResponse[]>([])
  const cachedMessages = useMemo<SourceChatMessage[]>(() => {
    const messages: SourceChatMessage[] = []
    if (step >= 4) {
      messages.push({
        id: 'demo-learning-question',
        type: 'human',
        content: AI_LEARNING_DEMO.userQuestion,
      })
    }
    if (step >= 5) {
      messages.push({
        id: 'demo-learning-answer',
        type: 'ai',
        content: `**已按你的画像调整讲解**\n\n${AI_LEARNING_DEMO.assistantAnswer}`,
      })
    }
    return messages
  }, [step])
  const [interactiveMessages, setInteractiveMessages] = useState<SourceChatMessage[]>([])
  const [acceptedResourceUrls, setAcceptedResourceUrls] = useState<Record<string, boolean>>({})
  const [profileOpenSignal, setProfileOpenSignal] = useState(0)
  const [learningCurveOpen, setLearningCurveOpen] = useState(false)
  const [mistakeBookOpen, setMistakeBookOpen] = useState(false)
  const [sourcesCollapsed, setSourcesCollapsed] = useState(false)
  const [notesCollapsed, setNotesCollapsed] = useState(false)
  const isDesktop = useIsDesktop()
  const [mobileActiveTab, setMobileActiveTab] = useState<'sources' | 'chat' | 'notes'>('sources')
  const podcastEpisode = useDemoMediaEpisode('podcast')
  const videoEpisode = useDemoMediaEpisode('video')
  const runningVideoEpisode = useMemo<PodcastEpisode>(
    () => ({
      ...videoEpisode,
      job_status: 'running',
      video_file: null,
      video_subtitle_url: null,
    }),
    [videoEpisode]
  )

  const handleCachedMessage = (message: string) => {
    setInteractiveMessages((current) => {
      const turn = current.length
      return [
        ...current,
        {
          id: `demo-follow-up-human-${turn}`,
          type: 'human',
          content: message,
        },
        {
          id: `demo-follow-up-ai-${turn}`,
          type: 'ai',
          content: '我会继续沿用当前学习画像，并优先引用已经检索到的权威资料来回答。',
        },
      ]
    })
  }

  const createCachedSession = (title: string) => {
    const id = `chat-session:ai-learning-demo-${chatSessions.length + 1}`
    const created = '2026-07-30T10:00:30.000Z'
    setChatSessions((current) => [
      ...current,
      {
        id,
        title,
        created,
        updated: created,
        message_count: 0,
        model_override: chatModelOverride ?? null,
      },
    ])
    setCurrentChatSessionId(id)
  }

  const deleteCachedSession = (sessionId: string) => {
    setChatSessions((current) => {
      const next = current.filter((session) => session.id !== sessionId)
      if (currentChatSessionId === sessionId) {
        setCurrentChatSessionId(next[0]?.id ?? '')
      }
      return next
    })
  }

  const cachedProfileState = useMemo<CachedProfileOnboardingState>(() => {
    if (step === 1) {
      return {
        turns: [],
        interview: DEMO_PROFILE_INITIAL_INTERVIEW,
        initialInterview: DEMO_PROFILE_INITIAL_INTERVIEW,
        nextInterview: DEMO_PROFILE_COMPLETE_INTERVIEW,
      }
    }
    return {
      turns: [
        {
          question: DEMO_PROFILE_QUESTION,
          answer: AI_LEARNING_DEMO.profileAnswer,
        },
      ],
      interview: DEMO_PROFILE_COMPLETE_INTERVIEW,
      initialInterview: DEMO_PROFILE_INITIAL_INTERVIEW,
    }
  }, [step])

  const demoSources = step >= 8 ? DEMO_ACCEPTED_SOURCES : []
  const demoNotes = [
    ...(step >= 12 ? DEMO_ASSET_NOTES : []),
    ...savedChatNotes,
  ]
  const demoEpisodes =
    step === 12
      ? [podcastEpisode, runningVideoEpisode]
      : step >= 13
        ? [podcastEpisode, videoEpisode]
        : []
  const effectiveAcceptedResourceUrls = useMemo(
    () =>
      step >= 8
        ? { ...DEMO_ACCEPTED_RESOURCE_URLS, ...acceptedResourceUrls }
        : acceptedResourceUrls,
    [acceptedResourceUrls, step]
  )
  const cachedResourceSearch = useMemo(
    () => ({
      expanded: step >= 6,
      goal: AI_LEARNING_DEMO.searchQuery,
      status: step === 7 ? ('running' as const) : step >= 8 ? ('completed' as const) : ('idle' as const),
      resources: step >= 8 ? AI_LEARNING_DEMO_COLLECTED_RESOURCES : [],
      acceptedResourceUrls: effectiveAcceptedResourceUrls,
      profileSource: demoProfileSource(step >= 15),
      onCollect: () => onStepRequested(7),
      onAccept: (resource: LearningCollectedResource) => {
        if (!resource.url) return
        setAcceptedResourceUrls((current) => ({
          ...current,
          [resource.url as string]: true,
        }))
      },
    }),
    [effectiveAcceptedResourceUrls, onStepRequested, step]
  )

  useEffect(() => {
    if (step >= 15) {
      setProfileOpenSignal((current) => current + 1)
    }
  }, [step])

  useEffect(() => {
    if (isDesktop) return
    if (step >= 12) {
      setMobileActiveTab('notes')
    } else if (step >= 6) {
      setMobileActiveTab('sources')
    } else if (step >= 4) {
      setMobileActiveTab('chat')
    } else {
      setMobileActiveTab('sources')
    }
  }, [isDesktop, step])

  useEffect(() => {
    const openProfile = () => {
      setProfileOpenSignal((current) => current + 1)
    }
    const openLearningCurve = () => setLearningCurveOpen(true)
    const openMistakeBook = () => setMistakeBookOpen(true)
    window.addEventListener('ai-learning-demo:open-profile', openProfile)
    window.addEventListener('ai-learning-demo:open-learning-curve', openLearningCurve)
    window.addEventListener('ai-learning-demo:open-mistake-book', openMistakeBook)
    return () => {
      window.removeEventListener('ai-learning-demo:open-profile', openProfile)
      window.removeEventListener('ai-learning-demo:open-learning-curve', openLearningCurve)
      window.removeEventListener('ai-learning-demo:open-mistake-book', openMistakeBook)
    }
  }, [])

  if (step === 0) {
    return (
      <>
        <div className="min-h-0 flex-1 bg-muted/10" />
        <CreateNotebookDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          createOverride={(data) => ({
            ...DEMO_NOTEBOOK,
            name: data.name,
            description: data.description ?? '',
          })}
          initialValues={{
            name: DEMO_NOTEBOOK.name,
            description: DEMO_NOTEBOOK.description,
          }}
          preventAutoFocus
          onCanceled={onExit}
          onCreated={(created) => {
            setDemoNotebook(created)
            onStepRequested(1)
          }}
        />
      </>
    )
  }

  if (step < 3) {
    return (
      <>
        <div className="min-h-0 flex-1 bg-muted/10" />
        <ProfileOnboardingDialog
          open
          notebook={demoNotebook}
          cachedState={cachedProfileState}
          onCompleted={onProfileCompleted}
        />
      </>
    )
  }

  const chatSurface = (
    <div className="flex min-h-0 min-w-0 flex-1" data-testid="demo-production-chat">
      <NotebookChatSurface
        messages={[...cachedMessages, ...interactiveMessages]}
        isStreaming={false}
        contextIndicators={null}
        onSendMessage={handleCachedMessage}
        modelOverride={chatModelOverride}
        onModelChange={setChatModelOverride}
        sessions={chatSessions}
        currentSessionId={currentChatSessionId}
        onCreateSession={createCachedSession}
        onSelectSession={setCurrentChatSessionId}
        onUpdateSession={(sessionId, title) => {
          setChatSessions((current) =>
            current.map((session) =>
              session.id === sessionId
                ? { ...session, title, updated: '2026-07-30T10:00:30.000Z' }
                : session
            )
          )
        }}
        onDeleteSession={deleteCachedSession}
        loadingSessions={false}
        notebookContextStats={{
          sourcesInsights: 0,
          sourcesFull: demoSources.length,
          notesCount: demoNotes.length,
        }}
        onSaveMessageToNote={(content) => {
          setSavedChatNotes((current) => {
            const created = '2026-07-30T10:00:31.000Z'
            return [
              ...current,
              {
                id: `note:ai-learning-demo-chat-${current.length + 1}`,
                title: '来自对话的笔记',
                content,
                note_type: 'ai',
                created,
                updated: created,
              },
            ]
          })
        }}
        inputAriaLabel="学习记录输入框"
      />
    </div>
  )
  const sourcesSurface = (
    <SourcesColumn
      sources={demoSources}
      isLoading={false}
      notebookId={demoNotebook.id}
      notebookName={demoNotebook.name}
      contextSelections={Object.fromEntries(
        demoSources.map((source) => [source.id, 'full' as const])
      )}
      cachedResourceSearch={cachedResourceSearch}
      profileOpenSignal={profileOpenSignal}
      forceExpanded={!isDesktop}
      isCollapsed={sourcesCollapsed}
      onToggleCollapse={() => setSourcesCollapsed((current) => !current)}
    />
  )
  const notesSurface = (
    <NotesColumn
      notes={demoNotes}
      isLoading={false}
      notebookId={demoNotebook.id}
      notebookName={demoNotebook.name}
      sources={demoSources}
      forceExpanded={!isDesktop}
      isCollapsed={notesCollapsed}
      onToggleCollapse={() => setNotesCollapsed((current) => !current)}
      cachedStudioState={{
        episodes: demoEpisodes,
        isGenerating: step === 12,
        openNoteId:
          step === 14
            ? 'note:ai-learning-demo-quiz'
            : null,
      }}
    />
  )

  return (
    <>
      <LearningCurveDialog
        open={learningCurveOpen}
        onOpenChange={setLearningCurveOpen}
        notebookId={demoNotebook.id}
        sources={demoSources}
        notes={demoNotes}
        profileContent={demoProfileSource(step >= 15).content}
      />
      <MistakeBookDialog
        open={mistakeBookOpen}
        onOpenChange={setMistakeBookOpen}
        notebookId={demoNotebook.id}
        notebookName={demoNotebook.name}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3 lg:p-4">
        <NotebookProfileBanner
          sourceCount={demoSources.length}
          assetCount={demoNotes.length + demoEpisodes.length}
          onClick={() => setProfileOpenSignal((current) => current + 1)}
          className="mb-3"
        />
        {isDesktop ? (
          <NotebookDesktopLayout
            sourcesCollapsed={sourcesCollapsed}
            notesCollapsed={notesCollapsed}
            chat={chatSurface}
            sources={sourcesSurface}
            notes={notesSurface}
          />
        ) : (
          <Tabs
            value={mobileActiveTab}
            onValueChange={(value) =>
              setMobileActiveTab(value as 'sources' | 'chat' | 'notes')
            }
            className="min-h-0 flex-1 gap-0 xl:hidden"
          >
            <TabsList className="mb-3 grid h-11 w-full shrink-0 grid-cols-3 rounded-xl border bg-background/90 p-1 shadow-sm">
              <TabsTrigger value="sources" className="gap-2">
                <FileText className="h-4 w-4" />
                学习资料
              </TabsTrigger>
              <TabsTrigger value="chat" className="gap-2">
                <MessageSquare className="h-4 w-4" />
                对话
              </TabsTrigger>
              <TabsTrigger value="notes" className="gap-2">
                <StickyNote className="h-4 w-4" />
                Studio
              </TabsTrigger>
            </TabsList>
            <TabsContent
              value="sources"
              className="mt-0 flex min-h-0 overflow-hidden"
            >
              {sourcesSurface}
            </TabsContent>
            <TabsContent
              value="chat"
              className="mt-0 flex min-h-0 overflow-hidden"
            >
              {chatSurface}
            </TabsContent>
            <TabsContent
              value="notes"
              className="mt-0 flex min-h-0 overflow-hidden"
            >
              {notesSurface}
            </TabsContent>
          </Tabs>
        )}
      </div>
    </>
  )
}

const DEMO_WORKFLOW_STARTED_AT = '2026-07-30T10:00:00.000Z'

function demoWorkflowJob(step: number): CommandJob {
  const complete = step >= 11
  const runningAgentIndex = step >= 10 ? 2 : 1
  const durations = AI_LEARNING_DEMO.workflowAgents.map((agent) =>
    Number.parseFloat(agent.duration)
  )
  const totalDuration = durations.reduce((sum, duration) => sum + duration, 0)
  const completedDuration = durations
    .slice(0, complete ? durations.length : runningAgentIndex)
    .reduce((sum, duration) => sum + duration, 0)
  const runningElapsed = complete
    ? 0
    : step >= 10
      ? 0.7
      : Math.min(durations[runningAgentIndex], 1.2)
  const elapsed = complete ? totalDuration : completedDuration + runningElapsed
  const progress = Math.round((elapsed / totalDuration) * 100)
  const timestampAt = (offsetSeconds: number) =>
    new Date(Date.parse(DEMO_WORKFLOW_STARTED_AT) + offsetSeconds * 1000).toISOString()
  const completedAt = complete ? timestampAt(totalDuration) : null
  const currentAgent = complete
    ? null
    : AI_LEARNING_DEMO.workflowAgents[runningAgentIndex]

  return {
    job_id: 'command:qkv-learning-assets-20260730',
    app: 'forgenote',
    command: 'generate_learning_asset',
    status: complete ? 'completed' : 'running',
    target: {
      learning_record_id: 'ai-learning-demo',
      goal: '用图解、类比和代码讲清 Transformer 的 Q、K、V，并生成多模态学习资产',
      output_kind: 'study_guide',
    },
    result_summary: complete
      ? {
          result_success: true,
          processing_time: 12.6,
          result_title: AI_LEARNING_DEMO_RESOURCES.blog.title,
        }
      : undefined,
    progress: {
      workflow: 'learning_asset_generation',
      mode: 'generate',
      percent: progress,
      current_agent_id: currentAgent?.id ?? null,
      current_agent_name: currentAgent?.name ?? null,
      current_task: complete
        ? '所有智能体已完成协作，结果已写入学习记录'
        : currentAgent?.role,
      workflow_started_at: DEMO_WORKFLOW_STARTED_AT,
      workflow_completed_at: completedAt,
      duration_seconds: complete ? elapsed : null,
      elapsed_seconds: elapsed,
      updated_at: completedAt ?? timestampAt(elapsed),
      steps: AI_LEARNING_DEMO.workflowAgents.map((agent, index) => {
        const status = complete
          ? 'completed'
          : index < runningAgentIndex
            ? 'completed'
            : index === runningAgentIndex
              ? 'running'
              : 'queued'
        const duration = durations[index]
        const startedOffset = durations
          .slice(0, index)
          .reduce((sum, stepDuration) => sum + stepDuration, 0)
        return {
          id: agent.id,
          name: agent.name,
          role: agent.role,
          status,
          started_at: status === 'queued' ? null : timestampAt(startedOffset),
          completed_at:
            status === 'completed' ? timestampAt(startedOffset + duration) : null,
          duration_seconds: status === 'completed' ? duration : null,
          elapsed_seconds: status === 'running' ? runningElapsed : null,
        }
      }),
    },
    created: DEMO_WORKFLOW_STARTED_AT,
    updated: completedAt ?? timestampAt(elapsed),
  }
}

function WorkflowScene({ step }: { step: number }) {
  return (
    <WorkflowSupervisorSurface
      key={step}
      jobs={[demoWorkflowJob(step)]}
      nowMs={Date.parse('2026-07-30T10:00:12.600Z')}
      refreshLabel="任务事件已同步"
      initialFilter={step >= 11 ? 'all' : 'active'}
    />
  )
}

const DEMO_EPISODE_PROFILE = {
  id: 'episode-profile:ai-learning-demo',
  name: '画像驱动双人讲解',
  description: '优先使用类比，再连接公式和实现。',
  speaker_config: '双人讲解',
  default_briefing: '围绕 Q、K、V 展开一段适合机器学习入门者的中文讲解。',
  num_segments: 3,
}

const DEMO_SPEAKER_PROFILE = {
  id: 'speaker-profile:ai-learning-demo',
  name: 'AI 学习搭档',
  description: '一位负责提问，一位负责拆解概念。',
  speakers: [
    {
      name: '小知',
      voice_id: 'demo-zh-CN',
      backstory: '擅长把抽象概念转成生活类比。',
      personality: '清晰、耐心',
    },
  ],
}

function useDemoMediaEpisode(kind: 'podcast' | 'video') {
  const [origin, setOrigin] = useState('')

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  return useMemo<PodcastEpisode>(() => {
    const isVideo = kind === 'video'
    return {
      id: `podcast-episode:ai-learning-demo-${kind}`,
      name: isVideo
        ? '1 分钟看懂一次注意力计算'
        : AI_LEARNING_DEMO.podcast.title,
      notebook_id: 'notebook:ai-learning-demo',
      episode_profile: DEMO_EPISODE_PROFILE,
      speaker_profile: DEMO_SPEAKER_PROFILE,
      briefing: '依据 4 个已采纳来源，用图书馆检索类比讲清 Q、K、V。',
      audio_file:
        !isVideo && origin
          ? `${origin}${AI_LEARNING_DEMO_MEDIA.podcast}`
          : null,
      video_requested: isVideo,
      video_file:
        isVideo && origin
          ? `${origin}${AI_LEARNING_DEMO_MEDIA.video}`
          : null,
      video_subtitle_url:
        isVideo && origin
          ? `${origin}${AI_LEARNING_DEMO_MEDIA.videoCaptions}`
          : null,
      keyframes: isVideo
        ? [
            {
              index: 1,
              turn_index: 0,
              time_index: 0,
              prompt: '搜索光在候选信息中定位并汇聚内容',
              image_file: '/demo/ai-learning/attention-searchlight.png',
            },
            {
              index: 2,
              turn_index: 1,
              time_index: 11.103,
              prompt: 'Q、K、V 信息流总览',
              image_file: AI_LEARNING_DEMO_MEDIA.poster,
            },
            {
              index: 3,
              turn_index: 2,
              time_index: 16.037,
              prompt: 'Query 与 Key 匹配',
              image_file: '/demo/ai-learning/qkv-query.svg',
            },
            {
              index: 4,
              turn_index: 3,
              time_index: 24.827,
              prompt: '相似度经过 Softmax 转成权重',
              image_file: '/demo/ai-learning/qkv-softmax.svg',
            },
            {
              index: 5,
              turn_index: 4,
              time_index: 32.952,
              prompt: 'Value 按权重聚合成输出',
              image_file: '/demo/ai-learning/qkv-output.svg',
            },
          ]
        : null,
      transcript: {
        transcript: [
          {
            speaker: '小知',
            dialogue: AI_LEARNING_DEMO.podcast.transcript,
            visual_prompt: 'Q、K、V 信息流教学图',
          },
        ],
      },
      outline: {
        segments: [
          { name: '检索类比', description: '用问题、索引和内容建立直觉', size: 'short' },
          { name: '公式链路', description: '从 QKᵀ 到 softmax', size: 'short' },
          { name: '信息聚合', description: '理解 Value 的加权求和', size: 'short' },
        ],
      },
      created: '2026-07-30T10:00:00.000Z',
      job_status: 'completed',
    }
  }, [kind, origin])
}

export function AiLearningDemo() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const rawRequestedStep = searchParams?.get('step')
  const requestedStep = rawRequestedStep === null || rawRequestedStep === undefined
    ? Number.NaN
    : Number(rawRequestedStep)
  const initialStep = Number.isInteger(requestedStep) && requestedStep >= 0
    ? Math.min(requestedStep, AI_LEARNING_DEMO_TOTAL_STEPS)
    : defaultDemoStepForPath(pathname)
  const [step, setStep] = useState(initialStep)
  const goToStep = useCallback((nextStep: number) => {
    const next = Math.max(0, Math.min(nextStep, AI_LEARNING_DEMO_TOTAL_STEPS))
    setStep(next)
    router.push(demoStepHref(next))
  }, [router])

  useEffect(() => {
    setStep(initialStep)
  }, [initialStep])

  useEffect(() => {
    const advance = (event: KeyboardEvent) => {
      if (event.repeat || (event.code !== 'Space' && event.key !== ' ')) return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.isComposing || event.keyCode === 229) return
      const next = Math.min(step + 1, AI_LEARNING_DEMO_TOTAL_STEPS)
      if (next === step) return
      event.preventDefault()
      event.stopPropagation()
      goToStep(next)
    }

    window.addEventListener('keydown', advance, true)
    return () => window.removeEventListener('keydown', advance, true)
  }, [goToStep, step])

  const scene = useMemo(() => AI_LEARNING_DEMO_STEPS[step].scene, [step])

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/10"
      data-testid="ai-learning-demo"
      data-scene={scene}
      data-step={step}
    >
      {(scene === 'notebook' || scene === 'search' || scene === 'studio') && (
        <NotebookScene
          step={step}
          onProfileCompleted={() => goToStep(3)}
          onStepRequested={goToStep}
          onExit={() => router.push('/notebooks')}
        />
      )}
      {scene === 'workflow' && <WorkflowScene step={step} />}
    </div>
  )
}

export function AiLearningDemoPage() {
  const pathname = usePathname()
  const title = pathname?.startsWith('/search/')
    ? 'DeepSearch'
    : pathname?.startsWith('/workflow/')
      ? 'Agent 监督台'
      : AI_LEARNING_DEMO.notebookName
  const inNotebook = pathname?.startsWith('/notebooks/')

  return (
    <AppShell
      runtimeStatus={false}
      title={<span className="truncate text-xl font-semibold tracking-tight">{title}</span>}
      titleActions={inNotebook ? (
        <>
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 rounded-full px-3 text-xs"
            onClick={() => window.dispatchEvent(
              new Event('ai-learning-demo:open-profile')
            )}
          >
            <Brain className="h-4 w-4" />
            我的画像
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 rounded-full px-3 text-xs"
            onClick={() => window.dispatchEvent(
              new Event('ai-learning-demo:open-learning-curve')
            )}
          >
            <TrendingUp className="h-4 w-4" />
            学习曲线
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 rounded-full px-3 text-xs"
            onClick={() => window.dispatchEvent(
              new Event('ai-learning-demo:open-mistake-book')
            )}
          >
            <BookMarked className="h-4 w-4" />
            错题本
          </Button>
        </>
      ) : undefined}
    >
      <AiLearningDemo />
    </AppShell>
  )
}
