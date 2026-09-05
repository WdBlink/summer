#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { RepositoryRegistryOptions } from "./repository-catalog.js";
import { runNativeResearch } from "@summer/research-ideation";
import { runQuantLoop, resumeQuantLoop } from "@summer/runtime-mastra";
import { recoverProduct } from "@summer/runtime-mastra";
import { productContracts, validateProduct } from "@summer/runtime-mastra";
import { executeProduct, resumeProduct, productStatus, listProducts, loadProduct, matchProducts, promoteProduct, verifyProduct, publishProduct, selectProduct, planProduct } from "@summer/runtime-mastra";

import {
  SummerCliOperationError,
  checkRepositoryExtension,
  compileFixtureWorkflows,
  compileWorkflowFile,
  inspectRepositoryCatalog,
  matchRepositoryIntent,
  matchRepositoryCatalog,
  resumeRepositoryWorkflow,
  runRepositoryWorkflow,
  readJsonFile,
  validateWorkflowFile
} from "./commands.js";

export interface CliIo {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

const DEFAULT_IO: CliIo = {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`)
};

export const SUMMER_PROJECT_ROOT = fileURLToPath(
  new URL("../../..", import.meta.url)
);

const NATIVE_WORKFLOWS = [
  { reference: "research-ideation@4", command: "run research-ideation@4", runtime: "mastra-native", persistence: "libsql", dispatchable: true, keywords: ["idea spark", "research ideation", "研究构思", "研究想法", "选题"], requires: ["Idea Spark installation", "typed research provider grant"] },
  { reference: "dynamic-agent-workflow@2", command: "dynamic", runtime: "mastra-native", persistence: "libsql", dispatchable: true, keywords: ["dynamic", "动态工作流", "现场编排"], requires: ["product brief and request", "granted host planner"] },
  { reference: "quant-factor-tuning@2", command: "quant-loop", runtime: "mastra-native", persistence: "libsql", dispatchable: true, keywords: ["quant", "因子调优", "量化因子", "因子发现"], requires: ["published experiment products", "frozen validation evidence contract"], scope: "offline predeclared candidates; no trading or bundled backtest adapter" }
] as const;

const USAGE = [
  "summer contracts",
  "summer validate-product <product.json>",
  "summer quant-loop <plan.json> <grant.json>",
  "summer quant-resume <run-dir> <fresh-grant.json>",
  "summer dynamic <brief.json> <request.json>",
  "summer run-draft <product.json> <request.json>",
  "summer run-product <id[@version]> <request.json>",
  "summer resume-product <run-dir> <fresh-grant.json>",
  "summer recover-product <run-dir> <fresh-grant.json>",
  "summer status <run-dir>",
  "summer promote <run-dir> <candidate.json>",
  "summer verify <draft.json> <suite.json>",
  "summer publish <draft.json>",
  "summer select <id@version>",
  "summer products",
  "summer validate <workflow.json>",
  "summer compile <workflow.json>",
  "summer fixtures",
  "summer catalog",
  "summer run <workflow-id> <input.json>",
  "summer resume <workflow-id> <run-dir> <grant.json>",
  "summer match-intent <intent>",
  "summer match <request.json>",
  "summer extension-check <proposal.json>"
] as const;

export async function runCli(
  argv: readonly string[],
  io: CliIo = DEFAULT_IO,
  projectRoot: string = SUMMER_PROJECT_ROOT,
  registryOptions: RepositoryRegistryOptions = {}
): Promise<number> {
  const [command, ...args] = argv;

  try {
    if (command === "quant-resume") {
      requireArgumentCount(command, args, 2);
      io.stdout(stringify({ ok: true, command, result: await resumeQuantLoop(projectRoot, args[0]!, readJsonFile(args[1]!).value) })); return 0;
    }
    if (command === "contracts") {
      requireArgumentCount(command, args, 0);
      io.stdout(stringify({ ok: true, command, ...productContracts() })); return 0;
    }
    if (command === "validate-product") {
      requireArgumentCount(command, args, 1);
      io.stdout(stringify({ ok: true, command, product: validateProduct(readJsonFile(args[0]!).value) })); return 0;
    }
    if (command === "quant-loop") {
      requireArgumentCount(command, args, 2);
      io.stdout(stringify({ ok: true, command, result: await runQuantLoop(projectRoot, readJsonFile(args[0]!).value, readJsonFile(args[1]!).value) })); return 0;
    }
    if ((command === "run" || command === "resume") && args[0] === "research-ideation@4") {
      requireArgumentCount(command, args, command === "run" ? 2 : 3);
      const request = command === "run" ? readJsonFile(args[1]!).value : (() => {
        const manifest = readJsonFile(resolve(args[1]!, ".summer/request.json")).value as { query: string; workspaceDir: string; runDir: string };
        return { schemaVersion: "summer.research-ideation-request/v2", query: manifest.query, workspaceDir: manifest.workspaceDir, runDir: manifest.runDir, executionGrant: readJsonFile(args[2]!).value };
      })();
      io.stdout(stringify({ ok: true, command, result: await runNativeResearch(request, { ...registryOptions, resume: command === "resume" }) })); return 0;
    }
    if (command === "products") {
      requireArgumentCount(command, args, 0);
      io.stdout(stringify({ ok: true, command, products: listProducts(projectRoot) })); return 0;
    }
    if (command === "status") {
      requireArgumentCount(command, args, 1);
      io.stdout(stringify({ ok: true, command, ...productStatus(args[0]!) })); return 0;
    }
    if (command === "publish" || command === "select") {
      requireArgumentCount(command, args, 1);
      const result = command === "publish" ? publishProduct(projectRoot, args[0]!) : selectProduct(projectRoot, args[0]!);
      io.stdout(stringify({ ok: true, command, result })); return 0;
    }
    if (["dynamic", "run-draft", "run-product", "resume-product", "recover-product", "promote", "verify"].includes(command ?? "")) {
      requireArgumentCount(command!, args, 2);
      const value = readJsonFile(args[1]!).value;
      let result: unknown;
      if (command === "promote") result = promoteProduct(projectRoot, args[0]!, value);
      else if (command === "verify") result = await verifyProduct(args[0]!, value);
      else if (command === "resume-product") result = await resumeProduct(args[0]!, value);
      else if (command === "recover-product") result = await recoverProduct(args[0]!, value);
      else if (command === "dynamic") {
        const planned = await planProduct(readJsonFile(args[0]!).value, value);
        result = await executeProduct(planned.product, value);
      } else result = await executeProduct(command === "run-product" ? loadProduct(projectRoot, args[0]!) : readJsonFile(args[0]!).value, value);
      io.stdout(stringify({ ok: true, command, result })); return 0;
    }
    if (command === undefined || command === "help" || command === "--help" || command === "-h") {
      io.stdout(stringify({ ok: true, command: "help", usage: USAGE }));
      return 0;
    }

    if (command === "validate") {
      requireArgumentCount(command, args, 1);
      io.stdout(stringify(validateWorkflowFile(args[0]!)));
      return 0;
    }

    if (command === "compile") {
      requireArgumentCount(command, args, 1);
      io.stdout(stringify(compileWorkflowFile(args[0]!)));
      return 0;
    }

    if (command === "fixtures") {
      requireArgumentCount(command, args, 0);
      io.stdout(stringify(compileFixtureWorkflows(projectRoot)));
      return 0;
    }

    if (command === "catalog") {
      requireArgumentCount(command, args, 0);
      io.stdout(stringify({ ...inspectRepositoryCatalog(projectRoot), products: listProducts(projectRoot), nativeWorkflows: NATIVE_WORKFLOWS }));
      return 0;
    }

    if (command === "run") {
      requireArgumentCount(command, args, 2);
      io.stdout(
        stringify(
          await runRepositoryWorkflow(
            projectRoot,
            args[0]!,
            args[1]!,
            registryOptions
          )
        )
      );
      return 0;
    }

    if (command === "resume") {
      requireArgumentCount(command, args, 3);
      io.stdout(
        stringify(
          await resumeRepositoryWorkflow(
            projectRoot,
            args[0]!,
            args[1]!,
            args[2]!,
            registryOptions
          )
        )
      );
      return 0;
    }

    if (command === "match") {
      requireArgumentCount(command, args, 1);
      io.stdout(stringify(matchRepositoryCatalog(projectRoot, args[0]!)));
      return 0;
    }

    if (command === "match-intent") {
      requireAtLeastOneArgument(command, args);
      const intent = args.join(" ");
      io.stdout(stringify({ ...matchRepositoryIntent(projectRoot, intent), products: matchProducts(projectRoot, intent), nativeWorkflows: NATIVE_WORKFLOWS.filter((entry) => entry.keywords.some((keyword) => intent.toLowerCase().includes(keyword))) }));
      return 0;
    }

    if (command === "extension-check") {
      requireArgumentCount(command, args, 1);
      const result = checkRepositoryExtension(projectRoot, args[0]!);
      (result.ok ? io.stdout : io.stderr)(stringify(result));
      return result.ok ? 0 : 1;
    }

    throw new SummerCliUsageError(`Unknown command '${command}'`);
  } catch (error) {
    const normalized = normalizeError(error);
    io.stderr(
      stringify({
        ok: false,
        command: command ?? null,
        error: {
          code: normalized.code,
          message: normalized.message,
          ...(normalized.details === undefined ? {} : { details: normalized.details })
        }
      })
    );
    return normalized.exitCode;
  }
}

class SummerCliUsageError extends Error {
  readonly code = "USAGE_ERROR" as const;
  readonly exitCode = 2 as const;

  constructor(message: string) {
    super(message);
    this.name = "SummerCliUsageError";
  }
}

function requireArgumentCount(
  command: string,
  args: readonly string[],
  expected: number
): void {
  if (args.length !== expected) {
    throw new SummerCliUsageError(
      `Command '${command}' expects ${expected} argument${expected === 1 ? "" : "s"}; received ${args.length}`
    );
  }
}

function requireAtLeastOneArgument(command: string, args: readonly string[]): void {
  if (args.length === 0 || args.join(" ").trim().length === 0) {
    throw new SummerCliUsageError(
      `Command '${command}' expects a non-empty intent`
    );
  }
}

function normalizeError(error: unknown): {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
  readonly exitCode: number;
} {
  if (error instanceof SummerCliUsageError) {
    return {
      code: error.code,
      message: error.message,
      details: { usage: USAGE },
      exitCode: error.exitCode
    };
  }
  if (error instanceof SummerCliOperationError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      exitCode: 1
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: error instanceof Error ? error.message : String(error),
    exitCode: 1
  };
}

function stringify(value: unknown): string {
  return JSON.stringify(value);
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isMainModule()) {
  process.exitCode = await runCli(process.argv.slice(2));
}
