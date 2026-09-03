"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import ProviderTopology from "./ProviderTopology";

export default function ProviderTopologyWithFullscreen(props) {
  const wrapperRef = useRef(null);
  const [isFs, setIsFs] = useState(false);

  const enter = useCallback(async () => {
    const el = wrapperRef.current;
    if (!el) return;
    try {
      if (el.requestFullscreen) await el.requestFullscreen();
      else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    } catch (e) {
      console.warn("Fullscreen request failed:", e);
    }
  }, []);

  const exitFs = useCallback(async () => {
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
    } catch (e) {
      // ignore
    }
  }, []);

  const toggle = useCallback(() => {
    if (isFs) exitFs(); else enter();
  }, [isFs, enter, exitFs]);

  useEffect(() => {
    const onChange = () => {
      setIsFs(Boolean(document.fullscreenElement || document.webkitFullscreenElement));
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);

  return (
    <div
      ref={wrapperRef}
      className={`topo-fs relative w-full min-w-0 ${isFs ? "topo-fs--active" : ""}`}
    >
      <style jsx>{`
        .topo-fs:fullscreen {
          background: var(--color-bg, #fff);
          padding: 16px;
          display: flex;
          flex-direction: column;
        }
        .topo-fs:fullscreen :global(> div:last-child) {
          flex: 1 1 auto;
          height: 100% !important;
          max-height: none !important;
        }
      `}</style>

      <button
        type="button"
        onClick={toggle}
        title={isFs ? "Exit fullscreen (ESC)" : "Fullscreen"}
        aria-label={isFs ? "Exit fullscreen" : "Enter fullscreen"}
        className="absolute top-2 right-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-bg/80 backdrop-blur hover:bg-bg-hover transition-colors"
      >
        <span className="material-symbols-outlined text-[18px] leading-none">
          {isFs ? "fullscreen_exit" : "fullscreen"}
        </span>
      </button>

      <ProviderTopology {...props} />
    </div>
  );
}

ProviderTopologyWithFullscreen.propTypes = ProviderTopology.propTypes;
