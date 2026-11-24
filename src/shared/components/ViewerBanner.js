export default function ViewerBanner({ role }) {
  if (role !== "viewer") return null;

  return (
    <div
      role="status"
      className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-6 py-2 text-sm font-medium text-text-main"
    >
      <span aria-hidden="true" className="material-symbols-outlined text-[18px] text-warning">
        visibility
      </span>
      <span>Read-only access</span>
    </div>
  );
}
