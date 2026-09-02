#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  SummerCliOperationError,
  compileFixtureWorkflows,
  compileWorkflowFile,
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

const USAGE = [
  "summer validate <workflow.json>",
  "summer compile <workflow.json>",
  "summer fixtures"
] as const;

export async function runCli(
  argv: readonly string[],
  io: CliIo = DEFAULT_IO,
  projectRoot: string = SUMMER_PROJECT_ROOT
): Promise<number> {
  const [command, ...args] = argv;

  try {
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
