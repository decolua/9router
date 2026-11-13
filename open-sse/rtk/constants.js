// RTK port constants (mirror Rust defaults)
export const RAW_CAP = 10 * 1024 * 1024;      // 10 MiB
export const MIN_COMPRESS_SIZE = 500;          // bytes; skip tiny blobs
export const HEADROOM_TOOL_OUTPUT_MAX_DEPTH = 8; // bound native tool-output traversal
export const DETECT_WINDOW = 1024;             // autodetect peeks first N chars
export const GIT_DIFF_HUNK_MAX_LINES = 100;    // per-hunk line cap (compact_diff max_hunk_lines)
export const GIT_DIFF_MAX_LINES = 500;         // whole-diff line cap (rtk git diff default)
export const GIT_DIFF_CONTEXT_KEEP = 3;        // leading context lines kept per hunk (max_leading_context)
export const GIT_DIFF_CONTEXT_BUDGET_DIVISOR = 10; // diff-wide leading-context budget = max_lines / N
export const GIT_LOG_MAX_COMMITS = 50;         // gitLog commit cap (pipe_cmd git_log_wrapper limit)
export const GIT_LOG_BODY_LINES = 3;           // commit body lines kept per commit
export const DEDUP_MIN_RUN = 3;                // engine dedup: collapse runs of >= N identical lines
export const DEDUP_LINE_MAX = 2000;            // dedupLog truncation cap (9router safeguard)

// Rust pipe_cmd.rs parity caps
export const GREP_PER_FILE_MAX = 10;           // match rust: matches.iter().take(10)
export const FIND_PER_DIR_MAX = 10;            // match rust: files.iter().take(10)
export const FIND_TOTAL_DIR_MAX = 20;          // match rust: dirs.iter().take(20)

// ls compact_ls (rtk/src/cmds/system/ls.rs)
export const LS_INVENTORY_MAX = 50;            // CAP_INVENTORY: max listing lines shown
export const LS_NOISE_DIRS = [
  "node_modules", ".git", "target", "__pycache__",
  ".next", "dist", "build", ".cache", ".turbo",
  ".vercel", ".pytest_cache", ".mypy_cache", ".tox",
  ".venv", "venv",
  "env", // Python legacy virtualenv; .env (dotenv) intentionally excluded
  "coverage", ".nyc_output", ".DS_Store", "Thumbs.db",
  ".idea", ".vscode", ".vs", "*.egg-info", ".eggs"
];

// tree filter_tree_output cap (no rust cap, we add one to be safe)
export const TREE_MAX_LINES = 200;

// Cursor Glob "Result of search in '...' (total N files):" list
export const SEARCH_LIST_PER_DIR_MAX = 10;
export const SEARCH_LIST_TOTAL_DIR_MAX = 20;

// Smart truncate (port of text::smart_truncate)
export const SMART_TRUNCATE_MAX_LINES = 300;   // line budget (engine truncate MAX_LINES)
export const SMART_TRUNCATE_MIN_LINES = 300;   // autodetect gate (matches the line budget)

// Test-runner filters (tsc / vitest / phpunit)
export const TSC_MESSAGE_MAX_CHARS = 120;       // per-diagnostic message cap
export const VITEST_MAX_FAILURES = 5;           // compact view failure cap
export const PHPUNIT_MAX_FAILURES = 10;         // failure blocks shown
export const PHPUNIT_MAX_DETAIL_LINES = 2;      // detail lines kept per failure

// readNumbered (files with "  N|content" lines, e.g. Cursor read_file)
export const READ_NUMBERED_MIN_HIT_RATIO = 0.7;
export const READ_NUMBERED_HEAD = 120;          // lines kept from top
export const READ_NUMBERED_TAIL = 60;           // lines kept from bottom
export const READ_NUMBERED_MIN_LINES = 250;     // only truncate above this

// Filter name strings (Rust parity + JS extras)
export const FILTERS = {
  GIT_DIFF: "git-diff",
  GIT_STATUS: "git-status",
  GIT_LOG: "git-log",
  GREP: "grep",
  FIND: "find",
  LS: "ls",
  TREE: "tree",
  DEDUP_LOG: "dedup-log",
  SMART_TRUNCATE: "smart-truncate",
  READ_NUMBERED: "read-numbered",
  SEARCH_LIST: "search-list",
  BUILD_OUTPUT: "build-output",
  TSC: "tsc",
  VITEST: "vitest",
  PHPUNIT: "phpunit"
};
