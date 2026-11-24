import { useId, useSyncExternalStore } from "react";
import { onLocaleChange, translate } from "@/i18n/runtime";
import Badge from "./Badge";
import Select from "./Select";

const allProjectsLabel = () => translate("All projects");

export function ProjectFilter({ keys, value, onChange, stacked = false }) {
  const id = useId();
  const allProjects = useSyncExternalStore(onLocaleChange, allProjectsLabel, () => "All projects");
  const projects = [...new Set(keys.map((key) => key.project).filter(Boolean))].sort();
  // Select reserves the empty value for its disabled placeholder.
  const options = ["", ...projects].map((project) => ({
    value: `project:${project}`,
    label: project || allProjects,
  }));

  return (
    <div className={stacked ? "flex min-w-0 flex-col gap-1.5" : "mb-3 flex flex-wrap items-center gap-2"}>
      <label htmlFor={id} className="text-sm font-medium">
        Project
      </label>
      <Select
        id={id}
        data-i18n-skip
        placeholder=""
        selectClassName="[&>option:first-child]:hidden"
        options={options}
        value={`project:${value}`}
        onChange={(event) => onChange(event.target.value.slice("project:".length))}
      />
    </div>
  );
}

export function ProjectBadge({ project }) {
  return project ? (
    <Badge size="sm" variant="primary">
      <span data-i18n-skip>{project}</span>
    </Badge>
  ) : null;
}
