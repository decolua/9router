"use client";
import Image from "next/image";
export default function Footer() {
  return (
    <footer className="border-t-2 border-[#191817] bg-[#efe4d1] px-6 pb-8 pt-12 md:pt-16">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-10 border-b-2 border-[#191817] pb-10 sm:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr] lg:gap-8 lg:pb-14">
          <div className="sm:col-span-2 lg:col-span-1">
            <a href="/" className="mb-5 inline-flex items-center gap-3"><Image src="/providers/9router-logo.png" alt="" width={40} height={40} className="size-10 object-contain" unoptimized /><span className="text-xl font-black text-[#191817]">9Router</span></a>
            <p className="mb-5 max-w-xs text-sm leading-relaxed text-[#514c43]">Connect, route, and manage your AI providers from one endpoint.</p>
            <a className="inline-flex border-b-2 border-[#191817] pb-1 text-sm font-bold text-[#191817] hover:text-[#b83b26]" href="https://github.com/serenhope/9router" target="_blank" rel="noopener noreferrer" aria-label="9Router on GitHub">GitHub ↗</a>
          </div>
          <div className="flex flex-col gap-3"><h4 className="mb-1 font-black text-[#191817]">Product</h4><a className="text-sm font-medium text-[#39352f] hover:text-[#b83b26]" href="#features">Features</a><a className="text-sm font-medium text-[#39352f] hover:text-[#b83b26]" href="/dashboard">Dashboard</a><a className="text-sm font-medium text-[#39352f] hover:text-[#b83b26]" href="https://github.com/serenhope/9router" target="_blank" rel="noopener noreferrer">Changelog</a></div>
          <div className="flex flex-col gap-3"><h4 className="mb-1 font-black text-[#191817]">Resources</h4><a className="text-sm font-medium text-[#39352f] hover:text-[#b83b26]" href="https://github.com/serenhope/9router#readme" target="_blank" rel="noopener noreferrer">Documentation</a><a className="text-sm font-medium text-[#39352f] hover:text-[#b83b26]" href="https://github.com/serenhope/9router" target="_blank" rel="noopener noreferrer">GitHub repository</a><a className="text-sm font-medium text-[#39352f] hover:text-[#b83b26]" href="https://www.npmjs.com/package/9router" target="_blank" rel="noopener noreferrer">NPM package</a></div>
          <div className="flex flex-col gap-3"><h4 className="mb-1 font-black text-[#191817]">Legal</h4><a className="text-sm font-medium text-[#39352f] hover:text-[#b83b26]" href="https://github.com/serenhope/9router/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a></div>
        </div>
        <div className="flex flex-col items-start justify-between gap-4 pt-6 sm:flex-row sm:items-center"><p className="text-xs font-medium text-[#514c43]">© 2025 9Router. All rights reserved.</p><div className="flex gap-5"><a className="text-xs font-bold text-[#514c43] hover:text-[#b83b26]" href="https://github.com/serenhope/9router" target="_blank" rel="noopener noreferrer">GitHub ↗</a><a className="text-xs font-bold text-[#514c43] hover:text-[#b83b26]" href="https://www.npmjs.com/package/9router" target="_blank" rel="noopener noreferrer">NPM ↗</a></div></div>
      </div>
    </footer>
  );
}
