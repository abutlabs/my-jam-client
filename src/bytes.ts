// Bytes: the Gray Paper's octet strings (GP §3).

/** An octet string: the GP's 𝔹, and fixed-length kinds of it such as ℍ (32 bytes). */
export type Bytes = Uint8Array;

/** The bytes as the test vectors write them: "0x", then two hex digits per byte. */
export function toHex(bytes: Bytes): string {
  return "0x" + bytes.toHex();
}

/** The bytes back from "0x" hex. */
export function fromHex(hex: string): Bytes {
  return Uint8Array.fromHex(hex.slice(2)); // slice(2) skips the "0x"
}

/** The parts one after another: the GP's ⌢. */
export function concatBytes(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}