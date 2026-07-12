export type LearningOutputKind =
  | 'study_guide'
  | 'quiz'
  | 'flashcards'
  | 'mind_map'
  | 'reading'
  | 'code_lab'
  | 'visual_aid'

export interface LearningOrchestrationRequest {
  message: string
  mode?: 'chat' | 'collect' | 'generate'
  course: string
  major?: string
  goal?: string
  learning_history?: string[]
  requested_outputs?: LearningOutputKind[]
  accepted_resource_ids?: string[]
  supplemental_materials?: LearningSupplementalMaterial[]
  learning_record_id?: string
  target_language?: string
  image_model?: string
  auto_update_profile?: boolean
  use_profile_source?: boolean
}

export interface LearningSupplementalMaterial {
  id: string
  title: string
  material_type: string
  content: string
}

export interface LearningProfileEventRequest {
  learning_record_id: string
  event_type: string
  summary: string
  auto_update_profile?: boolean
}

export interface LearningProfileSourceResponse {
  source_id?: string | null
  title: string
  content: string
  updated?: string | null
  updated_profile: boolean
}

export interface LearningProfileDimension {
  name: string
  value: string
  evidence: string
  confidence: number
}

export interface LearningResource {
  kind: LearningOutputKind
  type: string
  title: string
  agent: string
  format: string
  summary: string
  content: string
  tags: string[]
  payload?: Record<string, unknown>
}

export interface LearningCollectedResource {
  id: string
  title: string
  source_type: string
  query: string
  reason: string
  url?: string | null
  snippet?: string | null
  provider?: string | null
  quality_score?: number | null
  resource_kind?: string | null
  learning_value?: string | null
  search_intent?: string | null
  adoption_status: 'recommended' | 'accepted' | 'rejected' | 'user_upload'
}

export interface LearningPathStep {
  order: number
  title: string
  objective: string
  activities: string[]
  resources: string[]
  checkpoint: string
}

export interface LearningAgentStage {
  id: string
  name: string
  role: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  output: string
}

export interface LearningSafetyReport {
  status: 'passed' | 'needs_review'
  checks: string[]
  revisions: string[]
}

export interface LearningEvaluation {
  score: number
  strengths: string[]
  risks: string[]
  next_adjustments: string[]
}

export interface LearningOrchestrationResponse {
  profile: LearningProfileDimension[]
  collected_resources: LearningCollectedResource[]
  resources: LearningResource[]
  learning_path: LearningPathStep[]
  recommendations: string[]
  tutor_answer: string
  evaluation: LearningEvaluation
  safety_report: LearningSafetyReport
  trace: LearningAgentStage[]
}

export type LearningStreamEvent =
  | {
      type: 'stage'
      stage: LearningAgentStage
    }
  | {
      type: 'complete'
      result: LearningOrchestrationResponse
    }
  | {
      type: 'error'
      message: string
    }
