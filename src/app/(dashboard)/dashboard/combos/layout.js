import ComboCircuitBreakerPanel from "./ComboCircuitBreakerPanel";

export default function CombosLayout({ children }) {
  return (
    <div className="flex flex-col gap-6">
      {children}
      <ComboCircuitBreakerPanel />
    </div>
  );
}
