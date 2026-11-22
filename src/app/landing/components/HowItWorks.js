"use client";

export default function HowItWorks() {
  return (
    <section className="py-24 border-y-2 border-[#191817] bg-[#fffdf8]" id="how-it-works">
      <div className="max-w-7xl mx-auto px-6">
        <div className="mb-16">
          <span className="inline-block border-2 border-[#191817] bg-[#c6b5ff] px-3 py-1 text-xs font-extrabold uppercase tracking-[0.12em] shadow-[3px_3px_0_#191817]">Three clear steps</span>
          <h2 className="mt-5 text-3xl md:text-4xl font-black mb-4">How 9Router Works</h2>
          <p className="text-[#514c43] max-w-xl text-lg font-medium">
            Data flows seamlessly from your application through our intelligent routing layer to the best provider for the job.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          <div className="hidden md:block absolute top-12 left-[16%] right-[16%] border-t-4 border-dashed border-[#191817] -z-10"></div>

          <div className="flex flex-col gap-6 relative group">
            <div className="w-24 h-24 border-2 border-[#191817] bg-[#d9f2f4] flex items-center justify-center shadow-[5px_5px_0_#191817] group-hover:-translate-y-1 transition-transform z-10 mx-auto md:mx-0">
              <span className="material-symbols-outlined text-4xl text-[#191817]">devices</span>
            </div>
            <div>
              <h3 className="text-xl font-black mb-2">1. CLI &amp; SDKs</h3>
              <p className="text-sm text-[#514c43]">
                Your requests start from your favorite tools or our unified SDK. Just change the base URL.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-6 relative group md:items-center md:text-center">
            <div className="w-24 h-24 border-2 border-[#191817] bg-[#c8ee68] flex items-center justify-center shadow-[5px_5px_0_#191817] group-hover:-translate-y-1 transition-transform z-10 mx-auto">
              <span className="material-symbols-outlined text-4xl text-[#191817]">alt_route</span>
            </div>
            <div>
              <h3 className="text-xl font-black mb-2">2. 9Router Hub</h3>
              <p className="text-sm text-[#514c43]">
                Our engine analyzes the prompt, checks provider health, and routes for lowest latency or cost.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-6 relative group md:items-end md:text-right">
            <div className="w-24 h-24 border-2 border-[#191817] bg-[#ffd45c] flex items-center justify-center shadow-[5px_5px_0_#191817] group-hover:-translate-y-1 transition-transform z-10 mx-auto md:mx-0">
              <div className="grid grid-cols-2 gap-2">
                <div className="w-6 h-6 border-2 border-[#191817] bg-[#ff7657]"></div>
                <div className="w-6 h-6 border-2 border-[#191817] bg-[#83d8e8]"></div>
                <div className="w-6 h-6 border-2 border-[#191817] bg-[#c6b5ff]"></div>
                <div className="w-6 h-6 border-2 border-[#191817] bg-[#c8ee68]"></div>
              </div>
            </div>
            <div>
              <h3 className="text-xl font-black mb-2">3. AI Providers</h3>
              <p className="text-sm text-[#514c43]">
                The request is fulfilled by OpenAI, Anthropic, Gemini, or others instantly.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
