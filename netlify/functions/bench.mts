import type { Config, Context } from "@netlify/functions";
import rawConfig from "../../bench.config.json" with { type: "json" };
import {
  createFetchBenchHandler,
  createNetlifyConfigLoader,
} from "../../src/fetch-handler.js";
import type { RawBenchConfig } from "../../src/types.js";

const handle = createFetchBenchHandler({
  loadConfig: createNetlifyConfigLoader(process.env, rawConfig as RawBenchConfig),
  runtime: "netlify",
});

export default async function bench(request: Request, _context: Context): Promise<Response> {
  return handle(request);
}

export const config: Config = {
  path: "/*",
  excludedPath: ["/.netlify/*"],
  preferStatic: false,
};
