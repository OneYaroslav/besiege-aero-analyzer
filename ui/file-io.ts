import { isTauri } from "@tauri-apps/api/core";

export interface FileFilter {
  readonly name: string;
  readonly extensions: readonly string[];
  readonly mimeType: string;
}

export interface SaveTextFileOptions {
  readonly suggestedName: string;
  readonly content: string;
  readonly filter: FileFilter;
}

export interface OpenTextFileOptions {
  readonly filter: FileFilter;
  readonly title?: string;
}

export interface SavedTextFile {
  readonly name: string;
  readonly path?: string;
  readonly desktop: boolean;
}

export interface OpenedTextFile {
  readonly name: string;
  readonly text: string;
  readonly path?: string;
  readonly desktop: boolean;
}

export interface FileIo {
  saveTextFile(options: SaveTextFileOptions): Promise<SavedTextFile | null>;
  openTextFile(options: OpenTextFileOptions): Promise<OpenedTextFile | null>;
}

export const JSON_FILE_FILTER: FileFilter = { name: "JSON", extensions: ["json"], mimeType: "application/json" };
export const CSV_FILE_FILTER: FileFilter = { name: "CSV", extensions: ["csv"], mimeType: "text/csv;charset=utf-8" };

export function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
}

export function fileNameFromPath(path: string): string {
  return path.split(/[\\/]/).at(-1) || path;
}

export interface BrowserFileIoDependencies {
  readonly download: (content: string, fileName: string, mimeType: string) => void;
  readonly pick: (accept: string) => Promise<{ readonly name: string; readonly text: string } | null>;
}

function downloadInBrowser(content: string, fileName: string, mimeType: string): void {
  const href = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
}

function pickInBrowser(accept: string): Promise<{ readonly name: string; readonly text: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.hidden = true;
    let settled = false;
    const finish = (value: { readonly name: string; readonly text: string } | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      input.remove();
      reject(cause);
    };
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) { finish(null); return; }
      file.text().then((text) => finish({ name: file.name, text }), fail);
    }, { once: true });
    input.addEventListener("cancel", () => finish(null), { once: true });
    window.addEventListener("focus", () => window.setTimeout(() => {
      if (!input.files?.length) finish(null);
    }, 250), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

export function createBrowserFileIo(dependencies: BrowserFileIoDependencies = { download: downloadInBrowser, pick: pickInBrowser }): FileIo {
  return {
    async saveTextFile(options) {
      const name = safeFileName(options.suggestedName);
      dependencies.download(options.content, name, options.filter.mimeType);
      return { name, desktop: false };
    },
    async openTextFile(options) {
      const accept = options.filter.extensions.map((extension) => `.${extension}`).join(",");
      const selected = await dependencies.pick(accept);
      return selected ? { ...selected, desktop: false } : null;
    },
  };
}

export function createDesktopFileIo(): FileIo {
  return {
    async saveTextFile(options) {
      const [{ save }, { writeTextFile }] = await Promise.all([
        import("@tauri-apps/plugin-dialog"),
        import("@tauri-apps/plugin-fs"),
      ]);
      const path = await save({
        title: `Save ${options.filter.name}`,
        defaultPath: safeFileName(options.suggestedName),
        filters: [{ name: options.filter.name, extensions: [...options.filter.extensions] }],
      });
      if (path === null) return null;
      await writeTextFile(path, options.content);
      return { name: fileNameFromPath(path), path, desktop: true };
    },
    async openTextFile(options) {
      const [{ open }, { readTextFile }] = await Promise.all([
        import("@tauri-apps/plugin-dialog"),
        import("@tauri-apps/plugin-fs"),
      ]);
      const path = await open({
        title: options.title ?? `Open ${options.filter.name}`,
        multiple: false,
        directory: false,
        filters: [{ name: options.filter.name, extensions: [...options.filter.extensions] }],
      });
      if (path === null || Array.isArray(path)) return null;
      return { name: fileNameFromPath(path), path, text: await readTextFile(path), desktop: true };
    },
  };
}

let activeFileIo: FileIo | undefined;

export function getFileIo(): FileIo {
  activeFileIo ??= isTauri() ? createDesktopFileIo() : createBrowserFileIo();
  return activeFileIo;
}
