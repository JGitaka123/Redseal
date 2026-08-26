import { forbidden } from '../domain/errors.js'

export type Role = 'director' | 'sales' | 'finance' | 'registry'

export type Permission =
  | 'plots:read'
  | 'plots:reserve'
  | 'plots:cancel_reservation'
  | 'clients:read'
  | 'clients:write'
  | 'payments:read'
  | 'payments:record'
  | 'payments:allocate'
  | 'payments:reverse'
  | 'cases:read'
  | 'cases:write'
  | 'overview:read'
  | 'reports:read'
  | 'audit:read'

const SHARED_READ: Permission[] = ['plots:read', 'clients:read', 'overview:read', 'reports:read', 'cases:read']

/**
 * Capability matrix. Roles are additive sets of permissions; routes declare the
 * permission they need rather than naming roles, so adding a role later does
 * not require touching every route.
 */
export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  director: new Set<Permission>([
    ...SHARED_READ,
    'plots:reserve',
    'plots:cancel_reservation',
    'clients:write',
    'payments:read',
    'payments:record',
    'payments:allocate',
    'payments:reverse',
    'cases:write',
    'audit:read',
  ]),
  sales: new Set<Permission>([
    ...SHARED_READ,
    'plots:reserve',
    'plots:cancel_reservation',
    'clients:write',
    'payments:read',
  ]),
  finance: new Set<Permission>([
    ...SHARED_READ,
    'payments:read',
    'payments:record',
    'payments:allocate',
    'payments:reverse',
  ]),
  registry: new Set<Permission>([...SHARED_READ, 'cases:write', 'clients:write']),
}

export const can = (role: Role, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].has(permission)

export function assertCan(role: Role, permission: Permission): void {
  if (!can(role, permission)) {
    throw forbidden(`Role '${role}' is not permitted to ${permission.replace(':', ' ')}`)
  }
}
