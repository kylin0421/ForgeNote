'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { AddSourceDialog } from '@/components/sources/AddSourceDialog'
import { ProfileOnboardingDialog } from '@/components/learning/ProfileOnboardingDialog'
import { CreateNotebookDialog } from '@/components/notebooks/CreateNotebookDialog'
import { GeneratePodcastDialog } from '@/components/podcasts/GeneratePodcastDialog'
import type { NotebookResponse } from '@/lib/types/api'

interface CreateDialogsContextType {
  openSourceDialog: () => void
  showNotebookDialog: () => void
  openPodcastDialog: () => void
}

const CreateDialogsContext = createContext<CreateDialogsContextType | null>(null)

export function CreateDialogsProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false)
  const [notebookDialogOpen, setNotebookDialogOpen] = useState(false)
  const [podcastDialogOpen, setPodcastDialogOpen] = useState(false)
  const [createdNotebook, setCreatedNotebook] = useState<NotebookResponse | null>(null)
  const [profileOnboardingOpen, setProfileOnboardingOpen] = useState(false)

  const openSourceDialog = useCallback(() => setSourceDialogOpen(true), [])
  const showNotebookDialog = useCallback(() => setNotebookDialogOpen(true), [])
  const openPodcastDialog = useCallback(() => setPodcastDialogOpen(true), [])

  return (
    <CreateDialogsContext.Provider
      value={{
        openSourceDialog,
        showNotebookDialog,
        openPodcastDialog,
      }}
    >
      {children}
      <AddSourceDialog open={sourceDialogOpen} onOpenChange={setSourceDialogOpen} />
      <CreateNotebookDialog
        open={notebookDialogOpen}
        onOpenChange={setNotebookDialogOpen}
        onCreated={(notebook) => {
          setCreatedNotebook(notebook)
          setProfileOnboardingOpen(true)
        }}
      />
      <ProfileOnboardingDialog
        open={profileOnboardingOpen}
        notebook={createdNotebook}
        onCompleted={(resourceSearchGoal) => {
          if (!createdNotebook) return
          setProfileOnboardingOpen(false)
          router.push(
            `/notebooks/${encodeURIComponent(createdNotebook.id)}?profileReady=1&sourceSearch=${encodeURIComponent(resourceSearchGoal)}`
          )
        }}
      />
      <GeneratePodcastDialog open={podcastDialogOpen} onOpenChange={setPodcastDialogOpen} />
    </CreateDialogsContext.Provider>
  )
}

export function useCreateDialogs() {
  const context = useContext(CreateDialogsContext)
  if (!context) {
    throw new Error('useCreateDialogs must be used within a CreateDialogsProvider')
  }
  return context
}
