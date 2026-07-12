export interface Model {
  id: string
  name: string
  provider: string
  runtime_provider?: string | null
  api_protocol?: string | null
  model_spec?: {
    provider: string
    runtime_provider: string
    api_protocol: string
    model_type: string
    model_name: string
    batch_tts_supported: boolean
    warnings: string[]
  } | null
  type: 'language' | 'embedding' | 'text_to_speech' | 'speech_to_text' | 'image'
  credential?: string | null
  created: string
  updated: string
}

export interface CreateModelRequest {
  name: string
  provider: string
  type: 'language' | 'embedding' | 'text_to_speech' | 'speech_to_text' | 'image'
  credential?: string
}

export interface ModelDefaults {
  default_chat_model?: string | null
  default_transformation_model?: string | null
  large_context_model?: string | null
  default_text_to_speech_model?: string | null
  default_speech_to_text_model?: string | null
  default_embedding_model?: string | null
  default_retrieval_model?: string | null
  default_tools_model?: string | null
  default_rag_model?: string | null
  default_resource_search_model?: string | null
  default_learning_asset_model?: string | null
  default_study_guide_model?: string | null
  default_quiz_model?: string | null
  default_flashcards_model?: string | null
  default_mind_map_model?: string | null
  default_reading_model?: string | null
  default_code_lab_model?: string | null
  default_podcast_model?: string | null
  default_image_model?: string | null
}

export interface ProviderAvailability {
  available: string[]
  unavailable: string[]
  supported_types: Record<string, string[]>
}

// Model Discovery Types
export interface DiscoveredModel {
  name: string
  provider: string
  model_type?: 'language' | 'embedding' | 'text_to_speech' | 'speech_to_text' | 'image'
  description?: string
}

export interface ProviderSyncResult {
  provider: string
  discovered: number
  new: number
  existing: number
}

export interface AllProvidersSyncResult {
  results: Record<string, ProviderSyncResult>
  total_discovered: number
  total_new: number
}

export interface ProviderModelCount {
  provider: string
  counts: Record<string, number>
  total: number
}

export interface AutoAssignResult {
  assigned: Record<string, string>  // slot_name -> model_id
  skipped: string[]  // slots already assigned
  missing: string[]  // slots with no available models
}

export interface ModelTestResult {
  success: boolean
  message: string
  details?: string
}
