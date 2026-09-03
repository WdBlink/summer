import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const skillDirectory = join(repositoryRoot, "skills", "summer");
const skillFile = join(skillDirectory, "SKILL.md");
const agentMetadataFile = join(skillDirectory, "agents", "openai.yaml");
const protocolReferenceFile = join(
  skillDirectory,
  "references",
  "protocol.md"
);
const matchingReferenceFile = join(
  skillDirectory,
  "references",
  "matching.md"
);
const extensionsReferenceFile = join(
  skillDirectory,
  "references",
  "extensions.md"
);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (!existsSync(skillFile)) fail("skills/summer/SKILL.md is missing");
if (!existsSync(agentMetadataFile)) {
  fail("skills/summer/agents/openai.yaml is missing");
}
if (!existsSync(protocolReferenceFile)) {
  fail("skills/summer/references/protocol.md is missing");
}
if (!existsSync(matchingReferenceFile)) {
  fail("skills/summer/references/matching.md is missing");
}
if (!existsSync(extensionsReferenceFile)) {
  fail("skills/summer/references/extensions.md is missing");
}

const content = readFileSync(skillFile, "utf8");
const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
if (frontmatter === null) fail("SKILL.md has invalid YAML frontmatter fences");

const entries = new Map(
  frontmatter[1]
    .split("\n")
    .filter((line) => line.trim().length > 0 && /^\S/.test(line))
    .map((line) => {
      const separator = line.indexOf(":");
      if (separator < 1) fail(`Invalid frontmatter line: ${line}`);
      return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
    })
);
const allowedKeys = new Set([
  "name",
  "description",
  "license",
  "allowed-tools",
  "metadata"
]);
for (const key of entries.keys()) {
  if (!allowedKeys.has(key)) fail(`Unexpected SKILL.md frontmatter key: ${key}`);
}

const name = entries.get("name") ?? "";
const description = entries.get("description") ?? "";
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
  fail("Skill name must be hyphen-case and at most 64 characters");
}
if (description.length === 0 || description.length > 1024) {
  fail("Skill description must contain 1-1024 characters");
}
if (/[<>]/.test(description)) {
  fail("Skill description cannot contain angle brackets");
}
if (/^\s*\[TODO:[^\n]*\]\s*$/m.test(content)) {
  fail("Skill contains an unfinished TODO placeholder");
}

const agentMetadata = readFileSync(agentMetadataFile, "utf8");
if (!/display_name:\s*["']Summer["']/.test(agentMetadata)) {
  fail("Agent metadata must expose the Summer display name");
}
if (!/default_prompt:[^\n]*\$summer/.test(agentMetadata)) {
  fail("Agent metadata default_prompt must explicitly invoke $summer");
}

process.stdout.write("Summer Skill source is valid.\n");
