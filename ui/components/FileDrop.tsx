import { useRef, useState, type DragEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { fileNameFromPath } from "../file-io.ts";
import { useTranslation } from "react-i18next";

interface FileDropProps {
  readonly label: string;
  readonly compact?: boolean;
  readonly fileName?: string;
  readonly machineName?: string;
  readonly details?: string;
  readonly tone?: "A" | "B";
  readonly onFile: (file: File) => void | Promise<void>;
  readonly tutorialId?: string;
}

export function FileDrop({ label, compact = false, fileName, machineName, details, tone, onFile, tutorialId }: FileDropProps) {
  const { t } = useTranslation("common");
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [opening, setOpening] = useState(false);

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void onFile(file);
  }

  async function openMachine(): Promise<void> {
    if (!isTauri()) {
      inputRef.current?.click();
      return;
    }
    setOpening(true);
    try {
      const [{ open }, { readTextFile }] = await Promise.all([
        import("@tauri-apps/plugin-dialog"),
        import("@tauri-apps/plugin-fs"),
      ]);
      const path = await open({
        title: t("files.openMachine"),
        multiple: false,
        directory: false,
        filters: [{ name: t("files.besiegeMachine"), extensions: ["bsg"] }],
      });
      if (path === null || Array.isArray(path)) return;
      const text = await readTextFile(path);
      await onFile(new File([text], fileNameFromPath(path), { type: "application/xml" }));
    } finally {
      setOpening(false);
    }
  }

  return (
    <div
      className={`file-drop ${compact ? "compact" : ""} ${dragging ? "is-dragging" : ""} ${tone ? `machine-${tone.toLowerCase()}` : ""}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
      data-testid={`file-drop-${label}`}
      data-tutorial={tutorialId}
    >
      {tone && <span className="machine-marker" aria-hidden="true">{tone}</span>}
      <div className="file-drop-copy">
        <span className="panel-kicker">{label}</span>
        <strong>{machineName ?? fileName ?? t("files.dropMachine")}</strong>
        {machineName && fileName && <small className="machine-file-name" title={fileName}>{fileName}</small>}
        {details && <small>{details}</small>}
        {!compact && <small>{t("files.localOnly")}</small>}
      </div>
      <button type="button" className="secondary-button" disabled={opening} onClick={() => void openMachine()}>
        {opening ? t("files.opening") : fileName ? t("actions.replace") : t("files.openBsg")}
      </button>
      <input
        ref={inputRef}
        hidden
        type="file"
        accept=".bsg,application/xml,text/xml"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onFile(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}
