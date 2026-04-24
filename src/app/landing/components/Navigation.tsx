"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import React from "react";

export default function Navigation() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const router = useRouter();

  return (
    <nav className="fixed top-0 z-50 w-full bg-background/80 backdrop-blur-md border-b border-border/50">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <button
          type="button"
          className="flex items-center gap-3 cursor-pointer bg-transparent border-none p-0"
          onClick={() => router.push("/")}
          aria-label="Navigate to home"
        >
          <div className="size-8 rounded bg-primary flex items-center justify-center text-primary-foreground">
            <span className="material-symbols-outlined text-[20px]">hub</span>
          </div>
          <h2 className="text-foreground text-xl font-semibold tracking-tight">8Router</h2>
        </button>

        {/* Desktop menu */}
        <div className="hidden md:flex items-center gap-8">
          <a className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors" href="#features">Features</a>
          <a className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors" href="#how-it-works">How it Works</a>
          <a className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors" href="https://github.com/baines95/8router#readme" target="_blank" rel="noopener noreferrer">Docs</a>
          <a className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors flex items-center gap-1" href="https://github.com/baines95/8router" target="_blank" rel="noopener noreferrer">
            GitHub <span className="material-symbols-outlined text-[14px]">open_in_new</span>
          </a>
        </div>

        {/* CTA + Mobile menu */}
        <div className="flex items-center gap-4">
          <button 
            onClick={() => router.push("/dashboard")}
            className="hidden sm:flex h-9 items-center justify-center rounded-lg px-4 bg-primary hover:bg-primary/90 transition-all text-primary-foreground text-sm font-semibold border border-transparent"
          >
            Get Started
          </button>
          <button 
            className="md:hidden text-foreground"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          >
            <span className="material-symbols-outlined">{mobileMenuOpen ? "close" : "menu"}</span>
          </button>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-border/50 bg-background/95 backdrop-blur-md">
          <div className="flex flex-col gap-4 p-6">
            <a className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors" href="#features" onClick={() => setMobileMenuOpen(false)}>Features</a>
            <a className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors" href="#how-it-works" onClick={() => setMobileMenuOpen(false)}>How it Works</a>
            <a className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors" href="https://github.com/baines95/8router#readme" target="_blank" rel="noopener noreferrer">Docs</a>
            <a className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors" href="https://github.com/baines95/8router" target="_blank" rel="noopener noreferrer">GitHub</a>
            <button 
              onClick={() => router.push("/dashboard")}
              className="h-9 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold"
            >
              Get Started
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
