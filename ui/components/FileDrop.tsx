import { useRef, useState, type DragEvent } from "react";

interface FileDropProps {
  readonly label: string;
  readonly compact?: boolean;
  readonly fileName?: string;
  readonly machineName?: string;
  readonly details?: string;
  readonly tone?: "A" | "B";
  readonly onFile: (file: File) => void | Promise<void>;
}

export function FileDrop({ label, compact = false, fileName, machineName, details, tone, onFile }: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void onFile(file);
  }

  return (
    <div
      className={`file-drop ${compact ? "compact" : ""} ${dragging ? "is-dragging" : ""} ${tone ? `machine-${tone.toLowerCase()}` : ""}`}
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
      data-testid={`file-drop-${label}`}
    >
      {tone && <span className="machine-marker" aria-hidden="true">{tone}</span>}
      <div className="file-drop-copy">
        <span className="panel-kicker">{label}</span>
        <strong>{machineName ?? fileName ?? "Drop a .bsg machine"}</strong>
        {machineName && fileName && <small className="machine-file-name" title={fileName}>{fileName}</small>}
        {details && <small>{details}</small>}
        {!compact && <small>Processed locally · file is never uploaded</small>}
      </div>
      <button type="button" className="secondary-button" onClick={() => inputRef.current?.click()}>
        {fileName ? "Replace" : "Open .bsg"}
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
