import type { Quaternion, Vec3 } from "./math.ts";

export interface BsgBlock {
  readonly id: number;
  readonly guid: string;
  /** Block-root position in machine-local coordinates. */
  readonly position: Vec3;
  /** Block-root rotation in machine-local coordinates, stored as x/y/z/w. */
  readonly rotation: Quaternion;
  readonly scale: Vec3;
  readonly booleans: ReadonlyMap<string, boolean>;
  readonly singles: ReadonlyMap<string, number>;
  readonly integers: ReadonlyMap<string, number>;
  readonly strings: ReadonlyMap<string, string>;
  readonly vectors: ReadonlyMap<string, Vec3>;
}

export interface BsgMachine {
  readonly source: string;
  readonly name: string;
  readonly version: string;
  readonly bsgVersion: string;
  readonly globalPosition: Vec3;
  readonly globalRotation: Quaternion;
  readonly blocks: readonly BsgBlock[];
  readonly warnings: readonly string[];
}

export interface VanillaBlade extends BsgBlock {
  readonly kind: "Propeller" | "SmallPropeller";
  readonly flipped: boolean;
  readonly flippedWasSerialized: boolean;
}

const ATTRIBUTE_PATTERN = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits: string) => String.fromCodePoint(Number.parseInt(digits, 16)));
}

function parseAttributes(source: string, context: string): Map<string, string> {
  const attributes = new Map<string, string>();
  let coveredUntil = 0;
  ATTRIBUTE_PATTERN.lastIndex = 0;

  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    const index = match.index ?? 0;
    const gap = source.slice(coveredUntil, index);
    if (gap.trim() !== "" && gap.trim() !== "/") {
      throw new Error(`${context}: malformed attributes near ${JSON.stringify(gap.trim())}`);
    }
    attributes.set(match[1], decodeXml(match[2] ?? match[3] ?? ""));
    coveredUntil = index + match[0].length;
  }

  const tail = source.slice(coveredUntil).trim();
  if (tail !== "" && tail !== "/") {
    throw new Error(`${context}: malformed attribute tail ${JSON.stringify(tail)}`);
  }
  return attributes;
}

function requiredAttribute(attributes: ReadonlyMap<string, string>, key: string, context: string): string {
  const value = attributes.get(key);
  if (value === undefined) {
    throw new Error(`${context}: missing ${key} attribute`);
  }
  return value;
}

function finiteNumber(text: string, context: string): number {
  if (text.trim() === "") {
    throw new Error(`${context}: empty number`);
  }
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new Error(`${context}: invalid finite number ${JSON.stringify(text)}`);
  }
  return value;
}

function integer(text: string, context: string): number {
  const value = finiteNumber(text, context);
  if (!Number.isInteger(value)) {
    throw new Error(`${context}: expected integer, got ${JSON.stringify(text)}`);
  }
  return value;
}

function elementBody(source: string, tag: string, context: string): string {
  const match = source.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!match) {
    throw new Error(`${context}: missing <${tag}> element`);
  }
  return match[1];
}

function elementAttributes(source: string, tag: string, context: string): Map<string, string> {
  const match = source.match(new RegExp(`<${tag}\\b([^>]*)/?>`, "i"));
  if (!match) {
    throw new Error(`${context}: missing <${tag}> element`);
  }
  return parseAttributes(match[1], `${context} <${tag}>`);
}

function vec3FromElement(source: string, tag: string, context: string): Vec3 {
  const attributes = elementAttributes(source, tag, context);
  return [
    finiteNumber(requiredAttribute(attributes, "x", context), `${context}.${tag}.x`),
    finiteNumber(requiredAttribute(attributes, "y", context), `${context}.${tag}.y`),
    finiteNumber(requiredAttribute(attributes, "z", context), `${context}.${tag}.z`),
  ];
}

function quaternionFromElement(source: string, tag: string, context: string): Quaternion {
  const attributes = elementAttributes(source, tag, context);
  return {
    x: finiteNumber(requiredAttribute(attributes, "x", context), `${context}.${tag}.x`),
    y: finiteNumber(requiredAttribute(attributes, "y", context), `${context}.${tag}.y`),
    z: finiteNumber(requiredAttribute(attributes, "z", context), `${context}.${tag}.z`),
    w: finiteNumber(requiredAttribute(attributes, "w", context), `${context}.${tag}.w`),
  };
}

function parseBooleans(blockBody: string, context: string): Map<string, boolean> {
  const booleans = new Map<string, boolean>();
  const dataMatch = blockBody.match(/<Data\b[^>]*>([\s\S]*?)<\/Data>/i);
  if (!dataMatch) return booleans;

  const pattern = /<Boolean\b([^>]*)>([\s\S]*?)<\/Boolean>/gi;
  for (const match of dataMatch[1].matchAll(pattern)) {
    const attributes = parseAttributes(match[1], `${context} <Boolean>`);
    const key = requiredAttribute(attributes, "key", `${context} <Boolean>`);
    const raw = decodeXml(match[2].trim()).toLowerCase();
    if (raw !== "true" && raw !== "false") {
      throw new Error(`${context}: Boolean ${JSON.stringify(key)} has invalid value ${JSON.stringify(match[2].trim())}`);
    }
    booleans.set(key, raw === "true");
  }
  return booleans;
}

function parseNumericData(
  blockBody: string,
  tag: "Single" | "Integer",
  context: string,
): Map<string, number> {
  const values = new Map<string, number>();
  const dataMatch = blockBody.match(/<Data\b[^>]*>([\s\S]*?)<\/Data>/i);
  if (!dataMatch) return values;
  const pattern = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "gi");
  for (const match of dataMatch[1].matchAll(pattern)) {
    const attributes = parseAttributes(match[1], `${context} <${tag}>`);
    // SingleArray/IntegerArray children use the same element tags without a
    // mapper key. Only keyed, top-level mapper values belong in this model.
    const key = attributes.get("key");
    if (key === undefined) continue;
    const raw = decodeXml(match[2].trim());
    const value = tag === "Integer"
      ? integer(raw, `${context} ${tag} ${key}`)
      : Number(raw);
    // Mod mappers can intentionally serialize +/-Infinity (the target fixture
    // uses it for acceleration). Preserve it as mapper data; transforms remain
    // strictly finite and consumers must validate values they act upon.
    if (tag === "Single" && Number.isNaN(value)) {
      throw new Error(`${context} ${tag} ${key}: invalid number ${JSON.stringify(raw)}`);
    }
    values.set(key, value);
  }
  return values;
}

function parseStringData(blockBody: string, context: string): Map<string, string> {
  const values = new Map<string, string>();
  const dataMatch = blockBody.match(/<Data\b[^>]*>([\s\S]*?)<\/Data>/i);
  if (!dataMatch) return values;
  // A self-closing mapper string must not consume the following String as its
  // body. BuildEdge/BuildSurface commonly serialize an empty
  // bmt-TransformHolder immediately before their real start/end/edges values.
  const pattern = /<String\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/String>)/gi;
  for (const match of dataMatch[1].matchAll(pattern)) {
    const attributes = parseAttributes(match[1], `${context} <String>`);
    const key = attributes.get("key");
    // StringArray child items do not have keys and are outside this PoC's data model.
    if (key !== undefined) values.set(key, decodeXml((match[2] ?? "").trim()));
  }
  return values;
}

function parseVectorData(blockBody: string, context: string): Map<string, Vec3> {
  const values = new Map<string, Vec3>();
  const dataMatch = blockBody.match(/<Data\b[^>]*>([\s\S]*?)<\/Data>/i);
  if (!dataMatch) return values;
  const pattern = /<Vector3\b([^>]*)>([\s\S]*?)<\/Vector3>/gi;
  for (const match of dataMatch[1].matchAll(pattern)) {
    const attributes = parseAttributes(match[1], `${context} <Vector3>`);
    const key = attributes.get("key");
    if (key === undefined) continue;
    const component = (name: "X" | "Y" | "Z"): number => {
      const componentMatch = match[2].match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
      if (!componentMatch) throw new Error(`${context} Vector3 ${key}: missing <${name}>`);
      return finiteNumber(decodeXml(componentMatch[1].trim()), `${context} Vector3 ${key}.${name}`);
    };
    values.set(key, [component("X"), component("Y"), component("Z")]);
  }
  return values;
}

/**
 * Parses the stable subset of the BSG XML schema used by the physics PoC.
 * Unknown Settings/Data entries are deliberately ignored; structural or numeric
 * errors in transforms are not silently repaired.
 */
export function parseBsg(xml: string, source = "<memory>"): BsgMachine {
  const cleaned = xml.replace(/<!--[\s\S]*?-->/g, "");
  const machineMatch = cleaned.match(/<Machine\b([^>]*)>/i);
  if (!machineMatch || !/<\/Machine>\s*$/i.test(cleaned.trim())) {
    throw new Error(`${source}: not a complete Besiege <Machine> document`);
  }

  const machineAttributes = parseAttributes(machineMatch[1], `${source} <Machine>`);
  const name = requiredAttribute(machineAttributes, "name", `${source} <Machine>`);
  const version = requiredAttribute(machineAttributes, "version", `${source} <Machine>`);
  const bsgVersion = requiredAttribute(machineAttributes, "bsgVersion", `${source} <Machine>`);
  const globalBody = elementBody(cleaned, "Global", source);
  const blocksBody = elementBody(cleaned, "Blocks", source);
  const warnings: string[] = [];
  const blocks: BsgBlock[] = [];

  const blockPattern = /<Block\b([^>]*)>([\s\S]*?)<\/Block>/gi;
  for (const match of blocksBody.matchAll(blockPattern)) {
    const attributes = parseAttributes(match[1], `${source} <Block>`);
    const id = integer(requiredAttribute(attributes, "id", `${source} <Block>`), `${source} Block.id`);
    const guid = requiredAttribute(attributes, "guid", `${source} <Block>`);
    const context = `${source} Block ${guid}`;
    const transform = elementBody(match[2], "Transform", context);
    blocks.push({
      id,
      guid,
      position: vec3FromElement(transform, "Position", context),
      rotation: quaternionFromElement(transform, "Rotation", context),
      scale: vec3FromElement(transform, "Scale", context),
      booleans: parseBooleans(match[2], context),
      singles: parseNumericData(match[2], "Single", context),
      integers: parseNumericData(match[2], "Integer", context),
      strings: parseStringData(match[2], context),
      vectors: parseVectorData(match[2], context),
    });
  }

  const rawBlockOpenCount = [...blocksBody.matchAll(/<Block\b/gi)].length;
  if (blocks.length !== rawBlockOpenCount) {
    throw new Error(`${source}: parsed ${blocks.length} of ${rawBlockOpenCount} <Block> elements`);
  }
  if (blocks.length === 0) warnings.push("Machine contains no blocks");

  return {
    source,
    name,
    version,
    bsgVersion,
    globalPosition: vec3FromElement(globalBody, "Position", `${source} Global`),
    globalRotation: quaternionFromElement(globalBody, "Rotation", `${source} Global`),
    blocks,
    warnings,
  };
}

export function extractVanillaBlades(machine: BsgMachine): VanillaBlade[] {
  const blades: VanillaBlade[] = [];
  for (const block of machine.blocks) {
    if (block.id !== 26 && block.id !== 55) continue;
    const flippedWasSerialized = block.booleans.has("flipped");
    blades.push({
      ...block,
      kind: block.id === 26 ? "Propeller" : "SmallPropeller",
      flipped: block.booleans.get("flipped") ?? false,
      flippedWasSerialized,
    });
  }
  return blades;
}
