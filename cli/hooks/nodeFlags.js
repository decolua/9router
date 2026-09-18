/**
 * Node flags for the spawned next-server child.
 *
 * Node reads NODE_OPTIONS first and lets command-line flags win, so a
 * hard-coded --max-old-space-size on the spawn line silently overrides
 * whatever the operator configured. Where a cgroup limit applies (systemd
 * MemoryMax, docker --memory, k8s), the child then runs believing it has
 * several GB of heap: GC never feels pressure, RSS climbs to the ceiling, and
 * the kernel OOM-kills next-server mid-stream — taking in-flight streaming
 * responses with it (#3365).
 *
 * The default stays as it was, for the desktop case it was raised for. It just
 * steps aside once the operator has said what they want.
 */

const DEFAULT_MAX_OLD_SPACE_MB = 6144;

// Node accepts the underscore spelling of V8 flags too (--max_old_space_size).
const HEAP_FLAG_PATTERN = /(^|\s)--max[-_]old[-_]space[-_]size(=|\s|$)/;

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string[]} heap flags to pass to the child, possibly empty
 */
function resolveHeapFlags(env = process.env) {
  const explicit = String(env.NINEROUTER_MAX_OLD_SPACE_SIZE ?? "").trim();
  if (explicit) {
    // 0 hands the decision back to node, which sizes the heap from the memory
    // it can actually see — the right answer inside a container.
    if (explicit === "0") return [];
    const megabytes = Number(explicit);
    if (Number.isInteger(megabytes) && megabytes > 0) {
      return [`--max-old-space-size=${megabytes}`];
    }
    console.warn(
      `[9router] ignoring NINEROUTER_MAX_OLD_SPACE_SIZE="${explicit}": expected a positive integer (MB) or 0`,
    );
  }

  // Already set in NODE_OPTIONS: leave it alone, otherwise the spawn line
  // would win and the setting would look ignored.
  if (HEAP_FLAG_PATTERN.test(String(env.NODE_OPTIONS ?? ""))) return [];

  return [`--max-old-space-size=${DEFAULT_MAX_OLD_SPACE_MB}`];
}

module.exports = { resolveHeapFlags, DEFAULT_MAX_OLD_SPACE_MB };
