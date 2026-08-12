"use client";
import { useRouter } from "next/navigation";
import Navigation from "./components/Navigation";
import HeroSection from "./components/HeroSection";
import FlowAnimation from "./components/FlowAnimation";
import HowItWorks from "./components/HowItWorks";
import Features from "./components/Features";
import GetStarted from "./components/GetStarted";
import Footer from "./components/Footer";

export default function LandingPage() {
  const router = useRouter();
  return (
    <div className="relative text-white font-sans overflow-x-hidden antialiased selection:bg-[#ec4899] selection:text-white">
      {/* Animated Background */}
      <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none bg-[#160f14]">
        {/* Grid pattern */}
        <div className="absolute inset-0 opacity-[0.06]" style={{
          backgroundImage: `linear-gradient(to right, #ec4899 1px, transparent 1px), linear-gradient(to bottom, #ec4899 1px, transparent 1px)`,
          backgroundSize: '50px 50px'
        }}></div>
        
        {/* Animated gradient orbs */}
        <div className="absolute top-0 left-1/4 w-[700px] h-[700px] bg-[#ec4899]/12 rounded-full blur-[130px] animate-blob"></div>
        <div className="absolute top-1/3 right-1/4 w-[600px] h-[600px] bg-purple-500/10 rounded-full blur-[130px] animate-blob" style={{ animationDelay: '2s', animationDuration: '22s' }}></div>
        <div className="absolute bottom-0 left-1/2 w-[650px] h-[650px] bg-blue-500/8 rounded-full blur-[130px] animate-blob" style={{ animationDelay: '4s', animationDuration: '25s' }}></div>
        
        {/* Vignette effect */}
        <div className="absolute inset-0" style={{
          background: 'radial-gradient(circle at center, transparent 0%, rgba(22, 15, 20, 0.4) 100%)'
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
        
        {/* CTA Section */}
        <section className="py-32 px-6 relative overflow-hidden">
          <div className="absolute inset-0 bg-linear-to-t from-[#ec4899]/5 to-transparent pointer-events-none"></div>
          <div className="max-w-4xl mx-auto text-center relative z-10">
            <h2 className="text-4xl md:text-5xl font-black mb-6">Ready to Simplify Your AI Infrastructure?</h2>
            <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">
              Join developers who are streamlining their AI integrations with 10router. Open source and free to start.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button 
                onClick={() => router.push("/dashboard")}
                className="w-full sm:w-auto h-14 px-10 rounded-lg bg-[#ec4899] hover:bg-[#db2777] text-[#160f14] text-lg font-bold transition-all shadow-[0_0_20px_rgba(236, 72, 153,0.5)]"
              >
                Start Free
              </button>
              <button 
                onClick={() => window.open("https://github.com/some-du6e/10router#readme", "_blank")}
                className="w-full sm:w-auto h-14 px-10 rounded-lg border border-[#3a2733] hover:bg-[#20141c] text-white text-lg font-bold transition-all"
              >
                Read Documentation
              </button>
            </div>
          </div>
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

