'use client'

import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { useCreateNotebook } from '@/lib/hooks/use-notebooks'
import { useTranslation } from '@/lib/hooks/use-translation'
import type { NotebookResponse } from '@/lib/types/api'

const createNotebookSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  description: z.string().optional(),
})

type CreateNotebookFormData = z.infer<typeof createNotebookSchema>

interface CreateNotebookDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: (notebook: NotebookResponse) => void
  createOverride?: (
    data: CreateNotebookFormData
  ) => NotebookResponse | Promise<NotebookResponse>
  initialValues?: Partial<CreateNotebookFormData>
  preventAutoFocus?: boolean
  onCanceled?: () => void
}

export function CreateNotebookDialog({
  open,
  onOpenChange,
  onCreated,
  createOverride,
  initialValues,
  preventAutoFocus = false,
  onCanceled,
}: CreateNotebookDialogProps) {
  const { t } = useTranslation()
  const createNotebook = useCreateNotebook()
  const [overridePending, setOverridePending] = useState(false)
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    reset,
    watch,
  } = useForm<CreateNotebookFormData>({
    resolver: zodResolver(createNotebookSchema),
    mode: 'onChange',
    defaultValues: {
      name: initialValues?.name ?? '',
      description: initialValues?.description ?? '',
    },
  })
  const formIsValid = createOverride ? Boolean(watch('name').trim()) : isValid
  const isPending = createNotebook.isPending || overridePending

  const closeDialog = () => onOpenChange(false)
  const cancelDialog = () => {
    closeDialog()
    onCanceled?.()
  }

  const onSubmit = async (data: CreateNotebookFormData) => {
    if (createOverride) {
      setOverridePending(true)
    }
    try {
      const created = createOverride
        ? await createOverride(data)
        : await createNotebook.mutateAsync(data)
      closeDialog()
      reset()
      onCreated?.(created)
    } finally {
      setOverridePending(false)
    }
  }

  useEffect(() => {
    if (!open) {
      reset()
      setOverridePending(false)
    }
  }, [open, reset])

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen) {
      onCanceled?.()
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="sm:max-w-[480px]"
        onOpenAutoFocus={preventAutoFocus ? (event) => event.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle>{t('notebooks.createNew')}</DialogTitle>
          <DialogDescription>
            {t('notebooks.createNewDesc')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notebook-name">{t('common.name')} *</Label>
            <Input
              id="notebook-name"
              {...register('name')}
              placeholder={t('notebooks.namePlaceholder')}
              autoComplete="off"
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notebook-description">{t('common.description')}</Label>
            <Textarea
              id="notebook-description"
              {...register('description')}
              placeholder={t('notebooks.descPlaceholder')}
              rows={4}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={cancelDialog}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!formIsValid || isPending}>
              {isPending ? t('common.creating') : t('notebooks.createNew')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
