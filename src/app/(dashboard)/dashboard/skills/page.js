"use client";

import { Card, Badge } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import {
  SKILLS,
  SKILLS_REPO_URL,
  getSkillRawUrl,
  getSkillBlobUrl,
} from "@/shared/constants/skills";

const SKILL_GLYPHS = {
  hub: "account_tree",
  chat: "forum",
  image: "photo_library",
  record_voice_over: "graphic_eq",
  mic: "hearing",
  scatter_plot: "schema",
  search: "manage_search",
  language: "travel_explore",
};

function CopyButton({ value, label = "Copy link" }) {
  const { copied, copy } = useCopyToClipboard(2000);
  return (
    <button
      onClick={() => copy(value)}
      className="min-h-9 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 transition-colors cursor-pointer shrink-0 inline-flex items-center gap-1.5"
      title={value}
    >
      <span className="material-symbols-outlined text-[12px]">
        {copied ? "task_alt" : "file_copy"}
      </span>
      {copied ? "Copied!" : label}
    </button>
  );
}

function SkillRow({ skill }) {
  const url = getSkillRawUrl(skill.id);
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
        <span className="material-symbols-outlined text-[18px]">{SKILL_GLYPHS[skill.icon] || "auto_awesome_motion"}</span>
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
          href={getSkillBlobUrl(skill.id)}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-text-muted hover:text-primary mt-1 inline-flex items-center gap-1 break-all"
        >
          {url}
          <span className="material-symbols-outlined text-[12px]">arrow_outward</span>
        </a>
      </div>

      <CopyButton value={url} />
    </div>
  );
}

export default function SkillsPage() {
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Card padding="md" className="rounded-2xl border-primary/20">
        <div className="text-xs font-semibold tracking-wide text-text-muted mb-3">START HERE · Paste this to your AI</div>
        <div className="px-3 py-3 rounded-xl bg-surface-2 font-mono text-xs sm:text-sm text-text-main break-all">
          Read this skill and use it: {getSkillRawUrl("9router")}
        </div>
      </Card>

      <div className="space-y-3">
        {SKILLS.map((skill) => (
          <SkillRow key={skill.id} skill={skill} />
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
            href={`${SKILLS_REPO_URL}/tree/master/skills`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">arrow_outward</span>
            View on GitHub
          </a>
        </div>
      </Card>
    </div>
  );
}
