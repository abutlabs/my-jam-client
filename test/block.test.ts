import { PreimagesExtrinsic, TicketsExtrinsic, AssurancesExtrinsic } from "../src/block.ts";
import { testCodecVector } from "./vectors.ts";

testCodecVector("tickets_extrinsic", TicketsExtrinsic);
testCodecVector("preimages_extrinsic", PreimagesExtrinsic);
testCodecVector("assurances_extrinsic", AssurancesExtrinsic);
