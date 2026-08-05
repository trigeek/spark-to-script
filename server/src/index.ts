// SPDX-License-Identifier: AGPL-3.0-only

import { resolve } from "node:path";
import { createSparkToScriptRuntime } from "./runtime.js";

const port = parsePort(process.env.PORT);
const databasePath = process.env.SPARK_TO_SCRIPT_DB_PATH
  ? resolve(process.env.SPARK_TO_SCRIPT_DB_PATH)
  : resolve(process.cwd(), "data/spark-to-script.sqlite");

const runtime = createSparkToScriptRuntime({
  databasePath,
  onUnexpectedError: (error) => console.error("Spark to Script runtime error", safeErrorName(error)),
});

await runtime.recover();
runtime.server.listen(port, "127.0.0.1", () => {
  console.info(`Spark to Script runtime listening on http://127.0.0.1:${port}`);
});

const shutdown = async () => {
  await runtime.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

function parsePort(value: string | undefined): number {
  const parsed = value ? Number.parseInt(value, 10) : 8787;
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return parsed;
}

function safeErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
