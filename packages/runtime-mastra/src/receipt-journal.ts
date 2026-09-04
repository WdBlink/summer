import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  NodeReceiptV1Schema,
  canonicalJson,
  type NodeReceiptV1
} from "@summer/protocol";

export interface ReceiptJournalSnapshot {
  readonly path: string;
  readonly receiptCount: number;
  readonly receiptIds: readonly string[];
}

/** Durable JSONL sink: exact replay is idempotent; conflicting replay fails. */
export class AppendOnlyReceiptJournal {
  readonly #path: string;
  readonly #receipts = new Map<string, NodeReceiptV1>();

  constructor(path: string) {
    if (!isAbsolute(path)) {
      throw new Error("receipt journal path must be absolute");
    }
    this.#path = resolve(path);
    mkdirSync(dirname(this.#path), { recursive: true });
    this.#load();
  }

  public append(input: NodeReceiptV1): boolean {
    const receipt = NodeReceiptV1Schema.parse(input);
    const existing = this.#receipts.get(receipt.receiptId);
    if (existing !== undefined) {
      if (canonicalJson(existing) !== canonicalJson(receipt)) {
        throw new Error(
          `receipt journal conflict for immutable receiptId '${receipt.receiptId}'`
        );
      }
      return false;
    }
    appendFileSync(this.#path, `${canonicalJson(receipt)}\n`, {
      encoding: "utf8",
      flag: "a"
    });
    this.#receipts.set(receipt.receiptId, receipt);
    return true;
  }

  public snapshot(): ReceiptJournalSnapshot {
    return Object.freeze({
      path: this.#path,
      receiptCount: this.#receipts.size,
      receiptIds: Object.freeze([...this.#receipts.keys()])
    });
  }

  #load(): void {
    if (!existsSync(this.#path)) return;
    const lines = readFileSync(this.#path, "utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]?.trim();
      if (line === undefined || line.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line) as unknown;
      } catch (error) {
        throw new Error(
          `receipt journal '${this.#path}' line ${index + 1} is invalid JSON: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      const receipt = NodeReceiptV1Schema.parse(parsed);
      const existing = this.#receipts.get(receipt.receiptId);
      if (
        existing !== undefined &&
        canonicalJson(existing) !== canonicalJson(receipt)
      ) {
        throw new Error(
          `receipt journal '${this.#path}' contains conflicting receiptId '${receipt.receiptId}'`
        );
      }
      this.#receipts.set(receipt.receiptId, receipt);
    }
  }
}
