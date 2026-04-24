"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { 
  Plus, 
  ArrowLeft, 
  Key, 
  Globe, 
  Code as SearchCode,
  IdentificationCard as UserCircle,
  PuzzlePiece as Puzzle,
  CaretRight
} from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle, 
  CardDescription,
  CardFooter 
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { translate } from "@/i18n/runtime";
import { OAUTH_PROVIDERS, APIKEY_PROVIDERS } from "@/shared/constants/config";
import { FREE_PROVIDERS, FREE_TIER_PROVIDERS } from "@/shared/constants/providers";

interface ProviderInfo {
  id: string;
  name: string;
  category: string;
  authType: string;
  description?: string;
  icon: any;
}

const PROVIDER_TEMPLATES: ProviderInfo[] = [
  // OAuth
  ...Object.entries(OAUTH_PROVIDERS).map(([id, info]: [string, any]) => ({
    id,
    name: info.name,
    category: "oauth",
    authType: "oauth",
    description: "Connect via official OAuth / Social login",
    icon: UserCircle
  })),
  // API Key
  ...Object.entries(APIKEY_PROVIDERS).map(([id, info]: [string, any]) => ({
    id,
    name: info.name,
    category: "apikey",
    authType: "apikey",
    description: "Connect using a standard API secret key",
    icon: Key
  })),
  // Free
  ...Object.entries(FREE_PROVIDERS).map(([id, info]: [string, any]) => ({
    id,
    name: info.name,
    category: "free",
    authType: "oauth",
    description: "Free public provider (OAuth based)",
    icon: Globe
  })),
  ...Object.entries(FREE_TIER_PROVIDERS).map(([id, info]: [string, any]) => ({
    id,
    name: info.name,
    category: "free",
    authType: "apikey",
    description: "Free tier provider (API Key based)",
    icon: Key
  })),
];

export default function NewProviderPage() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedProviderCategory] = useState("all");

  const filteredTemplates = PROVIDER_TEMPLATES.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          p.id.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === "all" || p.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="mx-auto max-w-5xl flex flex-col gap-6 py-4 px-4">
      {/* Page Header */}
      <header className="flex flex-col gap-3 pb-4 border-b border-border/50">
        <Link
          href="/dashboard/providers"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors group"
        >
          <ArrowLeft className="size-3.5 group-hover:-translate-x-0.5 transition-transform" weight="bold" />
          {translate("Back to Providers")}
        </Link>
        
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mt-1">
          <div className="space-y-0.5">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Add New Provider</h1>
            <p className="text-sm text-muted-foreground font-medium">Select a provider template to connect your AI infrastructure.</p>
          </div>
        </div>
      </header>

      {/* Filter Bar */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="flex items-center gap-1 bg-muted/30 p-1 border border-border/50 rounded-xl w-full md:w-auto">
          {["all", "oauth", "apikey", "free"].map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedProviderCategory(cat)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-xs font-bold uppercase tracking-widest transition-all shrink-0",
                selectedCategory === cat
                  ? "bg-background text-foreground shadow-sm border border-border/50"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {translate(cat)}
            </button>
          ))}
        </div>

        <div className="relative w-full md:w-72 group">
          <SearchCode className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground group-focus-within:text-primary transition-colors" weight="bold"/>
          <Input
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-10 text-sm bg-muted/10 border-border/40 focus:bg-background transition-all rounded-xl"
          />
        </div>
      </div>

      {/* Templates Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTemplates.map((provider) => (
          <Link 
            key={provider.id} 
            href={`/dashboard/providers/${provider.id}`}
            className="group"
          >
            <Card className="h-full border-border/50 bg-muted/5 hover:bg-muted/10 transition-all duration-300 rounded-2xl shadow-none hover:shadow-xl hover:shadow-primary/5 hover:border-primary/30 overflow-hidden flex flex-col">
              <CardHeader className="p-5 pb-2">
                <div className="flex items-center justify-between mb-4">
                  <div className="size-12 rounded-2xl bg-background border border-border/50 flex items-center justify-center p-2.5 group-hover:scale-110 transition-transform duration-300 shadow-none">
                    <img 
                      src={`/providers/${provider.id}.png`} 
                      alt={provider.name} 
                      className={cn(
                        "size-full object-contain",
                        (provider.id === "codex" || provider.id === "openai" || provider.id === "github") && "dark:invert"
                      )}
                      onError={(e: any) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'flex';
                      }}
                    />
                    <div className="hidden size-full items-center justify-center">
                      <provider.icon className="size-6 text-primary" weight="bold" />
                    </div>
                  </div>
                  <div className="size-8 rounded-full bg-muted/20 flex items-center justify-center group-hover:bg-primary/20 group-hover:text-primary transition-colors">
                    <CaretRight className="size-4" weight="bold" />
                  </div>
                </div>
                <CardTitle className="text-base font-bold tracking-tight text-foreground group-hover:text-primary transition-colors">{provider.name}</CardTitle>
                <CardDescription className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground opacity-60 mt-1">{provider.authType}</CardDescription>
              </CardHeader>
              <CardContent className="p-5 pt-2 flex-1">
                <p className="text-xs text-muted-foreground font-medium leading-relaxed">{provider.description}</p>
              </CardContent>
              <CardFooter className="p-5 pt-0 border-t border-transparent group-hover:border-border/10 transition-colors">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-primary opacity-0 group-hover:opacity-100 transition-opacity">Configure Node</span>
                </div>
              </CardFooter>
            </Card>
          </Link>
        ))}

        {/* Custom Endpoint Slot */}
        <button 
          onClick={() => router.push("/dashboard/providers")} // Or a special custom modal
          className="group relative h-full border-2 border-dashed border-border/40 bg-muted/5 hover:bg-muted/10 hover:border-primary/40 rounded-2xl transition-all duration-300 flex flex-col items-center justify-center p-8 gap-4 text-center"
        >
          <div className="size-16 rounded-3xl bg-background border border-dashed border-border/60 flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
            <Plus className="size-8 text-muted-foreground group-hover:text-primary" weight="bold" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-foreground group-hover:text-primary transition-colors">OpenAI Compatible</h3>
            <p className="text-xs text-muted-foreground font-medium">Add any OAI-compatible API endpoint manually</p>
          </div>
        </button>
      </div>

      {filteredTemplates.length === 0 && (
        <div className="py-20 text-center flex flex-col items-center gap-4 opacity-40">
          <Puzzle className="size-16" weight="bold" />
          <div className="space-y-1">
            <p className="text-lg font-bold uppercase tracking-[0.2em]">No matches found</p>
            <p className="text-xs font-medium italic">Try different search terms or category filters</p>
          </div>
        </div>
      )}
    </div>
  );
}
