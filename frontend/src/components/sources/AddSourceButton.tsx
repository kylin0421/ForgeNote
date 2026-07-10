'use client'

import { useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AddSourceDialog } from './AddSourceDialog'
import { useTranslation } from '@/lib/hooks/use-translation'

interface AddSourceButtonProps {
  defaultNotebookId?: string
  variant?: 'default' | 'outline' | 'ghost'
  size?: 'sm' | 'default' | 'lg'
  className?: string
  iconOnly?: boolean
  onCreated?: () => void
}

export function AddSourceButton({ 
  defaultNotebookId, 
  variant = 'default',
  size = 'default',
  className,
  iconOnly = false,
  onCreated,
}: AddSourceButtonProps) {
  const { t } = useTranslation()
  const [dialogOpen, setDialogOpen] = useState(false)

  return (
    <>
      <Button
        onClick={() => setDialogOpen(true)}
        variant={variant}
        size={size}
        className={className}
      >
        <PlusIcon className={iconOnly ? "h-4 w-4" : "h-4 w-4 mr-2"} />
        {!iconOnly && t('sources.addSource')}
      </Button>

      <AddSourceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultNotebookId={defaultNotebookId}
        onCreated={onCreated}
      />
    </>
  )
}
