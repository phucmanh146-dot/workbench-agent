CREATE TABLE IF NOT EXISTS project (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  deadline TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_id_sequence (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  last_id INTEGER NOT NULL
);
INSERT OR IGNORE INTO project_id_sequence(singleton,last_id) VALUES(1,0);
CREATE TABLE IF NOT EXISTS material (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS draft (
  project_id INTEGER PRIMARY KEY REFERENCES project(id),
  revision TEXT NOT NULL,
  body TEXT NOT NULL,
  applied INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS task (
  project_id INTEGER NOT NULL REFERENCES project(id),
  id TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL,
  starts TEXT NOT NULL,
  ends TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (project_id,id)
);
CREATE TABLE IF NOT EXISTS day_slot (
  project_id INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  day TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK(minutes BETWEEN 450 AND 1410),
  ends INTEGER,
  PRIMARY KEY(project_id,task_id,day),
  FOREIGN KEY(project_id,task_id) REFERENCES task(project_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS automatic_slot (
  project_id INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  day TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK(minutes BETWEEN 450 AND 1410),
  PRIMARY KEY(project_id,task_id,day),
  FOREIGN KEY(project_id,task_id) REFERENCES task(project_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS task_progress (
  project_id INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('todo','doing','done')),
  actual_minutes INTEGER CHECK(actual_minutes BETWEEN 0 AND 100000),
  PRIMARY KEY(project_id,task_id),
  FOREIGN KEY(project_id,task_id) REFERENCES task(project_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS task_deadline (
  project_id INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  deadline TEXT NOT NULL,
  PRIMARY KEY(project_id,task_id),
  FOREIGN KEY(project_id,task_id) REFERENCES task(project_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS task_by_parent ON task(project_id,parent_id);
CREATE TABLE IF NOT EXISTS inbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT
);
CREATE TABLE IF NOT EXISTS feishu_source (
  project_id INTEGER NOT NULL REFERENCES project(id),
  token TEXT NOT NULL,
  url TEXT NOT NULL,
  material_id INTEGER NOT NULL REFERENCES material(id),
  PRIMARY KEY(project_id,token)
);
CREATE TABLE IF NOT EXISTS workflow_note (
  project_id INTEGER NOT NULL REFERENCES project(id),
  step TEXT NOT NULL CHECK(step IN ('rules','goal','gap')),
  material_id INTEGER NOT NULL REFERENCES material(id),
  stale INTEGER NOT NULL DEFAULT 0 CHECK(stale IN (0,1)),
  PRIMARY KEY(project_id,step),
  UNIQUE(material_id)
);
CREATE TABLE IF NOT EXISTS assistant_receipt (
  project_id INTEGER NOT NULL REFERENCES project(id),
  batch TEXT NOT NULL,
  PRIMARY KEY(project_id,batch)
);
CREATE TABLE IF NOT EXISTS unassigned_task (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project(id),
  material_id INTEGER REFERENCES material(id),
  title TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fixed_block (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  title TEXT NOT NULL,
  starts INTEGER NOT NULL,
  ends INTEGER NOT NULL,
  CHECK(starts >= 450 AND ends <= 1440 AND starts < ends)
);
CREATE INDEX IF NOT EXISTS fixed_block_day ON fixed_block(day);
CREATE TABLE IF NOT EXISTS knowledge_turn (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES project(id),
  question TEXT NOT NULL,
  attachment TEXT NOT NULL,
  attachment_text TEXT NOT NULL,
  answer TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS knowledge_turn_project ON knowledge_turn(project_id,id);
CREATE TABLE IF NOT EXISTS project_file (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  material_id INTEGER REFERENCES material(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS knowledge_turn_trace (
  turn_id INTEGER PRIMARY KEY REFERENCES knowledge_turn(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  sources TEXT NOT NULL,
  preview TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_rule (
  project_id INTEGER PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS project_goal (
  project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  PRIMARY KEY(project_id,body)
);
CREATE TABLE IF NOT EXISTS project_habit (
  project_id INTEGER PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operation_receipt (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  label TEXT NOT NULL,
  target TEXT NOT NULL,
  day TEXT,
  body TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS operation_receipt_project ON operation_receipt(project_id,id);
CREATE TABLE IF NOT EXISTS material_archive (
  material_id INTEGER PRIMARY KEY REFERENCES material(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  kind TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS execution_archive (
  project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  material_id INTEGER NOT NULL REFERENCES material(id) ON DELETE CASCADE,
  PRIMARY KEY(project_id,day),
  UNIQUE(material_id)
);
CREATE TABLE IF NOT EXISTS task_time_log (
  project_id INTEGER NOT NULL,
  task_id TEXT NOT NULL,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  minutes INTEGER NOT NULL CHECK(minutes BETWEEN 1 AND 1440),
  PRIMARY KEY(project_id,task_id,day),
  FOREIGN KEY(project_id,task_id) REFERENCES task(project_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS capability_profile (
  project_id INTEGER PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
  body TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS day_buffer (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  title TEXT NOT NULL,
  task_id TEXT,
  minutes INTEGER NOT NULL,
  important INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'waiting',
  discarded_at TEXT,
  note TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS interruption (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  title TEXT NOT NULL,
  task_id TEXT,
  scene TEXT NOT NULL,
  started INTEGER NOT NULL,
  remaining_seconds INTEGER NOT NULL,
  checkpoint TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  resolution TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS one_unfinished_interruption_per_day
  ON interruption(day) WHERE state IN ('active','resuming');
DROP INDEX IF EXISTS one_active_interruption;
CREATE TABLE IF NOT EXISTS buffer_window (
  day TEXT PRIMARY KEY,
  starts INTEGER NOT NULL,
  ends INTEGER NOT NULL
);
