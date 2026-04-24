"use client";
import React from "react";

export default function Footer() {
  return (
    <footer className="border-t border-border/50 bg-background pt-16 pb-8 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 mb-16">
          {/* Brand */}
          <div className="col-span-2 lg:col-span-2">
            <div className="flex items-center gap-3 mb-6">
              <div className="size-6 rounded bg-primary flex items-center justify-center text-primary-foreground">
                <span className="material-symbols-outlined text-[16px]">hub</span>
              </div>
              <h3 className="text-foreground text-lg font-semibold">8Router</h3>
            </div>
            <p className="text-muted-foreground text-sm max-w-xs mb-6">
              The unified endpoint for AI generation. Connect, route, and manage your AI providers with ease.
            </p>
            <div className="flex gap-4">
              <a className="text-muted-foreground hover:text-foreground transition-colors" href="https://github.com/baines95/8router" target="_blank" rel="noopener noreferrer">
                <span className="material-symbols-outlined">code</span>
              </a>
            </div>
          </div>
          
          {/* Product */}
          <div className="flex flex-col gap-4">
            <h4 className="font-semibold text-foreground">Product</h4>
            <a className="text-muted-foreground hover:text-primary text-sm transition-colors" href="#features">Features</a>
            <a className="text-muted-foreground hover:text-primary text-sm transition-colors" href="/dashboard">Dashboard</a>
            <a className="text-muted-foreground hover:text-primary text-sm transition-colors" href="https://github.com/baines95/8router" target="_blank" rel="noopener noreferrer">Changelog</a>
          </div>
          
          {/* Resources */}
          <div className="flex flex-col gap-4">
            <h4 className="font-semibold text-foreground">Resources</h4>
            <a className="text-muted-foreground hover:text-primary text-sm transition-colors" href="https://github.com/baines95/8router#readme" target="_blank" rel="noopener noreferrer">Documentation</a>
            <a className="text-muted-foreground hover:text-primary text-sm transition-colors" href="https://github.com/baines95/8router" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a className="text-muted-foreground hover:text-primary text-sm transition-colors" href="https://www.npmjs.com/package/8router" target="_blank" rel="noopener noreferrer">NPM</a>
          </div>
          
          {/* Legal */}
          <div className="flex flex-col gap-4">
            <h4 className="font-semibold text-foreground">Legal</h4>
            <a className="text-muted-foreground hover:text-primary text-sm transition-colors" href="https://github.com/baines95/8router/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">MIT License</a>
          </div>
        </div>
        
        {/* Bottom */}
        <div className="border-t border-border/50 pt-8 flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-muted-foreground text-sm">© 2025 8Router. All rights reserved.</p>
          <div className="flex gap-6">
            <a className="text-muted-foreground hover:text-foreground text-sm transition-colors" href="https://github.com/baines95/8router" target="_blank" rel="noopener noreferrer">GitHub</a>
            <a className="text-muted-foreground hover:text-foreground text-sm transition-colors" href="https://www.npmjs.com/package/8router" target="_blank" rel="noopener noreferrer">NPM</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
