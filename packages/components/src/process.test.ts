import { describe, expect, it } from "vitest";
import { superviseProcess } from "./process.js";

describe("shared subprocess supervision", () => {
  it("captures output and terminates a long-running worker on abort", async () => {
    const output = await superviseProcess(process.execPath, ["-e", "process.stdout.write('ready')"], { cwd: process.cwd() });
    expect(output).toMatchObject({ exitCode: 0, stdoutTail: "ready" });
    let heartbeats = 0;
    await expect(superviseProcess(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
      cwd: process.cwd(), signal: AbortSignal.timeout(100), terminationGraceMs: 100,
      heartbeatIntervalMs: 10, onHeartbeat: () => { heartbeats++; }
    })).rejects.toThrow();
    expect(heartbeats).toBeGreaterThan(0);
  });
});
