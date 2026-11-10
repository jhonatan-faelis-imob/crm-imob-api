export interface JwtPayload {
  sub: string          // user id
  email: string
  role: string
  organizationId: string
  teamId: string | null
  /** updatedAt do usuário em ms no momento da emissão (ver session-stamp.ts) */
  pwd?: number
}
