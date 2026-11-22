"use client";

export default function AnimatedBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10"
      style={{
        backgroundColor: "var(--color-bg)",
        backgroundImage: "radial-gradient(circle, rgba(25, 24, 23, 0.14) 0.8px, transparent 1px)",
        backgroundSize: "20px 20px",
      }}
    />
  );
}
