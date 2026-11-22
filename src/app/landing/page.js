"use client";
import { useRouter } from "next/navigation";
import Navigation from "./components/Navigation";
import HeroSection from "./components/HeroSection";
import FlowAnimation from "./components/FlowAnimation";
import HowItWorks from "./components/HowItWorks";
import Features from "./components/Features";
import GetStarted from "./components/GetStarted";
import Footer from "./components/Footer";
export default function LandingPage() {
  const router = useRouter();
  return (
    <div className="relative overflow-x-hidden bg-transparent font-sans text-text-main antialiased selection:bg-[#c8ee68] selection:text-[#191817]">
      <div className="relative z-10">
        <Navigation />
        <main>
          <div className="relative"><HeroSection /><div className="flex justify-center px-4 pb-14 md:pb-20"><FlowAnimation /></div></div>
          <GetStarted />
          <HowItWorks />
          <Features />
          <section className="relative overflow-hidden border-y-2 border-[#191817] bg-[#c6b5ff] px-6 py-16 md:py-24">
            <div className="relative z-10 mx-auto max-w-5xl border-2 border-[#191817] bg-[#fffdf8] p-7 text-center shadow-[8px_8px_0_#191817] sm:p-10 md:p-14">
              <span className="mb-6 inline-flex border-2 border-[#191817] bg-[#ffd45c] px-3 py-1 text-xs font-extrabold uppercase tracking-[0.15em] shadow-[3px_3px_0_#191817]">One endpoint. More room to build.</span>
              <h2 className="mx-auto mb-6 max-w-3xl text-4xl font-black leading-tight md:text-6xl">Ready to simplify your AI infrastructure?</h2>
              <p className="mx-auto mb-9 max-w-2xl text-lg leading-relaxed text-[#39352f] md:text-xl">Join developers streamlining their AI integrations with free, open-source 9Router.</p>
              <div className="flex flex-col justify-center gap-4 sm:flex-row"><button onClick={() => router.push("/dashboard")} className="h-14 border-2 border-[#191817] bg-[#ff7657] px-8 text-base font-extrabold text-[#191817] shadow-[5px_5px_0_#191817] transition-transform hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[3px_3px_0_#191817]">Start free →</button><button onClick={() => window.open("https://github.com/serenhope/9router#readme", "_blank")} className="h-14 border-2 border-[#191817] bg-[#fffdf8] px-8 text-base font-extrabold text-[#191817] shadow-[5px_5px_0_#191817] transition-transform hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[3px_3px_0_#191817]">Read documentation ↗</button></div>
            </div>
          </section>
        </main>
        <Footer />
      </div>
      <style jsx global>{`@keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } } @keyframes dash { to { stroke-dashoffset: -20; } }`}</style>
    </div>
  );
}
