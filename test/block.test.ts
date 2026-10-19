import { PreimagesExtrinsic, TicketsExtrinsic, AssurancesExtrinsic , GuaranteesExtrinsic, DisputesExtrinsic, Header, Block, Extrinsic } from "../src/block.ts";
import { testCodecVector } from "./vectors.ts";

testCodecVector("tickets_extrinsic", TicketsExtrinsic);
testCodecVector("preimages_extrinsic", PreimagesExtrinsic);
testCodecVector("assurances_extrinsic", AssurancesExtrinsic);
testCodecVector("guarantees_extrinsic", GuaranteesExtrinsic);
testCodecVector("disputes_extrinsic", DisputesExtrinsic);

testCodecVector("header_0", Header);
testCodecVector("header_1", Header);

testCodecVector("extrinsic", Extrinsic);
testCodecVector("block", Block);