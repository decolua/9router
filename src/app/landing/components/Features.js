"use client";

const FEATURES = [
  { icon: "route", title: "Unified Endpoint", desc: "Access all providers via a single standard API URL.", tone: "bg-[#d9f2f4]", iconTone: "bg-[#83d8e8]" },
  { icon: "speed", title: "Easy Setup", desc: "Get up and running in minutes with npx command.", tone: "bg-[#fff1bf]", iconTone: "bg-[#ffd45c]" },
  { icon: "autorenew", title: "Model Fallback", desc: "Automatically switch providers on failure or high latency.", tone: "bg-[#ffe4df]", iconTone: "bg-[#ff7657]" },
  { icon: "analytics", title: "Usage Tracking", desc: "Detailed analytics and cost monitoring across all models.", tone: "bg-[#e9e2ff]", iconTone: "bg-[#c6b5ff]" },
  { icon: "vpn_key", title: "OAuth & API Keys", desc: "Securely manage credentials in one vault.", tone: "bg-[#e7f3c9]", iconTone: "bg-[#c8ee68]" },
  { icon: "sync_alt", title: "Cloud Sync", desc: "Sync your configurations across devices instantly.", tone: "bg-[#d9f2f4]", iconTone: "bg-[#83d8e8]" },
  { icon: "code_blocks", title: "CLI Support", desc: "Works with Claude Code, Codex, Cline, Cursor, and more.", tone: "bg-[#fff1bf]", iconTone: "bg-[#ffd45c]" },
  { icon: "query_stats", title: "Dashboard", desc: "Visual dashboard for real-time traffic analysis.", tone: "bg-[#ffe4df]", iconTone: "bg-[#ff7657]" },
];

export default function Features() {
  return (
    <section className="py-24 px-6" id="features">
      <div className="max-w-7xl mx-auto">
        <div className="mb-12">
          <span className="inline-block border-2 border-[#191817] bg-[#c8ee68] px-3 py-1 text-xs font-extrabold uppercase tracking-[0.12em] shadow-[3px_3px_0_#191817]">Built to route</span>
          <h2 className="mt-5 text-3xl md:text-4xl font-black mb-4">Powerful Features</h2>
          <p className="text-[#514c43] max-w-xl text-lg font-medium">
            Everything you need to manage your AI infrastructure in one place, built for scale.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {FEATURES.map((feature, index) => (
            <article
              key={feature.title}
              className={`group min-h-52 border-2 border-[#191817] p-6 ${feature.tone} shadow-[4px_4px_0_#191817] transition-transform duration-150 hover:-translate-y-1 hover:shadow-[6px_6px_0_#191817] ${index % 2 ? "rotate-[0.3deg]" : "-rotate-[0.3deg]"}`}
            >
              <div className={`mb-5 flex size-11 items-center justify-center border-2 border-[#191817] ${feature.iconTone} text-[#191817] shadow-[2px_2px_0_#191817] transition-transform group-hover:-rotate-3 group-hover:scale-105`}>
                <span className="material-symbols-outlined">{feature.icon}</span>
              </div>
              <h3 className="text-lg font-black mb-2 text-[#191817]">{feature.title}</h3>
              <p className="text-sm text-[#514c43] leading-relaxed">{feature.desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
