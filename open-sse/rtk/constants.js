// RTK port constants (mirror Rust defaults)
export const RAW_CAP = 10 * 1024 * 1024;      // 10 MiB
export const MIN_COMPRESS_SIZE = 500;          // bytes; skip tiny blobs
export const DETECT_WINDOW = 1024;             // autodetect peeks first N chars
export const GIT_DIFF_HUNK_MAX_LINES = 100;    // per-hunk line cap
export const GIT_DIFF_CONTEXT_KEEP = 3;        // context lines around changes
export const DEDUP_LINE_MAX = 2000;            // dedupLog truncation cap

// Rust pipe_cmd.rs parity caps
export const GREP_PER_FILE_MAX = 10;           // match rust: matches.iter().take(10)
export const FIND_PER_DIR_MAX = 10;            // match rust: files.iter().take(10)
export const FIND_TOTAL_DIR_MAX = 20;          // match rust: dirs.iter().take(20)

// git status caps (rust config::limits())
export const STATUS_MAX_FILES = 10;            // config::limits().status_max_files
export const STATUS_MAX_UNTRACKED = 10;        // config::limits().status_max_untracked

// ls compact_ls (rtk/src/cmds/system/ls.rs)
export const LS_EXT_SUMMARY_TOP = 5;           // top-N extensions in summary
export const LS_NOISE_DIRS = [
  "node_modules", ".git", "target", "__pycache__",
  ".next", "dist", "build", ".venv", "venv",
  ".cache", ".idea", ".vscode", ".DS_Store"
];

// tree filter_tree_output cap (no rust cap, we add one to be safe)
export const TREE_MAX_LINES = 200;

// Cursor Glob "Result of search in '...' (total N files):" list
export const SEARCH_LIST_PER_DIR_MAX = 10;
export const SEARCH_LIST_TOTAL_DIR_MAX = 20;

// Smart truncate (port of filter.rs smart_truncate fallback)
export const SMART_TRUNCATE_HEAD = 120;        // lines kept from top
export const SMART_TRUNCATE_TAIL = 60;         // lines kept from bottom
export const SMART_TRUNCATE_MIN_LINES = 250;   // only kick in above this

// readNumbered (files with "  N|content" lines, e.g. Cursor read_file)
export const READ_NUMBERED_MIN_HIT_RATIO = 0.7;

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
  SEARCH_LIST: "search-list"
};
