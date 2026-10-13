"use client";

/** Download one product's cover wording as Markdown, built in the browser from the same object the page renders. */
import { useState } from "react";
import { coverWordingFilename, coverWordingMarkdown, type CoverWording } from "@plutusshield/sdk/wording";
import { Button } from "@/components/ui/Button";

export function WordingDownload({ wording }: { wording: CoverWording }) {
  const [saved, setSaved] = useState(false);
  const download = () => {
    const blob = new Blob([coverWordingMarkdown(wording)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = coverWordingFilename(wording);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setSaved(true);
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" onClick={download}>
        Download wording (.md)
      </Button>
      <span className="text-[11px] text-text-dim" role="status">
        {saved ? "Saved." : "Built in your browser from the deployment record."}
      </span>
    </div>
  );
}
