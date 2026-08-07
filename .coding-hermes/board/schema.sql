
CREATE TABLE IF NOT EXISTS board (
    project         VARCHAR PRIMARY KEY,
    namespace       VARCHAR NOT NULL,
    version         INTEGER DEFAULT 2,
    last_tick       TIMESTAMP,
    ticks_total     INTEGER DEFAULT 0,
    ticks_idle      INTEGER DEFAULT 0,
    cooldown_s      INTEGER DEFAULT 900,
    service_port    INTEGER,
    service_url     VARCHAR,
    health_endpoint VARCHAR,
    git_branch      VARCHAR DEFAULT 'main',
    git_remote      VARCHAR DEFAULT 'origin',
    last_commit     VARCHAR,
    updated_at      TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
    id                VARCHAR PRIMARY KEY,
    title             VARCHAR NOT NULL,
    status            VARCHAR NOT NULL DEFAULT 'pending',
    priority          VARCHAR NOT NULL DEFAULT 'P2',
    complexity        TINYINT NOT NULL DEFAULT 3,
    depends_on        VARCHAR[],
    blocks            VARCHAR[],
    primary_model     VARCHAR,
    primary_provider  VARCHAR,
    fallback_model    VARCHAR,
    fallback_provider VARCHAR,
    reasoning         VARCHAR,
    capability_tags   VARCHAR[],
    worker_status     VARCHAR DEFAULT 'pending',
    dispatched_at     TIMESTAMP,
    completed_at      TIMESTAMP,
    attempts          TINYINT DEFAULT 0,
    exit_code         INTEGER,
    commit_hash       VARCHAR,
    files_changed     VARCHAR[],
    lines_added       INTEGER DEFAULT 0,
    lines_removed     INTEGER DEFAULT 0,
    guard_result      VARCHAR,
    ci_result         VARCHAR,
    worker_summary    VARCHAR,
    foreman_note      VARCHAR,
    blocked_reason    VARCHAR,
    review_notes      VARCHAR,
    created_at        TIMESTAMP DEFAULT now(),
    updated_at        TIMESTAMP DEFAULT now(),
    blocked_since     TIMESTAMP,
);

CREATE TABLE IF NOT EXISTS fixtures (
    id          VARCHAR PRIMARY KEY,
    title       VARCHAR NOT NULL,
    description VARCHAR,
    active      BOOLEAN DEFAULT true,
    created_at  TIMESTAMP DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
    id          BIGINT PRIMARY KEY,
    timestamp   TIMESTAMP DEFAULT now(),
    event_type  VARCHAR NOT NULL,
    task_id     VARCHAR,
    actor       VARCHAR NOT NULL,
    detail      VARCHAR,
    tick_number INTEGER
);

CREATE SEQUENCE IF NOT EXISTS events_id_seq START 1;

-- Fixtures (never-completed perpetual tasks)
INSERT OR IGNORE INTO fixtures (id, title, description) VALUES
    ('NEVER-DONE', '11-point perpetual audit', 'coding-hermes-never-done: spec, docs, tests, deps, pitfalls, perf, endpoints, CI, DuckBrain, quality, wiring'),
    ('E2E-001', 'E2E Testing Tick', 'Self-improving loop. Load coding-hermes-testing for F2B/B2F prompts.'),
    ('GITREINS-JUDGE', 'LLM evaluator config', 'GitReins tier2 evaluator configured.');
