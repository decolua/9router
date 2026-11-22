"use client";

import PropTypes from "prop-types";
import ThemeToggle from "../ThemeToggle";

export default function AuthLayout({ children }) {
  return (
    <div className="min-h-screen flex flex-col relative bg-bg transition-colors duration-500 overflow-x-hidden selection:bg-primary/20 selection:text-primary">
      <div aria-hidden="true" className="fixed right-10 top-28 z-0 hidden size-24 rotate-6 border-2 border-[#191817] bg-[#c6b5ff] shadow-[5px_5px_0_#191817] lg:block" />
      <div aria-hidden="true" className="fixed bottom-16 left-8 z-0 hidden size-14 -rotate-6 border-2 border-[#191817] bg-[#c8ee68] shadow-[4px_4px_0_#191817] lg:block" />

      <div className="absolute top-6 right-6 z-20">
        <ThemeToggle variant="card" />
      </div>

      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 z-10 w-full h-full">
        {children}
      </main>
    </div>
  );
}

AuthLayout.propTypes = {
  children: PropTypes.node.isRequired,
};
