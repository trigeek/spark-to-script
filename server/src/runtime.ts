// SPDX-License-Identifier: AGPL-3.0-only

import type { Server } from "node:http";
import { SqliteProjectRepository } from "./adapters/sqlite/sqlite-project-repository.js";
import { RunEventBroker } from "./application/run-event-broker.js";
import { RunExecutor } from "./application/run-executor.js";
import { RunService } from "./application/run-service.js";
import { createSparkToScriptHttpServer } from "./http/create-http-server.js";
import type { ModelGateway } from "./model/model-gateway.js";

export type SparkToScriptRuntime = {
  repository: SqliteProjectRepository;
  broker: RunEventBroker;
  executor: RunExecutor | null;
  service: RunService;
  server: Server;
  recover(): Promise<void>;
  close(): Promise<void>;
};

export function createSparkToScriptRuntime(options: {
  databasePath: string;
  gateway?: ModelGateway;
  onUnexpectedError?: (error: unknown) => void;
}): SparkToScriptRuntime {
  const repository = new SqliteProjectRepository(options.databasePath);
  const broker = new RunEventBroker();
  const gateway = options.gateway;
  const executor = gateway ? new RunExecutor(repository, gateway, broker) : null;
  const execution = gateway && executor ? { gateway, executor } : null;
  const service = new RunService(repository, execution, broker);
  const httpOptions: Parameters<typeof createSparkToScriptHttpServer>[0] = { service, repository, broker };
  if (options.onUnexpectedError) httpOptions.onUnexpectedError = options.onUnexpectedError;
  const server = createSparkToScriptHttpServer(httpOptions);

  return {
    repository,
    broker,
    executor,
    service,
    server,
    recover: () => executor ? executor.recoverIncompleteRuns() : Promise.resolve(),
    close: async () => {
      await executor?.dispose();
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => error ? reject(error) : resolve());
        });
      }
      repository.close();
    },
  };
}
