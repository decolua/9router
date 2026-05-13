import { Card, Badge } from "@/shared/components";
import CopyButton from "@/shared/components/CopyButton.client";
import {
  SKILLS,
  SKILLS_REPO_URL,
  SKILLS_BLOB_BASE,
  getSkillRawUrl,
} from "@/shared/constants/skills";

const REPO = SKILLS_REPO_URL.replace("https://github.com/", "");
const blobPath = SKILLS_BLOB_BASE.replace(`https://github.com/${REPO}/blob/`, "");
const [BRANCH, SKILL_PATH] = blobPath.split("/");
const GITHUB_API_BRANCH = `https://api.github.com/repos/${REPO}/git/ref/heads/${BRANCH}`;

async function getGithackData() {
  try {
    const res = await fetch(GITHUB_API_BRANCH, { next: { revalidate: 3600 } });
    if (!res.ok) throw new Error("Failed to fetch SHA");
    
    const data = await res.json();
    const sha = data.object.sha;
    const baseUrl = `https://rawcdn.githack.com/${REPO}/${sha}/${SKILL_PATH}`;
    
    const entrySkill = SKILLS.find((s) => s.isEntry);
    const topSkillUrl = entrySkill ? `${baseUrl}/${entrySkill.id}/SKILL.md` : "";

    return { baseUrl, topSkillUrl };
  } catch {
    const baseUrl = `https://rawcdn.githack.com/${REPO}/${BRANCH}/${SKILL_PATH}`;
    const entrySkill = SKILLS.find((s) => s.isEntry);
    const topSkillUrl = entrySkill ? getSkillRawUrl(entrySkill.id) : "";

    return { baseUrl, topSkillUrl };
  }
}

function SkillRow({ skill, githackBaseUrl }) {
  const githackUrl = `${githackBaseUrl}/${skill.id}/SKILL.md`;

  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-[14px] border shadow-[var(--shadow-soft)] transition-colors ${
        skill.isEntry
          ? "border-brand-500/40 bg-brand-500/5"
          : "border-border-subtle bg-surface hover:bg-surface-2"
      }`}
    >
      <div
        className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${
          skill.isEntry ? "bg-primary text-white" : "bg-primary/10 text-primary"
        }`}
      >
        <span className="material-symbols-outlined text-[18px]">{skill.icon}</span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-sm text-text-main">{skill.name}</h3>
          {skill.isEntry && (
            <Badge variant="primary" size="sm">START HERE</Badge>
          )}
          {skill.endpoint && (
            <Badge variant="default" size="sm">
              <code className="text-[10px]">{skill.endpoint}</code>
            </Badge>
          )}
        </div>
        <p className="text-xs text-text-muted mt-0.5">{skill.description}</p>
        <a
          href={githackUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-text-muted hover:text-primary mt-1 inline-flex items-center gap-1 break-all"
        >
          {githackUrl}
          <span className="material-symbols-outlined text-[12px]">open_in_new</span>
        </a>
      </div>

      <CopyButton value={githackUrl} />
    </div>
  );
}

export default async function SkillsPage() {
  const { baseUrl: githackBaseUrl, topSkillUrl } = await getGithackData();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card padding="md">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-text-muted mb-2">Paste this to your AI:</div>
            <div className="px-3 py-2 rounded bg-surface-2 font-mono text-[12px] text-text-main break-all">
              Read this skill and use it: {topSkillUrl}
            </div>
          </div>
          <CopyButton value={topSkillUrl} label="Copy" />
        </div>
      </Card>

      <div className="space-y-2">
        {SKILLS.map((skill) => (
          <SkillRow key={skill.id} skill={skill} githackBaseUrl={githackBaseUrl} />
        ))}
      </div>

      <Card padding="md">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-text-main">More on GitHub</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Browse source, README, and examples.
            </p>
          </div>
          <a
            href={`${SKILLS_REPO_URL}/tree/${BRANCH}/${SKILL_PATH}`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
            View on GitHub
          </a>
        </div>
      </Card>
    </div>
  );
}