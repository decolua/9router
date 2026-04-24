"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl" | "full";
}

export default function Modal({ open, onClose, title, children }: ModalProps) {
  return (
    <Dialog open={open} onOpenChange={(val) => !val && onClose()}>
      <DialogContent className="sm:max-w-md rounded-none border-border/50 shadow-none p-6">
        {title && (
          <DialogHeader className="mb-4">
            <DialogTitle className="uppercase tracking-tight">{title}</DialogTitle>
          </DialogHeader>
        )}
        <div className="py-2">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
