"use client";
import React, { useState } from "react";

export default function GetStarted() {
  const [copied, setCopied] = useState(false);

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="py-24 px-6 bg-background">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row gap-16 items-start">
          {/* Left: Steps */}
          <div className="flex-1">
            <h2 className="text-3xl md:text-4xl font-semibold mb-6 text-foreground">Get Started in 30 Seconds</h2>
            <p className="text-muted-foreground text-lg mb-8">
              Install 8Router, configure your providers via web dashboard, and start routing AI requests.
            </p>
            
            <div className="flex flex-col gap-6">
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium">1</div>
                <div>
                  <h4 className="font-semibold text-lg text-foreground">Install 8Router</h4>
                  <p className="text-sm text-muted-foreground mt-1">Run npx command to start the server instantly</p>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium">2</div>
                <div>
                  <h4 className="font-semibold text-lg text-foreground">Open Dashboard</h4>
                  <p className="text-sm text-muted-foreground mt-1">Configure providers and API keys via web interface</p>
                </div>
              </div>
              
              <div className="flex gap-4">
                <div className="flex-none w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center font-medium">3</div>
                <div>
                  <h4 className="font-semibold text-lg text-foreground">Route Requests</h4>
                  <p className="text-sm text-muted-foreground mt-1">Point your CLI tools to http://localhost:20128</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Code block */}
          <div className="flex-1 w-full">
            <div className="rounded-xl overflow-hidden bg-card border border-border/50">
              {/* Terminal header */}
              <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border/50">
                <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
                <div className="ml-2 text-xs text-muted-foreground font-mono">terminal</div>
              </div>
              
              {/* Terminal content */}
              <div className="p-6 font-mono text-sm leading-relaxed overflow-x-auto">
                <div 
                  className="flex items-center gap-2 mb-4 group cursor-pointer"
                  onClick={() => handleCopy("npx 8router")}
                >
                  <span className="text-green-500">$</span>
                  <span className="text-foreground">npx 8router</span>
                  <span className="ml-auto text-muted-foreground text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                    {copied ? "✓ Copied" : "Copy"}
                  </span>
                </div>
                
                <div className="text-muted-foreground mb-6">
                  <span className="text-primary">&gt;</span> Starting 8Router...<br/>
                  <span className="text-primary">&gt;</span> Server running on <span className="text-blue-400">http://localhost:20128</span><br/>
                  <span className="text-primary">&gt;</span> Dashboard: <span className="text-blue-400">http://localhost:20128/dashboard</span><br/>
                  <span className="text-green-500">&gt;</span> Ready to route! ✓
                </div>
                
                <div className="text-xs text-muted-foreground mb-2 border-t border-border/50 pt-4">
                  📝 Configure providers in dashboard or use environment variables
                </div>
                
                <div className="text-muted-foreground text-xs">
                  <span className="text-purple-400">Data Location:</span><br/>
                  <span className="text-muted-foreground/80">  macOS/Linux:</span> ~/.8router/db.json<br/>
                  <span className="text-muted-foreground/80">  Windows:</span> %APPDATA%/8router/db.json
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
