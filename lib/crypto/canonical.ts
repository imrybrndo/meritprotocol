/**
 * Canonical serialisation.
 *
 * A commitment is only meaningful if every party derives byte-identical input
 * from the same logical record. JSON.stringify is not sufficient: key order is
 * insertion-dependent and IEEE-754 formatting of numbers varies with how a
 * value was parsed. Everything here is therefore explicit.
 *
 * Rules:
 *  - objects serialise with keys sorted by UTF-16 code unit
 *  - undefined-valued keys are omitted; null is preserved
 *  - numbers must be finite and are emitted through `canonicalNumber`
 *  - strings are JSON-escaped
 *  - no floating point ever reaches the hash: decimals are fixed-scale strings
 */

/** Scale used for every monetary or quantity field in a commitment. */
export const DECIMAL_SCALE = 12;

export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue | undefined };

/**
 * Render a decimal as a fixed-scale string so that 182.4, "182.40" and
 * 182.400000 all commit to the same bytes.
 */
export function canonicalDecimal(
  value: number | string,
  scale: number = DECIMAL_SCALE,
): string {
  const raw = typeof value === "number" ? value : value.trim();

  if (typeof raw === "number" && !Number.isFinite(raw)) {
    throw new TypeError(`Cannot canonicalise non-finite number: ${raw}`);
  }

  const text = typeof raw === "number" ? raw.toFixed(scale) : raw;
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new TypeError(`Cannot canonicalise decimal: ${String(value)}`);
  }

  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [intPart, fracPart = ""] = unsigned.split(".");

  if (fracPart.length > scale) {
    // Refuse to silently round away precision that the caller supplied.
    const excess = fracPart.slice(scale).replace(/0+$/, "");
    if (excess.length > 0) {
      throw new RangeError(
        `Decimal ${String(value)} exceeds scale ${scale} with significant digits`,
      );
    }
  }

  const normalisedInt = intPart.replace(/^0+(?=\d)/, "");
  const normalisedFrac = fracPart.slice(0, scale).padEnd(scale, "0");
  const body = scale > 0 ? `${normalisedInt}.${normalisedFrac}` : normalisedInt;
  const isZero = /^0(\.0*)?$/.test(body);

  return negative && !isZero ? `-${body}` : body;
}

/** Integers only — used for counts, versions and millisecond timestamps. */
export function canonicalInteger(value: number): string {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`Expected a safe integer, received: ${value}`);
  }
  return String(value);
}

/** Timestamps commit as milliseconds since the Unix epoch. */
export function canonicalTimestamp(value: Date | string | number): string {
  const date =
    value instanceof Date
      ? value
      : new Date(typeof value === "number" ? value : String(value));

  const ms = date.getTime();
  if (!Number.isFinite(ms)) {
    throw new TypeError(`Cannot canonicalise timestamp: ${String(value)}`);
  }
  return canonicalInteger(ms);
}

function serialiseString(value: string): string {
  return JSON.stringify(value);
}

function serialiseNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Cannot canonicalise non-finite number: ${value}`);
  }
  return Number.isInteger(value) ? canonicalInteger(value) : canonicalDecimal(value);
}

/** Deterministic JSON-shaped encoding of an arbitrary metadata object. */
export function canonicalize(value: CanonicalValue): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return serialiseString(value);
    case "number":
      return serialiseNumber(value);
    case "boolean":
      return value ? "true" : "false";
    default:
      break;
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalize(entry)).join(",")}]`;
  }

  const record = value as Record<string, CanonicalValue | undefined>;
  const parts: string[] = [];

  for (const key of Object.keys(record).sort()) {
    const entry = record[key];
    if (entry === undefined) continue;
    parts.push(`${serialiseString(key)}:${canonicalize(entry)}`);
  }

  return `{${parts.join(",")}}`;
}
