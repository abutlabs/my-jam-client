// Runs two tiny programs on your PVM's memory: one stores 8 bytes and loads them back, the
// other reaches for a page that isn't there.
// Usage: npm run memory

import { toHex } from "../src/bytes.ts";
import { Run } from "../src/obs.ts";
import { HALT_ADDRESS, newMachine, run } from "../src/pvm/machine.ts";
import type { Memory } from "../src/pvm/memory.ts";
import { addPages } from "../src/pvm/memory.ts";
import { assemble } from "../src/pvm/program.ts";

const report = new Run("memory");
const say = (line: string) => {
  console.log(line);
  report.event("memory", { line });
};

const memory: Memory = new Map();
addPages(memory, 0x20000, 4096, "W");
const page = () => toHex((memory.get(0x20) as { bytes: Uint8Array }).bytes.subarray(0, 8));
say(`page 0x20000 before: ${page()}`);
const roundTrip = assemble([[123, 0x12], [130, 0x13], [125, 0x14], [50, 0x00]]);
const machine = newMachine(roundTrip, [HALT_ADDRESS, 0x20000n, 0x1122334455667780n], memory);
say(`run: ${run(machine)}`);
say(`page 0x20000 after:  ${page()}  (little-endian: the lowest byte first)`);
say(`r3 = 0x${machine.registers[3].toString(16)}  (all 8 bytes back)`);
say(`r4 = 0x${machine.registers[4].toString(16)}  (one byte, 0x80, sign-extended: −128)`);

const faulty = newMachine(assemble([[52, 0x01, 0x05, 0x00, 0x03]])); // load_u8 r1, [0x30005]
const exit = run(faulty);
const shown =
  typeof exit === "object" && "fault" in exit ? `a fault at 0x${exit.fault.toString(16)}` : exit;
say(`load from 0x30005, where there's no page: ${shown}`);
const link = await report.report();
if (link) console.log(`reported to Grafana: ${link}`);
