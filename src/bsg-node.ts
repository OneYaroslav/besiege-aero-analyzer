import { readFileSync } from "node:fs";
import { parseBsg, type BsgMachine } from "./bsg.ts";

/** Node/CLI filesystem adapter. Browser UI passes File.text() to parseBsg. */
export function loadBsg(path: string): BsgMachine {
  return parseBsg(readFileSync(path, "utf8"), path);
}
