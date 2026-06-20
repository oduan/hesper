import type { Persistence } from '@hesper/persistence'
import { createId, type Role } from '@hesper/shared'
import type { ToolCatalogService } from './registry-services'

export type ManagedRoleDto = {
  id: string
  name: string
  description: string
  systemPrompt: string
  defaultToolIds: string[]
}

export type CreateManagedRoleInput = {
  name: string
  description?: string
  systemPrompt?: string
  defaultToolIds?: string[]
}

export type UpdateManagedRoleInput = {
  id: string
  name?: string
  description?: string
  systemPrompt?: string
  defaultToolIds?: string[]
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

function toManagedRole(role: Role): ManagedRoleDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description ?? '',
    systemPrompt: role.systemPrompt ?? '',
    defaultToolIds: role.defaultToolIds ?? []
  }
}

function toStoredRole(input: ManagedRoleDto): Role {
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    systemPrompt: input.systemPrompt,
    allowedSkillIds: [],
    defaultSkillIds: [],
    defaultToolIds: input.defaultToolIds,
    canBeMainAgent: true,
    canBeWorkerAgent: true,
    canBeAssignedToWorkerAgent: true
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
      const role: ManagedRoleDto = {
        id: createId('role'),
        name: normalizeRequiredName(input.name),
        description: normalizeOptionalText(input.description),
        systemPrompt: normalizeOptionalText(input.systemPrompt),
        defaultToolIds: validateToolIds(input.defaultToolIds)
      }
      await options.persistence.roles.save(toStoredRole(role))
      return role
    },

    async updateRole(input) {
      const existing = await options.persistence.roles.get(input.id)
      if (!existing) throw new Error(`Role not found: ${input.id}`)
      const next: Role = { ...existing }
      if (input.name !== undefined) next.name = normalizeRequiredName(input.name)
      if (input.description !== undefined) next.description = normalizeOptionalText(input.description)
      if (input.systemPrompt !== undefined) next.systemPrompt = normalizeOptionalText(input.systemPrompt)
      if (input.defaultToolIds !== undefined) next.defaultToolIds = validateToolIds(input.defaultToolIds)
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
