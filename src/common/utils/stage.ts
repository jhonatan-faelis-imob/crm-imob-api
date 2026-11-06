export function normalizeStageName(name: string) {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase()
}
