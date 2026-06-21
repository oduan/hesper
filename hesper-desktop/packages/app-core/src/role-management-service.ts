import type { Persistence } from '@hesper/persistence'
import { createId, type ModelRef, type Role } from '@hesper/shared'
import type { ToolCatalogService } from './registry-services'

export type ManagedRoleDto = {
  id: string
  name: string
  description: string
  systemPrompt: string
  defaultToolIds: string[]
  defaultModelId: string
  defaultModelRef?: ModelRef
}

export type CreateManagedRoleInput = {
  name: string
  description?: string
  systemPrompt?: string
  defaultToolIds?: string[]
  defaultModelId?: string
  defaultModelRef?: ModelRef
}

export type UpdateManagedRoleInput = {
  id: string
  name?: string
  description?: string
  systemPrompt?: string
  defaultToolIds?: string[]
  defaultModelId?: string
  defaultModelRef?: ModelRef
}

export type ManagedRoleService = {
  listRoles(): Promise<ManagedRoleDto[]>
  createRole(input: CreateManagedRoleInput): Promise<ManagedRoleDto>
  updateRole(input: UpdateManagedRoleInput): Promise<ManagedRoleDto>
  deleteRole(id: string): Promise<{ deleted: true; id: string }>
}

export type RoleManagementServiceOptions = {
  persistence: Persistence
  toolCatalogService: ToolCatalogService
}

function normalizeRequiredName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Role name is required')
  return trimmed
}

function normalizeOptionalText(value: string | undefined): string {
  return value?.trim() ?? ''
}

function normalizeOptionalModelId(value: string | undefined): string | undefined {
  return value?.trim()
}

function cloneModelRef(modelRef: ModelRef): ModelRef {
  return { providerId: modelRef.providerId, modelId: modelRef.modelId }
}

function assertDefaultModelRefMatches(defaultModelId: string | undefined, defaultModelRef: ModelRef | undefined): void {
  if (defaultModelId && defaultModelRef && defaultModelRef.modelId !== defaultModelId) {
    throw new Error('Default model reference modelId must match defaultModelId')
  }
}

function toManagedRole(role: Role): ManagedRoleDto {
  const defaultModelId = role.defaultModelId !== undefined
    ? role.defaultModelId
    : role.defaultModelRef?.modelId ?? ''
  const defaultModelRef = role.defaultModelId === ''
    ? undefined
    : role.defaultModelRef ? cloneModelRef(role.defaultModelRef) : undefined

  return {
    id: role.id,
    name: role.name,
    description: role.description ?? '',
    systemPrompt: role.systemPrompt ?? '',
    defaultToolIds: [...(role.defaultToolIds ?? [])],
    defaultModelId,
    ...(defaultModelRef ? { defaultModelRef } : {})
  }
}

export function createRoleManagementService(options: RoleManagementServiceOptions): ManagedRoleService {
  const validateToolIds = (toolIds: string[] | undefined): string[] => {
    const ids = toolIds ?? []
    for (const id of ids) {
      if (!options.toolCatalogService.get(id)) {
        throw new Error(`Unknown tool id: ${id}`)
      }
    }
    return [...ids]
  }

  return {
    async listRoles() {
      return (await options.persistence.roles.list()).map(toManagedRole)
    },

    async createRole(input) {
      const role: Role = {
        id: createId('role'),
        name: normalizeRequiredName(input.name),
        description: normalizeOptionalText(input.description),
        systemPrompt: normalizeOptionalText(input.systemPrompt),
        allowedSkillIds: [],
        defaultSkillIds: [],
        defaultToolIds: validateToolIds(input.defaultToolIds),
        canBeMainAgent: true,
        canBeWorkerAgent: true,
        canBeAssignedToWorkerAgent: true
      }

      const defaultModelId = normalizeOptionalModelId(input.defaultModelId)
      if (defaultModelId === '') {
        // Inherit the parent session / caller model.
      } else if (defaultModelId !== undefined) {
        assertDefaultModelRefMatches(defaultModelId, input.defaultModelRef)
        role.defaultModelId = defaultModelId
        if (input.defaultModelRef) {
          role.defaultModelRef = cloneModelRef(input.defaultModelRef)
        }
      }
      assertDefaultModelRefMatches(role.defaultModelId, role.defaultModelRef)

      await options.persistence.roles.save(role)
      return toManagedRole(role)
    },

    async updateRole(input) {
      const existing = await options.persistence.roles.get(input.id)
      if (!existing) throw new Error(`Role not found: ${input.id}`)
      const next: Role = { ...existing }
      if (input.name !== undefined) next.name = normalizeRequiredName(input.name)
      if (input.description !== undefined) next.description = normalizeOptionalText(input.description)
      if (input.systemPrompt !== undefined) next.systemPrompt = normalizeOptionalText(input.systemPrompt)
      if (input.defaultToolIds !== undefined) next.defaultToolIds = validateToolIds(input.defaultToolIds)

      const currentDefaultModelId = existing.defaultModelId ?? existing.defaultModelRef?.modelId
      const defaultModelId = normalizeOptionalModelId(input.defaultModelId)
      if (defaultModelId === '') {
        delete next.defaultModelId
        delete next.defaultModelRef
      } else if (defaultModelId !== undefined) {
        assertDefaultModelRefMatches(defaultModelId, input.defaultModelRef)
        next.defaultModelId = defaultModelId
        if (input.defaultModelRef !== undefined) {
          next.defaultModelRef = cloneModelRef(input.defaultModelRef)
        } else if (currentDefaultModelId !== undefined && currentDefaultModelId !== defaultModelId && next.defaultModelRef !== undefined) {
          delete next.defaultModelRef
        }
      }
      assertDefaultModelRefMatches(next.defaultModelId, next.defaultModelRef)

      await options.persistence.roles.save(next)
      return toManagedRole(next)
    },

    async deleteRole(id) {
      const existing = await options.persistence.roles.get(id)
      if (!existing) throw new Error(`Role not found: ${id}`)
      await options.persistence.roles.delete(id)
      return { deleted: true as const, id }
    }
  }
}
