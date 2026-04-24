"use client";

import React, { useState, useEffect } from "react";
import { 
  Card, 
  CardContent, 
  CardHeader, 
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { 
  Lock, 
  ShieldCheck, 
  Loader2, 
  Zap
} from "lucide-react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const router = useRouter();

  useEffect(() => {
    async function checkAuth() {
      const baseUrl = typeof window !== "undefined" ? window.location.origin : "";
      try {
        const res = await fetch(`${baseUrl}/api/settings`);
        if (res.ok) {
          const data = await res.json();
          if (data.requireLogin === false) { 
            router.push("/dashboard"); 
            router.refresh(); 
            return; 
          }
          setHasPassword(!!data.hasPassword);
        } else { 
          setHasPassword(true); 
        }
      } catch (err) { 
        setHasPassword(true); 
      }
    }
    checkAuth();
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", { 
        method: "POST", 
        headers: { "Content-Type": "application/json" }, 
        body: JSON.stringify({ password }) 
      });
      if (res.ok) { 
        router.push("/dashboard"); 
        router.refresh(); 
      } else { 
        const data = await res.json(); 
        setError(data.error || "Invalid credential identity."); 
      }
    } catch (err) { 
      setError("Node connection failure."); 
    } finally { 
      setLoading(false); 
    }
  };

  if (hasPassword === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Loader2 className="size-6 animate-spin text-primary opacity-20" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-8 animate-in fade-in duration-500">
        <div className="flex flex-col items-center text-center">
          <div className="size-12 rounded-2xl bg-primary flex items-center justify-center mb-6 shadow-none">
            <Zap className="size-6 text-primary-foreground fill-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">8Router Gateway</h1>
          <p className="text-sm text-muted-foreground font-medium mt-2">Private Infrastructure Authentication</p>
        </div>

        <Card className="shadow-none border-border overflow-hidden p-0">
          <CardHeader className="bg-muted/20 border-b border-border p-6">
             <div className="flex items-center gap-2 text-primary">
                <Lock className="size-4" />
                <span className="text-[10px] font-semibold uppercase tracking-widest">Secure Access</span>
             </div>
          </CardHeader>
          <CardContent className="p-6">
            <form onSubmit={handleLogin} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="password" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1">Infrastructure Key</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 text-lg border-2 focus-visible:ring-primary/20"
                  required
                  autoFocus
                />
                {error && <p className="text-[10px] font-bold text-destructive uppercase tracking-wide px-1">{error}</p>}
              </div>

              <Button type="submit" className="w-full h-12 font-bold text-sm shadow-none" disabled={loading}>
                {loading ? <Loader2 className="size-4 animate-spin mr-2" /> : <ShieldCheck className="size-4 mr-2" />}
                Authorize Session
              </Button>

              <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-muted/40 border border-border/50">
                 <span className="text-[10px] font-bold text-muted-foreground uppercase opacity-60">Provisioned password:</span>
                 <code className="text-[10px] font-mono font-bold text-primary">123456</code>
              </div>
            </form>
          </CardContent>
        </Card>
        
        <p className="text-center text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground opacity-30">Encrypted Infrastructure Node • v0.3.96</p>
      </div>
    </div>
  );
}
