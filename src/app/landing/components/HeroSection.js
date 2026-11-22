"use client";
export default function HeroSection() {
  return (
    <section className="relative flex min-h-[82vh] items-center overflow-hidden px-6 pb-12 pt-32 md:min-h-[88vh] md:pt-36">
      <div className="pointer-events-none absolute -right-10 top-32 hidden h-72 w-72 rotate-12 border-2 border-[#191817] bg-[#c6b5ff] shadow-[8px_8px_0_#191817] lg:block" />
      <div className="relative z-10 mx-auto grid w-full max-w-7xl items-center gap-12 lg:grid-cols-[1.15fr_.85fr]">
        <div className="max-w-3xl">
          <h1 className="text-5xl font-black leading-[.98] tracking-[-0.055em] text-[#191817] sm:text-6xl md:text-7xl xl:text-[5.5rem]">Every AI tool.<br /><span className="mt-3 inline-block -rotate-1 border-2 border-[#191817] bg-[#ff7657] px-3 py-2 text-[#191817] shadow-[6px_6px_0_#191817]">One endpoint.</span></h1>
          <p className="mt-8 max-w-2xl text-lg font-medium leading-relaxed text-[#514c43] md:text-xl">A self-hosted AI proxy with a web dashboard. Connect providers once, then use Claude Code, OpenAI Codex, Cline, RooCode, and more through a single API.</p>
          <div className="mt-9 flex flex-col gap-4 sm:flex-row">
            <a href="/dashboard" className="flex h-14 items-center justify-center gap-2 border-2 border-[#191817] bg-[#ff7657] px-7 text-base font-extrabold text-[#191817] shadow-[5px_5px_0_#191817] transition-transform hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[3px_3px_0_#191817]"><span className="material-symbols-outlined">login</span> Open dashboard <span>→</span></a>
            <a href="https://github.com/serenhope/9router" target="_blank" rel="noopener noreferrer" className="flex h-14 items-center justify-center gap-2 border-2 border-[#191817] bg-[#fffdf8] px-7 text-base font-extrabold text-[#191817] shadow-[5px_5px_0_#191817] transition-transform hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[3px_3px_0_#191817]"><span className="material-symbols-outlined">terminal</span> Explore on GitHub ↗</a>
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-lg lg:ml-auto">
          <div className="absolute -right-3 -top-4 z-10 rotate-6 border-2 border-[#191817] bg-[#ffd45c] px-4 py-2 font-mono text-xs font-black shadow-[3px_3px_0_#191817]">ROUTE / REQUEST</div>
          <div className="border-2 border-[#191817] bg-[#fffdf8] shadow-[8px_8px_0_#191817]">
            <div className="flex items-center justify-between border-b-2 border-[#191817] bg-[#83d8e8] px-4 py-3"><span className="font-mono text-xs font-black uppercase tracking-wider">request pipeline</span><span className="border-2 border-[#191817] bg-[#c8ee68] px-2 py-1 font-mono text-[10px] font-bold">LIVE</span></div>
            <div className="space-y-3 p-5 font-mono text-xs sm:p-7 sm:text-sm">
              <div className="border-2 border-[#191817] bg-[#eee4d2] p-4"><span className="text-[10px] font-bold uppercase tracking-widest text-[#514c43]">Your app</span><div className="mt-2 font-bold">Claude Code <span className="text-[#b83b26]">/</span> Cline <span className="text-[#b83b26]">/</span> Codex</div></div>
              <div className="flex items-center gap-3 pl-5"><span className="h-5 border-l-2 border-dashed border-[#191817]"/><span className="text-[10px] font-bold uppercase">one API route ↓</span></div>
              <div className="border-2 border-[#191817] bg-[#191817] p-4 text-[#fffdf8] shadow-[4px_4px_0_#191817]"><span className="text-[10px] font-bold uppercase tracking-widest text-[#c8ee68]">9Router</span><div className="mt-2 font-bold">localhost:20128/v1</div></div>
              <div className="flex items-center gap-3 pl-5"><span className="h-5 border-l-2 border-dashed border-[#191817]"/><span className="text-[10px] font-bold uppercase">pick provider ↓</span></div>
              <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-black"><div className="border-2 border-[#191817] bg-[#ff7657] p-3">ANTHROPIC</div><div className="border-2 border-[#191817] bg-[#c6b5ff] p-3">OPENAI</div><div className="border-2 border-[#191817] bg-[#ffd45c] p-3">GEMINI</div></div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
