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
    <div className="relative text-white font-sans overflow-x-hidden antialiased selection:bg-[#f97815] selection:text-white">
      {/* Animated Background */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none bg-[#181411]">
        {/* Grid pattern */}
        <div className="absolute inset-0 opacity-[0.06]" style={{
          backgroundImage: `linear-gradient(to right, #f97815 1px, transparent 1px), linear-gradient(to bottom, #f97815 1px, transparent 1px)`,
          backgroundSize: '50px 50px'
        }}></div>
        
        {/* Animated gradient orbs */}
        <div className="absolute top-0 left-1/4 w-[700px] h-[700px] bg-[#f97815]/12 rounded-full blur-[130px] animate-blob"></div>
        <div className="absolute top-1/3 right-1/4 w-[600px] h-[600px] bg-purple-500/10 rounded-full blur-[130px] animate-blob" style={{ animationDelay: '2s', animationDuration: '22s' }}></div>
        <div className="absolute bottom-0 left-1/2 w-[650px] h-[650px] bg-blue-500/8 rounded-full blur-[130px] animate-blob" style={{ animationDelay: '4s', animationDuration: '25s' }}></div>
        
        {/* Vignette effect */}
        <div className="absolute inset-0" style={{
          background: 'radial-gradient(circle at center, transparent 0%, rgba(24, 20, 17, 0.4) 100%)'
        }}></div>
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
          <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-[#f97815]/5 to-transparent"></div>
          <Card className="relative z-10 mx-auto max-w-4xl border-[#3a2f27] bg-[#1a1512]/90 text-center text-white shadow-2xl backdrop-blur-md">
            <CardHeader className="space-y-4">
              <CardTitle className="font-heading text-4xl font-black tracking-tight text-white md:text-5xl">
                Ready to Simplify Your AI Infrastructure?
              </CardTitle>
              <CardDescription className="mx-auto max-w-2xl text-lg text-gray-400">
                Join developers who are streamlining their AI integrations with 9Router. Open source and free to start.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Button
                size="lg"
                className="h-14 w-full rounded-lg border-transparent bg-[#f97815] px-10 text-lg font-bold text-[#181411] shadow-[0_0_20px_rgba(249,120,21,0.5)] hover:bg-[#e0650a] sm:w-auto"
                onClick={() => router.push("/dashboard")}
              >
                Start Free
              </Button>
              <Button
                variant="outline"
                size="lg"
                className="h-14 w-full rounded-lg border-[#3a2f27] bg-transparent px-10 text-lg font-bold text-white hover:bg-[#23180f] sm:w-auto"
                onClick={() => window.open("https://github.com/decolua/9router#readme", "_blank")}
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

