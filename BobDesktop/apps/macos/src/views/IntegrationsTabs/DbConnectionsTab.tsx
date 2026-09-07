import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import type { DbConnection, DbConnectionConfig, DbEngine, SaveDbConnectionInput } from '@bob-work/shared-types'
import { ConnectionOkPastille, ConnectionTestBadge } from '../../components/Integrations/ConnectionTestBadge'
import { useAppDialog } from '../../components/AppDialog'
import { useT } from '../../i18n'
import { DB_ENGINES, dbConnectionSummary, emptyDbConfig, engineMeta } from '../../lib/dbEngines'
import { errorMessage } from '../../lib/errorMessage'

const fieldLabelStyle = { display: 'flex', flexDirection: 'column' as const, gap: 4, fontSize: 11.5, color: 'var(--text-secondary)' }
const fieldInputStyle = { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 12 }

type DbForm = SaveDbConnectionInput

const emptyForm = (): DbForm => ({
  name: '',
  engine: 'postgresql',
  config: emptyDbConfig('postgresql'),
  secret: '',
  enabled: true,
})

export function DbConnectionsTab({
  connections,
  testBusy,
  testConnection,
  load,
  persist,
  toggle,
  remove,
}: {
  connections: DbConnection[]
  testBusy: string | null
  testConnection: (id: string, name: string) => Promise<void>
  load: () => Promise<void>
  persist: (input: SaveDbConnectionInput) => Promise<DbConnection>
  toggle: (id: string, enabled: boolean) => Promise<void>
  remove: (id: string, name: string) => Promise<void>
}) {
  const t = useT()
  const dialog = useAppDialog()
  const [form, setForm] = useState<DbForm>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const setEngine = (engine: DbEngine) => {
    setForm(current => ({
      ...current,
      engine,
      config: { ...emptyDbConfig(engine), ...keepShared(current.config, engine) },
    }))
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await persist({
        ...form,
        secret: form.secret?.trim() ? form.secret : undefined,
      })
      setForm(emptyForm())
      await load()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const edit = (connection: DbConnection) => {
    setForm({
      id: connection.id,
      name: connection.name,
      engine: connection.engine,
      config: connection.config,
      secret: '',
      enabled: connection.enabled,
    })
  }

  return (
    <div className="extension-grid integrations-mcp-grid" data-testid="db-connections-tab">
      <section className="extension-list">
        <h2>{t('integrations.dbConfigured')} <small>{connections.length}</small></h2>
        <p className="settings-note">{t('integrations.dbListHint')}</p>
        {connections.length === 0 ? (
          <div className="task-empty">{t('integrations.dbEmpty')}</div>
        ) : connections.map(connection => (
          <article className={`extension-card${connection.lastTest?.ok ? ' is-test-ok' : ''}`} key={connection.id}>
            <div>
              <span className="extension-card-title">
                <strong>{connection.name}</strong>
                <ConnectionOkPastille test={connection.lastTest} />
              </span>
              <span className="extension-card-tag">{engineMeta(connection.engine).label}{(connection.hasSecret ? ' · secret' : '')}</span>
              <ConnectionTestBadge test={connection.lastTest} />
            </div>
            <p>{dbConnectionSummary(connection.engine, connection.config)}</p>
            {connection.lastTest && (
              <p className={connection.lastTest.ok ? 'status-ok' : 'plugin-version-warning'} role={connection.lastTest.ok ? undefined : 'alert'}>
                {connection.lastTest.message}
              </p>
            )}
            <div className="settings-actions">
              <label className="mini-toggle">
                <input
                  type="checkbox"
                  checked={connection.enabled}
                  onChange={async event => { await toggle(connection.id, event.target.checked) }}
                /> {t('integrations.dbEnabled')}
              </label>
              <button className="secondary-btn" onClick={() => edit(connection)}>{t('common.edit')}</button>
              <button
                className="secondary-btn"
                disabled={testBusy === connection.id}
                onClick={() => void testConnection(connection.id, connection.name)}
              >
                {testBusy === connection.id ? t('integrations.dbTesting') : t('integrations.dbTest')}
              </button>
              <button
                className="danger-link"
                onClick={async () => {
                  if (await dialog.confirm({
                    message: t('integrations.deleteDbConfirm', { name: connection.name }),
                    confirmLabel: t('common.delete'),
                    destructive: true,
                  })) {
                    await remove(connection.id, connection.name)
                  }
                }}
              >
                {t('common.delete')}
              </button>
            </div>
          </article>
        ))}
      </section>
      <section className="extension-editor">
        <h2>{form.id ? t('integrations.dbEdit') : t('integrations.dbAdd')}</h2>
        <p className="settings-note">{t('integrations.dbFormHint')}</p>
        <label style={fieldLabelStyle}>{t('integrations.dbName')}
          <input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="sales" style={fieldInputStyle} />
        </label>
        <label style={fieldLabelStyle}>{t('integrations.dbEngine')}
          <select value={form.engine} onChange={event => setEngine(event.target.value as DbEngine)} style={fieldInputStyle}>
            {DB_ENGINES.map(engine => (
              <option key={engine.id} value={engine.id}>{engine.label}</option>
            ))}
          </select>
        </label>
        {form.engine === 'db2' ? <p className="settings-note">{t('integrations.dbHintDb2')}</p> : null}
        <DbEngineFields config={form.config} engine={form.engine} secret={form.secret ?? ''} hasExistingSecret={Boolean(form.id)} onChange={config => setForm(current => ({ ...current, config }))} onSecret={secret => setForm(current => ({ ...current, secret }))} />
        {error ? <p className="plugin-version-warning" role="alert">{error}</p> : null}
        <button className="btn-primary" disabled={saving || !form.name.trim()} onClick={() => void save()}>
          {saving ? t('integrations.dbSaving') : t('integrations.dbSave')}
        </button>
      </section>
    </div>
  )
}

function keepShared(config: DbConnectionConfig, engine: DbEngine): DbConnectionConfig {
  const next = emptyDbConfig(engine)
  return {
    ...next,
    host: config.host || next.host,
    database: config.database || next.database,
    username: config.username || next.username,
  }
}

function DbEngineFields({
  config,
  engine,
  secret,
  hasExistingSecret,
  onChange,
  onSecret,
}: {
  config: DbConnectionConfig
  engine: DbEngine
  secret: string
  hasExistingSecret: boolean
  onChange: (config: DbConnectionConfig) => void
  onSecret: (secret: string) => void
}) {
  const t = useT()
  const family = engineMeta(engine).family
  const patch = (partial: Partial<DbConnectionConfig>) => onChange({ ...config, ...partial })
  const secretLabel = family === 'bigquery'
    ? t('integrations.dbServiceAccount')
    : family === 'elasticsearch' || family === 'dynamodb'
      ? t('integrations.dbApiKey')
      : t('integrations.dbPassword')

  return (
    <>
      {family === 'sqlite' && (
        <label style={fieldLabelStyle}>{t('integrations.dbFilePath')}
          <span style={{ display: 'flex', gap: 8 }}>
            <input value={config.filePath ?? ''} onChange={event => patch({ filePath: event.target.value })} placeholder="/chemin/vers/data.sqlite" style={{ ...fieldInputStyle, flex: 1 }} />
            <button type="button" className="secondary-btn" onClick={async () => {
              const selected = await open({ multiple: false, filters: [{ name: 'SQLite', extensions: ['sqlite', 'db', 'sqlite3'] }] })
              if (typeof selected === 'string') patch({ filePath: selected })
            }}>{t('common.browse')}</button>
          </span>
        </label>
      )}
      {family === 'elasticsearch' && (
        <label style={fieldLabelStyle}>{t('integrations.dbUrl')}
          <input value={config.url ?? ''} onChange={event => patch({ url: event.target.value })} placeholder="https://search.example.com:9200" style={fieldInputStyle} />
        </label>
      )}
      {family === 'mongodb' && (
        <label style={fieldLabelStyle}>{t('integrations.dbUri')}
          <input value={config.uri ?? ''} onChange={event => patch({ uri: event.target.value })} placeholder="mongodb://host:27017/db" style={fieldInputStyle} />
        </label>
      )}
      {family === 'snowflake' && (
        <>
          <label style={fieldLabelStyle}>{t('integrations.dbAccount')}
            <input value={config.account ?? ''} onChange={event => patch({ account: event.target.value })} style={fieldInputStyle} />
          </label>
          <label style={fieldLabelStyle}>{t('integrations.dbWarehouse')}
            <input value={config.warehouse ?? ''} onChange={event => patch({ warehouse: event.target.value })} style={fieldInputStyle} />
          </label>
        </>
      )}
      {family === 'dynamodb' && (
        <label style={fieldLabelStyle}>{t('integrations.dbRegion')}
          <input value={config.region ?? ''} onChange={event => patch({ region: event.target.value })} placeholder="eu-west-1" style={fieldInputStyle} />
        </label>
      )}
      {family === 'bigquery' && (
        <label style={fieldLabelStyle}>{t('integrations.dbProjectId')}
          <input value={config.projectId ?? ''} onChange={event => patch({ projectId: event.target.value })} style={fieldInputStyle} />
        </label>
      )}
      {(family === 'host' || family === 'mongodb' || family === 'redis' || family === 'cassandra') && (
        <>
          {family === 'cassandra' ? (
            <label style={fieldLabelStyle}>{t('integrations.dbContactPoints')}
              <input value={config.contactPoints ?? config.host ?? ''} onChange={event => patch({ contactPoints: event.target.value, host: event.target.value })} style={fieldInputStyle} />
            </label>
          ) : (
            <label style={fieldLabelStyle}>{t('integrations.dbHost')}
              <input value={config.host ?? ''} onChange={event => patch({ host: event.target.value })} placeholder="localhost" style={fieldInputStyle} />
            </label>
          )}
          <label style={fieldLabelStyle}>{t('integrations.dbPort')}
            <input type="number" value={config.port ?? ''} onChange={event => patch({ port: event.target.value ? Number(event.target.value) : undefined })} style={fieldInputStyle} />
          </label>
        </>
      )}
      {(family === 'host' || family === 'mongodb' || family === 'snowflake' || family === 'cassandra') && (
        <label style={fieldLabelStyle}>{family === 'cassandra' ? t('integrations.dbKeyspace') : t('integrations.dbDatabase')}
          <input
            value={(family === 'cassandra' ? config.keyspace : config.database) ?? ''}
            onChange={event => patch(family === 'cassandra' ? { keyspace: event.target.value } : { database: event.target.value })}
            style={fieldInputStyle}
          />
        </label>
      )}
      {(family === 'host' || family === 'mongodb' || family === 'redis' || family === 'snowflake' || family === 'cassandra') && (
        <label style={fieldLabelStyle}>{t('integrations.dbUsername')}
          <input value={config.username ?? ''} onChange={event => patch({ username: event.target.value })} style={fieldInputStyle} />
        </label>
      )}
      {family === 'redis' && (
        <label style={fieldLabelStyle}>{t('integrations.dbRedisIndex')}
          <input type="number" value={config.redisIndex ?? 0} onChange={event => patch({ redisIndex: Number(event.target.value) })} style={fieldInputStyle} />
        </label>
      )}
      {family === 'host' && (
        <label className="mini-toggle">
          <input type="checkbox" checked={Boolean(config.ssl)} onChange={event => patch({ ssl: event.target.checked })} /> {t('integrations.dbSsl')}
        </label>
      )}
      {family !== 'sqlite' && (
        <label style={fieldLabelStyle}>{secretLabel}
          <input
            type="password"
            value={secret}
            onChange={event => onSecret(event.target.value)}
            placeholder={hasExistingSecret ? t('integrations.dbSecretUnchanged') : ''}
            style={fieldInputStyle}
          />
        </label>
      )}
    </>
  )
}
