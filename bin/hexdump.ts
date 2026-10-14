// Prints the first bytes of a file in hex, 16 to a line.
// Usage: node bin/hexdump.ts <file> [how many bytes, 64 if not given]

import { readFileSync } from "node:fs";

const [file, count = "64"] = process.argv.slice(2);
if (!file) throw new Error("usage: node bin/hexdump.ts <file> [count]");
const bytes = readFileSync(file).subarray(0, Number(count));
for (let i = 0; i < bytes.length; i += 16) {
  console.log([...bytes.subarray(i, i + 16)].map((b) => b.toString(16).padStart(2, "0")).join(" "));
}