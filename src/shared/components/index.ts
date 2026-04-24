"use client";

// Re-map shadcn/ui components to shared names to maintain compatibility
export { Badge } from "@/components/ui/badge";
export { Button } from "@/components/ui/button";
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
export { Input } from "@/components/ui/input";
export { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue, 
  SelectGroup, 
  SelectLabel, 
  SelectSeparator 
} from "@/components/ui/select";
export { Switch as Toggle } from "@/components/ui/switch";
export { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter 
} from "@/components/ui/dialog";

// Original shared components that are still valid
export { default as Modal } from "./Modal";
export { default as Loading, Spinner, PageLoading, Skeleton, CardSkeleton } from "./Loading";
export { default as Avatar } from "./Avatar";
export { default as ThemeToggle } from "./ThemeToggle";
export { ThemeProvider } from "./ThemeProvider";
export { default as Sidebar } from "./Sidebar";
export { default as Header } from "./Header";
export { default as Footer } from "./Footer";
export { default as OAuthModal } from "./OAuthModal";
export { default as ModelSelectModal } from "./ModelSelectModal";
export { default as ManualConfigModal } from "./ManualConfigModal";
export { default as LanguageSwitcher } from "./LanguageSwitcher";
export { default as NineRemoteButton } from "./NineRemoteButton";
export { default as HeaderMenu } from "./HeaderMenu";
export { default as ChangelogModal } from "./ChangelogModal";
export { default as RequestLogger } from "./RequestLogger";
export { default as KiroAuthModal } from "./KiroAuthModal";
export { default as KiroOAuthWrapper } from "./KiroOAuthWrapper";
export { default as KiroSocialOAuthModal } from "./KiroSocialOAuthModal";
export { default as CursorAuthModal } from "./CursorAuthModal";
export { default as IFlowCookieModal } from "./IFlowCookieModal";
export { default as GitLabAuthModal } from "./GitLabAuthModal";
export { default as EditConnectionModal } from "./EditConnectionModal";
export { default as SegmentedControl } from "./SegmentedControl";
export { default as Tooltip } from "./Tooltip";

// Layouts
export * from "./layouts";
