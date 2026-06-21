/// <reference path="./sqljs.d.ts" />
import type { Database } from 'sql.js'

export const schemaSql = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  workspace_path TEXT,
  default_model_id TEXT,
  provider_id TEXT,
  model_id TEXT,
  role_id TEXT,
  enabled_skill_ids_json TEXT,
  enabled_tool_ids_json TEXT,
  allowed_worker_agent_role_ids_json TEXT,
  max_worker_agent_depth INTEGER,
  max_worker_agents_per_run INTEGER,
  output_mode TEXT NOT NULL,
  unread_completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sort_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  content_type TEXT NOT NULL,
  run_id TEXT,
  created_at TEXT NOT NULL,
  sort_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  parent_run_id TEXT,
  worker_agent_invocation_id TEXT,
  depth INTEGER,
  status TEXT NOT NULL,
  model_id TEXT NOT NULL,
  workspace_path TEXT,
  retry_count INTEGER NOT NULL,
  max_retries INTEGER NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  error_json TEXT,
  sort_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  detail TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  sort_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runtime_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS model_providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  auth_type TEXT,
  pi_auth_provider TEXT,
  base_url TEXT,
  api_key_ref TEXT,
  has_api_key INTEGER,
  enabled INTEGER NOT NULL,
  default_model_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sort_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  model_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  capabilities_json TEXT NOT NULL,
  context_window INTEGER,
  enabled INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sort_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  source TEXT NOT NULL,
  path TEXT,
  source_path TEXT,
  prompt TEXT,
  allowed_tool_ids_json TEXT,
  enabled INTEGER,
  sort_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  default_model_id TEXT,
  default_model_ref_json TEXT,
  system_prompt TEXT,
  allowed_skill_ids_json TEXT NOT NULL,
  default_skill_ids_json TEXT,
  default_tool_ids_json TEXT,
  can_be_main_agent INTEGER NOT NULL,
  can_be_worker_agent INTEGER NOT NULL,
  can_be_assigned_to_worker_agent INTEGER,
  worker_agent_guidance TEXT,
  sort_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_permission_policies (
  id TEXT PRIMARY KEY,
  tool_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  scope TEXT NOT NULL,
  subject_id TEXT,
  risk_level TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sort_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS worker_agent_invocations (
  id TEXT PRIMARY KEY,
  parent_run_id TEXT NOT NULL,
  child_run_id TEXT,
  parent_step_id TEXT,
  parent_tool_call_id TEXT,
  task TEXT NOT NULL,
  role_id TEXT NOT NULL,
  allowed_tool_ids_json TEXT NOT NULL,
  model_ref_json TEXT,
  role_snapshot_json TEXT,
  expected_output TEXT,
  context_summary TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_event_at TEXT,
  completed_at TEXT,
  error_json TEXT,
  sort_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ssh_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  public_key TEXT,
  note TEXT,
  has_passphrase INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sort_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ssh_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT NOT NULL,
  key_id TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sort_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ssh_executions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  server_id TEXT NOT NULL,
  server_name TEXT NOT NULL,
  commands_json TEXT NOT NULL,
  stop_on_error INTEGER NOT NULL,
  timeout_ms INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  error_json TEXT,
  sort_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ssh_command_results (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  command_index INTEGER NOT NULL,
  command TEXT NOT NULL,
  status TEXT NOT NULL,
  stdout TEXT NOT NULL,
  stderr TEXT NOT NULL,
  exit_code INTEGER,
  signal TEXT,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  skipped_reason TEXT,
  sort_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS credential_records (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  encrypted_value_base64 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sort_seq INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  default_model_id TEXT NOT NULL,
  default_output_mode TEXT NOT NULL,
  theme_mode TEXT NOT NULL,
  font_size INTEGER NOT NULL DEFAULT 14,
  updated_at TEXT NOT NULL
);
`

const migrationColumns: Record<string, string[]> = {
  sessions: [
    'provider_id TEXT',
    'model_id TEXT',
    'role_id TEXT',
    'enabled_skill_ids_json TEXT',
    'enabled_tool_ids_json TEXT',
    'allowed_worker_agent_role_ids_json TEXT',
    'max_worker_agent_depth INTEGER',
    'max_worker_agents_per_run INTEGER',
    'unread_completed_at TEXT'
  ],
  agent_runs: [
    'worker_agent_invocation_id TEXT',
    'depth INTEGER'
  ],
  model_providers: [
    'auth_type TEXT',
    'pi_auth_provider TEXT'
  ],
  // Keep worker-agent metadata columns available on legacy databases.
  worker_agent_invocations: [
    'parent_step_id TEXT',
    'parent_tool_call_id TEXT',
    'context_summary TEXT',
    'last_event_at TEXT',
    'role_snapshot_json TEXT'
  ],
  ssh_keys: [
    'public_key TEXT'
  ],
  roles: [
    'description TEXT',
    'default_model_id TEXT',
    'default_model_ref_json TEXT',
    'system_prompt TEXT',
    "allowed_skill_ids_json TEXT NOT NULL DEFAULT '[]'",
    'default_skill_ids_json TEXT',
    'default_tool_ids_json TEXT',
    'can_be_main_agent INTEGER NOT NULL DEFAULT 1',
    'can_be_worker_agent INTEGER NOT NULL DEFAULT 0',
    'can_be_assigned_to_worker_agent INTEGER',
    'worker_agent_guidance TEXT'
  ],
  app_settings: [
    'font_size INTEGER NOT NULL DEFAULT 14'
  ]
}

function columnName(definition: string): string {
  return definition.split(/\s+/, 1)[0] ?? definition
}

function tableColumns(db: Database, table: string): Set<string> {
  const stmt = db.prepare(`PRAGMA table_info(${table})`)
  try {
    const columns = new Set<string>()
    while (stmt.step()) {
      const row = stmt.getAsObject() as { name?: unknown }
      if (typeof row.name === 'string') columns.add(row.name)
    }
    return columns
  } finally {
    stmt.free()
  }
}

export function migrateDatabaseSchema(db: Database): void {
  for (const [table, definitions] of Object.entries(migrationColumns)) {
    const existing = tableColumns(db, table)
    for (const definition of definitions) {
      const name = columnName(definition)
      if (!existing.has(name)) {
        db.run(`ALTER TABLE ${table} ADD COLUMN ${definition}`)
        existing.add(name)
      }
    }
  }

  const roleColumns = tableColumns(db, 'roles')
  if (roleColumns.has('can_be_subagent') && roleColumns.has('can_be_worker_agent')) {
    db.run('UPDATE roles SET can_be_worker_agent = can_be_subagent WHERE can_be_subagent IS NOT NULL')
  }
}
