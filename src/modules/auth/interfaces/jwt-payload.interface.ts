export interface JwtPayload {
  sub: string          // user id
  email: string
  role: string
  organizationId: string
  teamId: string | null
}
