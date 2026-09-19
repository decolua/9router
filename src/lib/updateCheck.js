// Update detection for the running install. The app is usually a git checkout,
// so the real question is "how many commits is this checkout behind
// serenhope/9router master". Both GitHub lookups are cached in process for an
// hour, and every failure path resolves to null so a blocked network never
// breaks the dashboard. When no local revision can be determined (image built
// without git history), set APP_REVISION=<sha> at build time.
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { GITHUB_CONFIG, UPDATER_CONFIG } from "@/shared/constants/config";

const API = "https://api.github.com";
const CHECK_TTL_MS = 3600000; // one successful lookup per hour
const FAILURE_TTL_MS = 300000; // a failed lookup is retried after 5 minutes
const MAX_PAYLOAD = 2 * 1024 * 1024; // never buffer a runaway response
const GIT_UPDATE_CMD = "git pull --ff-only && npm install && npm run build";

const cache = (global.__updateCheck ??= { info: null, fetchedAt: 0, revision: undefined, gitInstall: undefined });

function githubJson(endpoint) {
  return new Promise((resolve) => {
    const req = https.get(`${API}${endpoint}`, {
      timeout: 5000,
      headers: {
        "User-Agent": "9Router-App",
        Accept: "application/vnd.github.v3+json",
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
    }, (res) => {
      let data = "";
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_PAYLOAD) {
          req.destroy();
          resolve(null);
          return;
        }
        data += chunk;
      });
      res.on("end", () => {
        if (res.statusCode !== 200) return resolve(null);
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function readGitRevision() {
  if (cache.gitInstall !== undefined) return Promise.resolve(cache.gitInstall ? cache.revision : null);
  return new Promise((resolve) => {
    const repoDir = path.join(process.cwd(), ".git");
    const finish = (isGit, revision) => {
      cache.gitInstall = isGit;
      cache.revision = revision;
      resolve(isGit ? revision : null);
    };
    if (!existsSync(repoDir)) return finish(false, null);
    execFile("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), timeout: 4000 }, (error, stdout) => {
      const sha = String(stdout || "").trim();
      finish(!error && /^[0-9a-f]{40}$/.test(sha), error ? null : sha);
    });
  });
}

// Which commit master points at right now.
async function fetchRemoteHead() {
  const data = await githubJson(`/repos/${GITHUB_CONFIG.apiRepo}/commits/${GITHUB_CONFIG.branch}?per_page=1`);
  const sha = data?.sha;
  if (!sha) return null;
  return {
    sha,
    message: String(data?.commit?.message || "").split("\n")[0],
    date: data?.commit?.committer?.date || data?.commit?.author?.date || "",
  };
}

// How many commits the branch has that this checkout does not. GitHub's compare
// reads `ahead_by` from the base (our checkout) toward the head (master), so
// ahead_by is exactly "how far behind the repository we are". An unknown or
// unpublished local sha answers null, and the caller falls back to comparing shas.
async function fetchPending(localSha) {
  const data = await githubJson(`/repos/${GITHUB_CONFIG.apiRepo}/compare/${localSha}...${GITHUB_CONFIG.branch}?per_page=1`);
  if (!data || !["behind", "ahead", "diverged", "identical"].includes(data.status)) return null;
  return { status: data.status, pendingBy: Number(data.ahead_by) || 0 };
}

export async function getUpdateInfo(currentVersion) {
  const localSha = process.env.APP_REVISION || await readGitRevision();
  const ttl = cache.info && !cache.info.lookupFailed ? CHECK_TTL_MS : FAILURE_TTL_MS;
  if (cache.info && Date.now() - cache.fetchedAt < ttl) {
    return { ...cache.info, currentVersion, checkedAt: cache.fetchedAt };
  }

  const head = await fetchRemoteHead();
  cache.fetchedAt = Date.now();
  if (!head) {
    // Nothing was reachable: say so instead of claiming the app is current.
    cache.info = { ...(cache.info || {}), lookupFailed: true, hasUpdate: false };
    return { ...cache.info, currentVersion, checkedAt: cache.fetchedAt };
  }

  const compare = localSha && localSha !== head.sha ? await fetchPending(localSha) : null;
  const behindBy = localSha === head.sha ? 0 : compare ? compare.pendingBy : null;
  const info = {
    lookupFailed: false,
    latestVersion: `git-${head.sha.slice(0, 7)}`,
    latestRevision: head.sha,
    commitMessage: head.message,
    publishedAt: head.date,
    // Without a local revision nothing can be claimed, only reported.
    revisionKnown: Boolean(localSha),
    currentRevision: localSha ? localSha.slice(0, 7) : null,
    behindBy,
    hasUpdate: behindBy === null ? Boolean(localSha) && localSha !== head.sha : behindBy > 0,
    installCmd: cache.gitInstall === false && !process.env.APP_REVISION
      ? UPDATER_CONFIG.installCmdLatest
      : GIT_UPDATE_CMD,
  };
  cache.info = info;
  cache.fetchedAt = Date.now();
  return { ...info, currentVersion, checkedAt: cache.fetchedAt };
}
