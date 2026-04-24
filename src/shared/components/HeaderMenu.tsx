"use client";

import React, { useState, useEffect } from "react";
import { LOCALE_COOKIE, normalizeLocale } from "@/i18n/config";
import { useTheme } from "@/shared/hooks/useTheme";
import ChangelogModal from "./ChangelogModal";
import NineRemotePromoModal from "./NineRemotePromoModal";
import LanguageSwitcher from "./LanguageSwitcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { 
  SquaresFour, 
  ClockCounterClockwise, 
  Translate, 
  Sun, 
  Moon, 
  Desktop, 
  SignOut 
} from "@phosphor-icons/react";

const LOCALE_INFO: Record<string, { name: string, flag: string }> = {
  "en": { name: "English", flag: "🇺🇸" },
  "vi": { name: "Tiếng Việt", flag: "🇻🇳" },
  "zh-CN": { name: "简体中文", flag: "🇨🇳" },
  "zh-TW": { name: "繁體中文", flag: "🇹🇼" },
  "ja": { name: "日本語", flag: "🇯🇵" },
  "pt-BR": { name: "Português (BR)", flag: "🇧🇷" },
  "pt-PT": { name: "Português (PT)", flag: "🇵🇹" },
  "ko": { name: "한국어", flag: "🇰🇷" },
  "es": { name: "Español", flag: "🇪🇸" },
  "de": { name: "Deutsch", flag: "🇩🇪" },
  "fr": { name: "Français", flag: "🇫🇷" },
  "he": { name: "עברית", flag: "🇮🇱" },
  "ar": { name: "العربية", flag: "🇸🇦" },
  "ru": { name: "Русский", flag: "🇷🇺" },
  "pl": { name: "Polski", flag: "🇵🇱" },
  "cs": { name: "Čeština", flag: "🇨🇿" },
  "nl": { name: "Nederlands", flag: "🇳🇱" },
  "tr": { name: "Türkçe", flag: "🇹🇷" },
  "uk": { name: "Українська", flag: "🇺🇦" },
  "tl": { name: "Tagalog", flag: "🇵🇭" },
  "id": { name: "Indonesia", flag: "🇮🇩" },
  "th": { name: "ไทย", flag: "🇹🇭" },
  "hi": { name: "हिन्दी", flag: "🇮🇳" },
  "bn": { name: "বাংলা", flag: "🇧🇩" },
  "ur": { name: "اردu", flag: "🇵🇰" },
  "ro": { name: "Română", flag: "🇷🇴" },
  "sv": { name: "Svenska", flag: "🇸🇪" },
  "it": { name: "Italiano", flag: "🇮🇹" },
  "el": { name: "Ελληνικά", flag: "🇬🇷" },
  "hu": { name: "Magyar", flag: "🇭🇺" },
  "fi": { name: "Suomi", flag: "🇫🇮" },
  "da": { name: "Dansk", flag: "🇩🇰" },
  "no": { name: "Norsk", flag: "🇳🇴" },
};

function getLocaleFromCookie() {
  if (typeof document === "undefined") return "en";
  const cookie = document.cookie
    .split(";")
    .find((c) => c.trim().startsWith(`${LOCALE_COOKIE}=`));
  const value = cookie ? decodeURIComponent(cookie.split("=")[1]) : "en";
  return normalizeLocale(value);
}

interface HeaderMenuProps {
  onLogout: () => void;
}

export default function HeaderMenu({ onLogout }: HeaderMenuProps) {
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [locale, setLocale] = useState("en");
  const { toggleTheme, isDark } = useTheme();

  useEffect(() => {
    setLocale(getLocaleFromCookie());
  }, [langOpen]);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground shadow-none">
            <SquaresFour className="size-5" weight="bold" />
            <span className="sr-only">Menu</span>
          </Button>
        } />
        <DropdownMenuContent align="end" className="w-56 rounded-none border-border/50 shadow-none bg-background/95 backdrop-blur-md">
          <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 px-3 py-2">Infrastructure Node</DropdownMenuLabel>
          <DropdownMenuSeparator className="mx-0 bg-border/20" />
          <DropdownMenuItem onClick={() => setChangelogOpen(true)} className="gap-2 py-2.5 cursor-pointer text-[10px] font-bold uppercase tracking-widest rounded-none hover:bg-primary/5 hover:text-primary transition-colors">
            <ClockCounterClockwise className="size-4" weight="bold" />
            <span>Change Log</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setLangOpen(true)} className="gap-2 py-2.5 cursor-pointer text-[10px] font-bold uppercase tracking-widest rounded-none hover:bg-primary/5 hover:text-primary transition-colors">
            <Translate className="size-4" weight="bold" />
            <span className="flex-1">Language</span>
            <span className="text-[10px] text-muted-foreground font-bold tabular-nums">{LOCALE_INFO[locale]?.flag}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => toggleTheme()} className="gap-2 py-2.5 cursor-pointer text-[10px] font-bold uppercase tracking-widest rounded-none hover:bg-primary/5 hover:text-primary transition-colors">
            {isDark ? <Sun className="size-4" weight="bold" /> : <Moon className="size-4" weight="bold" />}
            <span>{isDark ? "Light Mode" : "Dark Mode"}</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setRemoteOpen(true)} className="gap-2 py-2.5 cursor-pointer text-[10px] font-bold uppercase tracking-widest rounded-none hover:bg-primary/5 hover:text-primary transition-colors">
            <Desktop className="size-4" weight="bold" />
            <span>Remote Access</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator className="mx-0 bg-border/20" />
          <DropdownMenuItem onClick={onLogout} className="text-destructive focus:bg-destructive/10 focus:text-destructive gap-2 py-2.5 cursor-pointer text-[10px] font-bold uppercase tracking-widest rounded-none transition-colors">
            <SignOut className="size-4" weight="bold" />
            <span>De-authorize Session</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ChangelogModal isOpen={changelogOpen} onClose={() => setChangelogOpen(false)} />
      <NineRemotePromoModal isOpen={remoteOpen} onClose={() => setRemoteOpen(false)} />
      <LanguageSwitcher hideTrigger isOpen={langOpen} onClose={() => setLangOpen(false)} />
    </>
  );
}
