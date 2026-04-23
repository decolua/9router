"use client";
import { useRouter } from "next/navigation";
import Navigation from "./components/Navigation";
import HeroSection from "./components/HeroSection";
import FlowAnimation from "./components/FlowAnimation";
import HowItWorks from "./components/HowItWorks";
import Features from "./components/Features";
import GetStarted from "./components/GetStarted";
import Footer from "./components/Footer";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function LandingPage() {
  const router = useRouter();
  return (
    <div className="relative text-foreground font-sans overflow-x-hidden antialiased selection:bg-primary selection:text-primary-foreground">
      {/* Animated Background */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none bg-background">
        {/* Grid pattern */}
        <div className="absolute inset-0 opacity-[0.06]" style={{
          backgroundImage: `linear-gradient(to right, hsl(var(--primary)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--primary)) 1px, transparent 1px)`,
          backgroundSize: '50px 50px'
        }}></div>
        
        {/* Animated gradient orbs */}
        <div className="absolute top-0 left-1/4 w-[700px] h-[700px] bg-primary/12 rounded-full blur-[130px] animate-blob"></div>
        <div className="absolute top-1/3 right-1/4 w-[600px] h-[600px] bg-purple-500/10 rounded-full blur-[130px] animate-blob" style={{ animationDelay: '2s', animationDuration: '22s' }}></div>
        <div className="absolute bottom-0 left-1/2 w-[650px] h-[650px] bg-blue-500/8 rounded-full blur-[130px] animate-blob" style={{ animationDelay: '4s', animationDuration: '25s' }}></div>
        
        {/* Vignette effect */}
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,hsl(var(--background))_100%)] opacity-40"></div>
      </div>

      <div className="relative z-10">
        <Navigation />
        
        <main>
          {/* Hero with Flow Animation */}
          <div className="relative">
          <HeroSection />
          <div className="flex justify-center pb-20">
            <FlowAnimation />
          </div>
        </div>
        
        <GetStarted />
        <HowItWorks />
        <Features />
        
        {/* CTA — shadcn Card + Button */}
        <section className="relative overflow-hidden px-6 py-32">
          <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-primary/5 to-transparent"></div>
          <Card className="relative z-10 mx-auto max-w-4xl border-border/50 bg-card/90 text-center shadow-none backdrop-blur-md">
            <CardHeader className="space-y-4">
              <CardTitle className="font-heading text-4xl font-semibold tracking-tight text-foreground md:text-5xl">
                Ready to Simplify Your AI Infrastructure?
              </CardTitle>
              <CardDescription className="mx-auto max-w-2xl text-lg text-muted-foreground">
                Join developers who are streamlining their AI integrations with 8Router. Open source and free to start.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button
                size="lg"
                className="h-14 w-full rounded-lg border-transparent bg-primary px-10 text-lg font-semibold text-primary-foreground hover:bg-primary/90 sm:w-auto"
                onClick={() => router.push("/dashboard")}
              >
                Start Free
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="h-14 w-full rounded-lg border-border/50 bg-transparent px-10 text-lg font-semibold text-foreground hover:bg-muted/10 sm:w-auto"
                onClick={() => window.open("https://github.com/baines95/8router#readme", "_blank")}
              >
                Read Documentation
              </Button>
            </CardContent>
          </Card>
        </section>
        </main>
        
        <Footer />
      </div>
      
      {/* Global styles for keyframes */}
      <style jsx global>{`
        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }
        @keyframes dash {
          to { stroke-dashoffset: -20; }
        }
        @keyframes blob {
          0%, 100% { 
            transform: translate(0, 0) scale(1);
          }
          33% { 
            transform: translate(30px, -50px) scale(1.1);
          }
          66% { 
            transform: translate(-20px, 20px) scale(0.9);
          }
        }
        .animate-blob {
          animation: blob 20s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
