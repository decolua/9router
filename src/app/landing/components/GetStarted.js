"use client";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

const steps = [
  ["01", "Install 9Router", "Run one command to start the server instantly.", "bg-[#ff7657]"],
  ["02", "Connect providers", "Add providers and API keys in the web dashboard.", "bg-[#83d8e8]"],
  ["03", "Route requests", "Point your CLI tools to http://localhost:20128.", "bg-[#c8ee68]"],
];

export default function GetStarted() {
  const { copied, copy } = useCopyToClipboard();
  const handleCopy = (text) => copy(text, "landing");
  return (
    <section id="get-started" className="border-y-2 border-[#191817] bg-[#eee4d2] px-6 py-16 md:py-24">
      <div className="mx-auto max-w-7xl">
        <div className="mb-10 flex flex-col gap-6 border-b-2 border-[#191817] pb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <span className="inline-block border-2 border-[#191817] bg-[#ffd45c] px-3 py-1 text-xs font-extrabold uppercase tracking-[0.12em] shadow-[3px_3px_0_#191817]">Quick start / 03 steps</span>
            <h2 className="mt-5 max-w-2xl text-4xl font-black leading-[1.05] tracking-tight md:text-6xl">From zero to routed in <span className="underline decoration-[#ff7657] decoration-8 underline-offset-4">30 seconds.</span></h2>
          </div>
          <p className="max-w-md text-base font-medium leading-relaxed text-[#514c43] md:text-lg">One endpoint for your AI tools. Install once, configure in the dashboard, and keep building.</p>
        </div>
        <div className="grid items-stretch gap-6 lg:grid-cols-2">
          <div className="grid auto-rows-fr gap-4 sm:grid-cols-3 lg:grid-cols-1">
            {steps.map(([number, title, description, tone]) => (
              <article className="flex min-h-36 items-start gap-4 border-2 border-[#191817] bg-[#fffdf8] p-5 shadow-[5px_5px_0_#191817] md:p-6" key={number}>
                <span className={`flex size-12 shrink-0 items-center justify-center border-2 border-[#191817] ${tone} text-lg font-black shadow-[3px_3px_0_#191817]`}>{number}</span>
                <div><h3 className="text-lg font-black md:text-xl">{title}</h3><p className="mt-2 text-sm leading-relaxed text-[#514c43]">{description}</p></div>
              </article>
            ))}
          </div>
          <div className="flex min-w-0 flex-col overflow-hidden border-2 border-[#191817] bg-[#191817] text-[#fffdf8] shadow-[6px_6px_0_#191817]">
            <div className="flex items-center gap-2 border-b-2 border-[#191817] bg-[#ff7657] px-4 py-3 text-[#191817]">
              <span className="size-3 border-2 border-[#191817] bg-[#eb5360]" /><span className="size-3 border-2 border-[#191817] bg-[#ffd45c]" /><span className="size-3 border-2 border-[#191817] bg-[#c8ee68]" />
              <span className="ml-2 font-mono text-xs font-bold uppercase tracking-wider">terminal / 9router</span><span className="ml-auto font-mono text-[10px] font-bold uppercase">ready</span>
            </div>
            <div className="flex flex-1 flex-col justify-center overflow-x-auto p-5 font-mono text-xs leading-relaxed sm:p-7 sm:text-sm">
              <button type="button" className="group mb-5 flex w-full items-center gap-2 text-left" onClick={() => handleCopy("npx 9router")} aria-label="Copy npx 9router command">
                <span className="text-[#c8ee68]">$</span><span>npx 9router</span><span className="ml-auto text-xs text-[#c6b5ff] opacity-100 sm:opacity-0 sm:group-hover:opacity-100">{copied === "landing" ? "Copied" : "Copy"}</span>
              </button>
              <div className="mb-6 text-[#eee4d2]"><span className="text-[#ff7657]">&gt;</span> Starting 9Router...<br /><span className="text-[#ff7657]">&gt;</span> Server running on <span className="text-[#83d8e8]">http://localhost:20128</span><br /><span className="text-[#ff7657]">&gt;</span> Dashboard: <span className="text-[#83d8e8]">http://localhost:20128/dashboard</span><br /><span className="text-[#c8ee68]">&gt;</span> Ready to route!</div>
              <div className="mb-4 border-t-2 border-[#777064] pt-4 text-xs text-[#c9c1b3]"><span className="material-symbols-outlined align-[-2px] text-[12px] leading-none">tune</span> Configure providers in dashboard or use environment variables</div>
              <div className="text-xs text-[#c9c1b3]"><span className="font-bold text-[#c6b5ff]">Data Location:</span><br />macOS/Linux: ~/.9router/db/data.sqlite<br />Windows: %APPDATA%/9router/db/data.sqlite</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
