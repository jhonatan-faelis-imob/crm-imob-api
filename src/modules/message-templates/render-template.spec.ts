import { extractVariables, greeting, renderTemplate, truncateText } from './render-template'

describe('extractVariables', () => {
  it('lists each variable once', () => {
    expect(extractVariables('{{nome}}, {{saudacao}} {{nome}}')).toEqual(['nome', 'saudacao'])
  })
})

describe('greeting', () => {
  it('follows Sao Paulo time, not UTC', () => {
    expect(greeting(new Date('2026-11-06T14:59:00.000Z'))).toBe('Bom dia')
    expect(greeting(new Date('2026-11-06T15:00:00.000Z'))).toBe('Boa tarde')
    expect(greeting(new Date('2026-11-06T20:59:00.000Z'))).toBe('Boa tarde')
    expect(greeting(new Date('2026-11-06T21:00:00.000Z'))).toBe('Boa noite')
    expect(greeting(new Date('2026-11-07T02:30:00.000Z'))).toBe('Boa noite')
    expect(greeting(new Date('2026-11-07T03:00:00.000Z'))).toBe('Bom dia')
  })
})

describe('renderTemplate', () => {
  it('fills known variables and keeps the empty ones', () => {
    const { text, missing } = renderTemplate('Oi {{nome}}, sobre {{empreendimento}}', { nome: 'Ana', empreendimento: '' })
    expect(text).toBe('Oi Ana, sobre {{empreendimento}}')
    expect(missing).toEqual(['empreendimento'])
  })

  it('reports unknown variables', () => {
    expect(renderTemplate('{{foo}}', {}).missing).toEqual(['foo'])
  })

  it('does not expand what comes from a value', () => {
    const { text } = renderTemplate('{{nome}}', { nome: '{{corretor}} $& fim', corretor: 'X' })
    expect(text).toBe('{{corretor}} $& fim')
  })
})

describe('truncateText', () => {
  it('does not split an emoji', () => {
    expect(truncateText('ab😊cd', 3)).toBe('ab😊')
  })
})
