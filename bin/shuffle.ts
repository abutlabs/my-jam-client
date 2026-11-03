// Shuffles the numbers 0 to n − 1 with a hash, as the shuffle vectors do, and shows each
// pick on the way.
// Usage: npm run shuffle <how many> <hash>, e.g.
//        npm run shuffle 8 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff

import { fromHex } from "../src/bytes.ts";
import { Run } from "../src/obs.ts";
import { shuffleWithHash } from "../src/shuffle.ts";

const [count, hash] = process.argv.slice(2);
const items = Array.from({ length: Number(count) }, (_, i) => i);
const run = new Run("shuffle");
const shuffled = shuffleWithHash(items, fromHex(hash), {
  event(step, fields) {
    run.event(step, fields);
    const { number, left, index, picked } = fields as Record<string, number>;
    const sum = `${String(number).padStart(10)} mod ${String(left).padStart(3)} = ${index}`;
    console.log(`${sum}: pick ${picked}`);
  },
});
const order = shuffled.join(", ");
console.log(`shuffled: ${order}`);
run.event("shuffled", { order });
const link = await run.report();
if (link) console.log(`reported to Grafana: ${link}`);
