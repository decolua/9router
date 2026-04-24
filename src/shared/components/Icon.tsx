"use client";

import * as React from "react";
import { 
  CloudUpload, 
  Lock, 
  Plus, 
  Check, 
  Copy, 
  X, 
  AlertCircle, 
  Search, 
  Settings, 
  ChevronDown,
  Info,
  CheckCircle2,
  AlertTriangle,
  Zap,
  History,
  Languages,
  Moon,
  Sun,
  Monitor,
  LogOut,
  HelpCircle,
  ExternalLink,
  ChevronRight,
  MoreVertical,
  MoreHorizontal,
  Trash2,
  Edit,
  RefreshCw,
  Eye,
  EyeOff,
  Filter,
  ArrowRight,
  ArrowLeft,
  LucideProps
} from "lucide-react";

const ICON_MAP: Record<string, React.FC<LucideProps>> = {
  "cloud_upload": CloudUpload,
  "vpn_lock": Lock,
  "add": Plus,
  "check": Check,
  "content_copy": Copy,
  "close": X,
  "error": AlertCircle,
  "search": Search,
  "settings": Settings,
  "expand_more": ChevronDown,
  "info": Info,
  "check_circle": CheckCircle2,
  "warning": AlertTriangle,
  "zap": Zap,
  "history": History,
  "language": Languages,
  "dark_mode": Moon,
  "light_mode": Sun,
  "computer": Monitor,
  "logout": LogOut,
  "help": HelpCircle,
  "open_in_new": ExternalLink,
  "chevron_right": ChevronRight,
  "more_vert": MoreVertical,
  "more_horiz": MoreHorizontal,
  "delete": Trash2,
  "edit": Edit,
  "refresh": RefreshCw,
  "visibility": Eye,
  "visibility_off": EyeOff,
  "filter_list": Filter,
  "arrow_forward": ArrowRight,
  "arrow_back": ArrowLeft,
};

interface IconProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
  className?: string;
  [key: string]: any;
}

export default function Icon({ name, className, ...props }: IconProps) {
  if (!name) return null;

  const LucideIcon = ICON_MAP[name];

  if (LucideIcon) {
    return <LucideIcon className={className} {...(props as any)} />;
  }

  // Fallback to Material Symbols if not in map
  return (
    <span 
      className={`material-symbols-outlined ${className || ""}`} 
      style={{ fontSize: 'inherit' }}
      {...props}
    >
      {name}
    </span>
  );
}
