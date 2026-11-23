"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
export default function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const router = useRouter();
  const links = [["Features", "#features"], ["How it works", "#how-it-works"]];
  return (
    <nav className="fixed top-0 z-50 w-full border-b-2 border-[#191817] bg-[#f7f1e4] shadow-[0_3px_0_#191817]">
      <div className="mx-auto flex h-[4.5rem] max-w-7xl items-center justify-between px-5 md:px-8">
        <button type="button" className="flex items-center gap-3 bg-transparent p-0" onClick={() => router.push("/")} aria-label="Navigate to home">
          <Image src="/providers/9router-logo.png" alt="" width={36} height={36} className="size-9 object-contain" priority unoptimized />
          <span className="text-xl font-black tracking-tight text-[#191817]">9Router<span className="ml-1 text-[#b83b26]">/</span></span>
        </button>
        <div className="hidden items-center gap-7 md:flex">
          {links.map(([label, href]) => <a key={href} className="text-sm font-bold text-[#191817] hover:text-[#b83b26]" href={href}>{label}</a>)}
          <a className="text-sm font-bold text-[#191817] hover:text-[#b83b26]" href="https://github.com/serenhope/9router#readme" target="_blank" rel="noopener noreferrer">Docs ↗</a>
          <a className="border-b-2 border-[#191817] pb-1 text-sm font-bold text-[#191817] hover:text-[#b83b26]" href="https://github.com/serenhope/9router" target="_blank" rel="noopener noreferrer">GitHub</a>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/dashboard")} className="hidden h-11 items-center justify-center border-2 border-[#191817] bg-[#ff7657] px-5 text-sm font-extrabold text-[#191817] shadow-[4px_4px_0_#191817] transition-transform hover:translate-x-0.5 hover:translate-y-0.5 hover:shadow-[2px_2px_0_#191817] sm:flex">Open dashboard <span className="ml-2">→</span></button>
          <button className="flex size-10 items-center justify-center border-2 border-[#191817] bg-[#fffdf8] text-[#191817] shadow-[3px_3px_0_#191817] md:hidden" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"} aria-expanded={mobileMenuOpen}><span className="material-symbols-outlined">{mobileMenuOpen ? "cancel" : "segment"}</span></button>
        </div>
      </div>
      {mobileMenuOpen && <div className="border-t-2 border-[#191817] bg-[#efe4d1] md:hidden"><div className="mx-auto flex max-w-7xl flex-col gap-4 p-6">
        {links.map(([label, href]) => <a key={href} className="border-b border-[#191817]/30 pb-3 text-sm font-bold text-[#191817]" href={href} onClick={() => setMobileMenuOpen(false)}>{label}</a>)}
        <a className="border-b border-[#191817]/30 pb-3 text-sm font-bold text-[#191817]" href="https://github.com/serenhope/9router#readme" target="_blank" rel="noopener noreferrer">Docs</a>
        <a className="border-b border-[#191817]/30 pb-3 text-sm font-bold text-[#191817]" href="https://github.com/serenhope/9router" target="_blank" rel="noopener noreferrer">GitHub</a>
        <button onClick={() => router.push("/dashboard")} className="h-11 border-2 border-[#191817] bg-[#ff7657] text-sm font-extrabold text-[#191817] shadow-[4px_4px_0_#191817]">Open dashboard →</button>
      </div></div>}
    </nav>
  );
}
