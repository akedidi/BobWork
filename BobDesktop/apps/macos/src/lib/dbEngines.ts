import type { DbConnectionConfig, DbEngine } from '@bob-work/shared-types'

export const DB_ENGINES: Array<{ id: DbEngine; label: string; defaultPort?: number; family: DbFormFamily }> = [
  { id: 'oracle', label: 'Oracle', defaultPort: 1521, family: 'host' },
  { id: 'mysql', label: 'MySQL', defaultPort: 3306, family: 'host' },
  { id: 'sqlserver', label: 'SQL Server', defaultPort: 1433, family: 'host' },
  { id: 'postgresql', label: 'PostgreSQL', defaultPort: 5432, family: 'host' },
  { id: 'mongodb', label: 'MongoDB', defaultPort: 27017, family: 'mongodb' },
  { id: 'redis', label: 'Redis', defaultPort: 6379, family: 'redis' },
  { id: 'elasticsearch', label: 'Elasticsearch', defaultPort: 9200, family: 'elasticsearch' },
  { id: 'db2', label: 'IBM Db2', defaultPort: 50000, family: 'host' },
  { id: 'sqlite', label: 'SQLite', family: 'sqlite' },
  { id: 'snowflake', label: 'Snowflake', family: 'snowflake' },
  { id: 'mariadb', label: 'MariaDB', defaultPort: 3306, family: 'host' },
  { id: 'cassandra', label: 'Cassandra', defaultPort: 9042, family: 'cassandra' },
  { id: 'dynamodb', label: 'Amazon DynamoDB', family: 'dynamodb' },
  { id: 'bigquery', label: 'Google BigQuery', family: 'bigquery' },
  { id: 'clickhouse', label: 'ClickHouse', defaultPort: 8123, family: 'host' },
]

export type DbFormFamily =
  | 'host'
  | 'sqlite'
  | 'mongodb'
  | 'redis'
  | 'elasticsearch'
  | 'snowflake'
  | 'cassandra'
  | 'dynamodb'
  | 'bigquery'

export function engineMeta(engine: DbEngine) {
  return DB_ENGINES.find(item => item.id === engine) ?? DB_ENGINES[3]
}

export function emptyDbConfig(engine: DbEngine): DbConnectionConfig {
  const meta = engineMeta(engine)
  if (meta.family === 'sqlite') return { filePath: '' }
  if (meta.family === 'elasticsearch') return { url: 'https://' }
  if (meta.family === 'snowflake') return { account: '', warehouse: '', database: '', username: '' }
  if (meta.family === 'dynamodb') return { region: '' }
  if (meta.family === 'bigquery') return { projectId: '' }
  if (meta.family === 'cassandra') return { contactPoints: '', keyspace: '', username: '', port: meta.defaultPort }
  if (meta.family === 'mongodb') return { host: '', port: meta.defaultPort, database: '', username: '', uri: '' }
  if (meta.family === 'redis') return { host: '', port: meta.defaultPort, redisIndex: 0 }
  return { host: '', port: meta.defaultPort, database: '', username: '', ssl: false }
}

export function dbConnectionSummary(engine: DbEngine, config: DbConnectionConfig) {
  if (engine === 'sqlite') return config.filePath || 'fichier local'
  if (engine === 'elasticsearch') return config.url || 'URL'
  if (engine === 'snowflake') return [config.account, config.warehouse].filter(Boolean).join(' · ') || 'compte'
  if (engine === 'bigquery') return config.projectId || 'projet'
  if (engine === 'dynamodb') return config.region || 'région'
  const host = config.contactPoints || config.host || config.uri || ''
  const port = config.port ?? engineMeta(engine).defaultPort
  const db = config.database || config.keyspace || ''
  return [host && port ? `${host}:${port}` : host, db].filter(Boolean).join('/') || engine
}
