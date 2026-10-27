"use client";

import * as Popover from "@radix-ui/react-popover";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Link as LinkIcon,
} from "lucide-react";
import { useState } from "react";

type Props = {
  mdUrl: string;
};

export function CopyMarkdownButton({ mdUrl }: Props) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle"
  );
  const [linkCopied, setLinkCopied] = useState(false);
  const [open, setOpen] = useState(false);

  const flash = (
    setter: (v: boolean) => void,
    onDone?: () => void
  ) => {
    setter(true);
    window.setTimeout(() => {
      setter(false);
      onDone?.();
    }, 1500);
  };

  const handleCopyMarkdown = async () => {
    try {
      const res = await fetch(mdUrl);
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1500);
    } catch {
      setCopyState("error");
      window.setTimeout(() => setCopyState("idle"), 2000);
    }
  };

  const fullUrl = () =>
    typeof window === "undefined"
      ? mdUrl
      : `${window.location.origin}${mdUrl}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(fullUrl());
      flash(setLinkCopied, () => setOpen(false));
    } catch {
      setOpen(false);
    }
  };

  const handleOpenLink = () => {
    window.open(fullUrl(), "_blank", "noopener,noreferrer");
    setOpen(false);
  };

  const copyLabel =
    copyState === "copied"
      ? "Copied"
      : copyState === "error"
        ? "Failed"
        : "Copy MD";

  return (
    <div className="flex items-stretch overflow-hidden rounded-md border border-fd-border bg-fd-card text-fd-muted-foreground">
      <button
        type="button"
        onClick={handleCopyMarkdown}
        aria-label="Copy markdown to clipboard"
        className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium transition hover:bg-fd-accent hover:text-fd-accent-foreground disabled:opacity-50"
      >
        {copyState === "copied" ? (
          <Check className="size-3.5" />
        ) : (
          <Copy className="size-3.5" />
        )}
        <span>{copyLabel}</span>
      </button>
      <div className="w-px bg-fd-border" aria-hidden="true" />
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label="Open markdown"
            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs font-medium transition hover:bg-fd-accent hover:text-fd-accent-foreground data-[state=open]:bg-fd-accent data-[state=open]:text-fd-accent-foreground"
          >
            <span>Open in</span>
            <ChevronDown className="size-3.5" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={6}
            className="z-50 w-[200px] rounded-md border border-fd-border bg-fd-popover p-1 text-sm text-fd-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          >
            <button
              type="button"
              onClick={handleCopyLink}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-fd-muted-foreground transition hover:bg-fd-accent hover:text-fd-accent-foreground"
            >
              {linkCopied ? (
                <Check className="size-4" />
              ) : (
                <LinkIcon className="size-4" />
              )}
              <span>{linkCopied ? "Link copied" : "Copy markdown link"}</span>
            </button>
            <button
              type="button"
              onClick={handleOpenLink}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-fd-muted-foreground transition hover:bg-fd-accent hover:text-fd-accent-foreground"
            >
              <ExternalLink className="size-4" />
              <span>Open in new tab</span>
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
