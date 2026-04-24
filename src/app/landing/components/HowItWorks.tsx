"use client";
import React from "react";

export default function HowItWorks() {
  return (
    <section className="py-24 border-y border-border/50 bg-muted/5" id="how-it-works">
      <div className="max-w-7xl mx-auto px-6">
        <div className="mb-16">
          <h2 className="text-3xl md:text-4xl font-semibold mb-4 text-foreground">How 8Router Works</h2>
          <p className="text-muted-foreground max-w-xl text-lg">
            Data flows seamlessly from your application through our intelligent routing layer to the best provider for the job.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
          {/* Connection line */}
          <div className="hidden md:block absolute top-12 left-[16%] right-[16%] h-[2px] bg-linear-to-r from-border via-primary to-border -z-10"></div>
          
          {/* Step 1: CLI & SDKs */}
          <div className="flex flex-col gap-6 relative group">
            <div className="w-24 h-24 rounded-2xl bg-card border border-border/50 flex items-center justify-center transition-colors z-10 mx-auto md:mx-0 group-hover:border-border">
              <span className="material-symbols-outlined text-4xl text-muted-foreground">terminal</span>
            </div>
            <div>
              <h3 className="text-xl font-semibold mb-2 text-foreground">1. CLI &amp; SDKs</h3>
              <p className="text-sm text-muted-foreground">
                Your requests start from your favorite tools or our unified SDK. Just change the base URL.
              </p>
            </div>
          </div>

          {/* Step 2: 8Router Hub */}
          <div className="flex flex-col gap-6 relative group md:items-center md:text-center">
            <div className="w-24 h-24 rounded-2xl bg-card border-2 border-primary flex items-center justify-center z-10 mx-auto">
              <span className="material-symbols-outlined text-4xl text-primary animate-pulse">hub</span>
            </div>
            <div>
              <h3 className="text-xl font-semibold mb-2 text-primary">2. 8Router Hub</h3>
              <p className="text-sm text-muted-foreground">
                Our engine analyzes the prompt, checks provider health, and routes for lowest latency or cost.
              </p>
            </div>
          </div>

          {/* Step 3: AI Providers */}
          <div className="flex flex-col gap-6 relative group md:items-end md:text-right">
            <div className="w-24 h-24 rounded-2xl bg-card border border-border/50 flex items-center justify-center transition-colors z-10 mx-auto md:mx-0 group-hover:border-border">
              <div className="grid grid-cols-2 gap-2">
                <div className="w-6 h-6 rounded bg-muted"></div>
                <div className="w-6 h-6 rounded bg-muted"></div>
                <div className="w-6 h-6 rounded bg-muted"></div>
                <div className="w-6 h-6 rounded bg-muted"></div>
              </div>
            </div>
            <div>
              <h3 className="text-xl font-semibold mb-2 text-foreground">3. AI Providers</h3>
              <p className="text-sm text-muted-foreground">
                The request is fulfilled by OpenAI, Anthropic, Gemini, or others instantly.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
