import { test } from "node:test";
import assert from "node:assert/strict";
import { checkStatistics, runStats } from "./families.ts";
import { vectorFiles, vectorJson } from "./vectors.ts";
import { Assurance, Preimage } from "../src/block.ts";
import type { Config } from "../src/config.ts";
import { FULL, TINY } from "../src/config.ts";
import { coreStats, CoreStats, serviceStats, ServiceStats } from "../src/statistics.ts";
import { WorkReport } from "../src/work.ts";

test("an empty block: its author makes one more block, and that's all", () => {
  const { before, after } = runStats("stf/statistics/tiny/stats_with_empty_extrinsic-1.json");
  const authorBlocks: number = after.current[1].blocks; // validator 1 made it
  assert.equal(authorBlocks, before.current[1].blocks + 1);
  assert.deepEqual(after.current[0], before.current[0]); // validator 0 did nothing
});

test("an epoch's first block: assurances close the old tally, the rest opens the new one", () => {
  const name = "stf/statistics/tiny/stats_with_epoch_change-1.json";
  const { before, after } = runStats(name);
  const closed: number = after.last[0].assurances; // into the old one
  assert.equal(closed, before.current[0].assurances + 1);
  assert.deepEqual([after.current[0].blocks, after.current[0].assurances], [0, 0]); // fresh
  assert.equal(after.current[1].blocks, 1); // the author's block starts the fresh tally
});

for (const size of ["tiny", "full"]) {
  for (const name of vectorFiles(`stf/statistics/${size}`)) {
    test(`${name}: every validator's tallies end as the vector says`, () => checkStatistics(name));
  }
}

/** The vectors in `dir` whose block is valid: a block that fails changes no tally. */
function validVectors(dir: string) {
  const valid = (name: string) => "ok" in (vectorJson(name) as { output: object }).output;
  return vectorFiles(dir).filter(valid);
}

/** Service tallies as the vectors write them: a list of ids, each with its tally. */
type ServiceTallies = { id: number; record: unknown }[];

/** The vectors' service tallies, as a map from service id to tally. */
const serviceTallies = (json: ServiceTallies) =>
  new Map(json.map((s) => [s.id, ServiceStats.fromJson(s.record)]));

/** A reports test vector, as far as statistics go: the new reports, and the tallies after. */
type ReportsVector = {
  input: { guarantees: { report: unknown }[] };
  post_state: { cores_statistics: unknown[]; services_statistics: ServiceTallies };
};

/** One block of reports vector `name`: core and service tallies, yours and the vector's. */
function runWork(config: Config, name: string) {
  const v = vectorJson(name) as ReportsVector;
  const incoming = v.input.guarantees.map((g) => WorkReport.fromJson(g.report));
  const cores = coreStats(config, incoming, [], []);
  const services = serviceStats(incoming, [], new Map());
  const post = v.post_state;
  const expected = {
    cores: post.cores_statistics.map((c) => CoreStats.fromJson(c)),
    services: serviceTallies(post.services_statistics),
  };
  return { cores, services, expected };
}

test("one big report: its core and its service take on all its work", () => {
  const { cores, services } = runWork(TINY, "stf/reports/tiny/big_work_report_output-1.json");
  assert.deepEqual([cores[0].bundle_size, cores[0].gas_used], [17180, 821n]);
  assert.equal(services.get(42)?.refinement_count, 2); // the report's two digests
  assert.equal(cores[1].gas_used, 0n); // core 1 took on nothing
});

/** An assurances test vector: the block's assurances, and the reports they made available. */
type AssurancesVector = {
  input: { assurances: unknown[] };
  output: { ok: { reported: unknown[] } };
};

test("assured data: each core's load, and how many assurances name it", () => {
  const v = vectorJson("stf/assurances/tiny/some_assurances-1.json") as AssurancesVector;
  const assurances = v.input.assurances.map((a) => Assurance(TINY).fromJson(a));
  const available: WorkReport[] = v.output.ok.reported.map((r) => WorkReport.fromJson(r));
  const cores: CoreStats[] = coreStats(TINY, [], available, assurances);
  // core 0's report became available: a 12345-byte bundle, and 3 segments plus 1 proof page
  assert.deepEqual([cores[0].da_load, cores[0].popularity], [12345 + 4104 * 4, 5]);
  assert.deepEqual([cores[1].da_load, cores[1].popularity], [0, 4]); // 4 of 6 isn't enough
});

for (const config of [TINY, FULL]) {
  for (const name of validVectors(`stf/reports/${config.name}`)) {
    test(`${name}: every core's and service's work ends as the vector says`, () => {
      const { cores, services, expected } = runWork(config, name);
      assert.deepEqual({ cores, services }, expected);
    });
  }
}

/** A preimages test vector, as far as statistics go: the preimages, and the tallies after. */
type PreimagesVector = {
  input: { preimages: unknown[] };
  post_state: { statistics: ServiceTallies };
};

for (const config of [TINY, FULL]) {
  for (const name of validVectors(`stf/preimages/${config.name}`)) {
    test(`${name}: every service's provided preimages end as the vector says`, () => {
      const v = vectorJson(name) as PreimagesVector;
      const preimages: Preimage[] = v.input.preimages.map((p) => Preimage.fromJson(p));
      const services: Map<number, ServiceStats> = serviceStats([], preimages, new Map());
      const expected: Map<number, ServiceStats> = serviceTallies(v.post_state.statistics);
      assert.deepEqual(services, expected);
    });
  }
}
