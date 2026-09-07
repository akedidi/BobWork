import { describe, expect, it } from 'vitest'
import { DB_ENGINES, emptyDbConfig, engineMeta } from './dbEngines'

describe('dbEngines', () => {
  it('lists the 15 supported engines', () => {
    expect(DB_ENGINES).toHaveLength(15)
    expect(DB_ENGINES.map(item => item.id)).toContain('db2')
    expect(DB_ENGINES.map(item => item.id)).toContain('postgresql')
  })

  it('returns sqlite file fields and bigquery project fields', () => {
    expect(emptyDbConfig('sqlite')).toEqual({ filePath: '' })
    expect(emptyDbConfig('bigquery')).toEqual({ projectId: '' })
    expect(emptyDbConfig('postgresql').port).toBe(5432)
    expect(emptyDbConfig('db2').port).toBe(50000)
    expect(engineMeta('db2').label).toBe('IBM Db2')
    expect(engineMeta('db2').family).toBe('host')
  })
})
