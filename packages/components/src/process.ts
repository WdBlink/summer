import { spawn } from "node:child_process";

export interface ProcessOptions {
  readonly cwd: string;
  readonly input?: string;
  readonly signal?: AbortSignal;
  readonly preserveStdout?: boolean;
  readonly heartbeatIntervalMs?: number;
  readonly terminationGraceMs?: number;
  readonly onHeartbeat?: (value: { observedAt: string; lastActivityAt: string; pid?: number }) => void;
}

/** One supervisor for host workers. Process groups are bounded on POSIX;
 * this is not a filesystem sandbox or a restriction on worker tool use. */
export async function superviseProcess(command: string, args: readonly string[], options: ProcessOptions) {
  options.signal?.throwIfAborted();
  return await new Promise<{ exitCode: number; stdoutTail: string; stderrTail: string }>((accept, reject) => {
    const grouped = process.platform !== "win32";
    const child = spawn(command, [...args], { cwd: options.cwd, stdio: ["pipe", "pipe", "pipe"], detached: grouped });
    let stdout = "", stderr = "", lastActivityAt = new Date().toISOString();
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (grouped && child.pid) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") reject(error);
      }
    };
    const abort = () => {
      kill("SIGTERM");
      killTimer = setTimeout(() => kill("SIGKILL"), options.terminationGraceMs ?? 2000);
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    const heartbeat = options.onHeartbeat ? setInterval(() => options.onHeartbeat?.({
      observedAt: new Date().toISOString(), lastActivityAt,
      ...(child.pid === undefined ? {} : { pid: child.pid })
    }), options.heartbeatIntervalMs ?? 5000) : undefined;
    child.stdout.on("data", (chunk: Buffer) => {
      lastActivityAt = new Date().toISOString();
      stdout = (stdout + chunk.toString()).slice(-(options.preserveStdout ? 4_000_000 : 24_000));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      lastActivityAt = new Date().toISOString();
      stderr = (stderr + chunk.toString()).slice(-24_000);
    });
    child.stdin.on("error", (error: NodeJS.ErrnoException) => { if (error.code !== "EPIPE") reject(error); });
    const cleanup = () => {
      options.signal?.removeEventListener("abort", abort);
      clearInterval(heartbeat);
      clearTimeout(killTimer);
      if (options.signal?.aborted) kill("SIGKILL");
    };
    child.once("error", (error) => { cleanup(); reject(error); });
    child.once("close", (code) => {
      cleanup();
      if (options.signal?.aborted) reject(options.signal.reason);
      else accept({ exitCode: code ?? 1, stdoutTail: stdout, stderrTail: stderr });
    });
    child.stdin.end(options.input);
  });
}
