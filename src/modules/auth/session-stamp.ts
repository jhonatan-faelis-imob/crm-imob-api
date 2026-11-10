/**
 * Carimbo da sessão: o updatedAt do usuário em milissegundos, gravado no JWT como "pwd".
 * Qualquer alteração no usuário (senha, perfil, cargo, equipe) muda o updatedAt e invalida os tokens antigos.
 * Token sem "pwd" (emitido antes desta regra) também deixa de valer
 */
export function sessionStamp(updatedAt: Date): number {
  return updatedAt.getTime()
}

export function isSessionCurrent(pwd: unknown, updatedAt: Date): boolean {
  return typeof pwd === 'number' && pwd === sessionStamp(updatedAt)
}
