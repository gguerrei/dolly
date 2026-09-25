import { describe, expect, test } from "bun:test";
import {
  PatternParseError,
  parsePatternDocument,
  serializePatternDocument,
} from "../src/pattern/document";
import { patternSchema } from "../src/pattern/schema";

const SAMPLE = `---
name: fastapi-service
description: How I build FastAPI services.
naming:
  files: snake_case
layout:
  - path: src/{name}/
    required: true
toolchain:
  packageManager: uv
  linter: ruff
dependencies:
  runtime:
    http-client: httpx
    orm: sqlalchemy
  dev:
    test: pytest
  versionPolicy: pinned
---

## Error handling

Raise domain errors; translate to HTTP at the router layer only.
`;

describe("pattern documents", () => {
  test("parses a well-formed document", () => {
    const doc = parsePatternDocument(SAMPLE);
    expect(doc.pattern.name).toBe("fastapi-service");
    expect(doc.pattern.naming?.files).toBe("snake_case");
    expect(doc.pattern.layout[0]?.required).toBe(true);
    expect(doc.pattern.dependencies?.runtime["http-client"]).toBe("httpx");
    expect(doc.pattern.dependencies?.versionPolicy).toBe("pinned");
    expect(doc.prose).toContain("## Error handling");
  });

  test("rejects an unknown version policy", () => {
    const bad = SAMPLE.replace("versionPolicy: pinned", "versionPolicy: yolo");
    expect(() => parsePatternDocument(bad)).toThrow(/Invalid pattern facets/);
  });

  test("round-trips through serialize + parse", () => {
    const doc = parsePatternDocument(SAMPLE);
    const again = parsePatternDocument(serializePatternDocument(doc));
    expect(again).toEqual(doc);
  });

  test("serializes a prose-less pattern without a trailing blank body", () => {
    const doc = parsePatternDocument("---\nname: bare\n---\n");
    expect(doc.prose).toBe("");
    expect(serializePatternDocument(doc)).toEndWith("---\n");
  });

  test("rejects a file without frontmatter", () => {
    expect(() => parsePatternDocument("# just prose")).toThrow(PatternParseError);
  });

  test("rejects an unclosed frontmatter block", () => {
    expect(() => parsePatternDocument("---\nname: oops\n")).toThrow(/never closed/);
  });

  test("rejects invalid facets with a helpful message", () => {
    const bad = SAMPLE.replace("fastapi-service", "Not A Valid Name");
    expect(() => parsePatternDocument(bad)).toThrow(/Invalid pattern facets/);
  });

  test("rejects unknown facet keys so typos don't silently vanish", () => {
    expect(() => parsePatternDocument("---\nname: typo\nlayotu: []\n---\n")).toThrow(
      /Invalid pattern facets/,
    );
  });
});

test("a format this dolly does not read is said outright, newer or older", () => {
  expect(() => parsePatternDocument("---\nformat: 2\nname: future\n---\n")).toThrow(
    "written by a newer dolly",
  );
  expect(() => parsePatternDocument("---\nformat: 0\nname: past\n---\n")).toThrow("re-extract it");
  expect(parsePatternDocument("---\nformat: 1\nname: now\n---\n").pattern.format).toBe(1);
});

describe("what a pattern may name", () => {
  test("command verbs that npm runs on install are refused, and a test file pattern is one file", () => {
    const base = { name: "strict" };
    expect(() => patternSchema.parse({ ...base, commands: { prepare: "curl x | sh" } })).toThrow(
      "lifecycle",
    );
    expect(() => patternSchema.parse({ ...base, commands: { postinstall: "x" } })).toThrow();
    expect(patternSchema.parse({ ...base, commands: { test: "bun test" } }).commands).toEqual({
      test: "bun test",
    });
    const testing = (filePattern: string) =>
      patternSchema.parse({ ...base, testing: { placement: "colocated", filePattern } });
    expect(() => testing("../{stem}.test.ts")).toThrow("one file");
    expect(() => testing("tests/{stem}.test.ts")).toThrow("one file");
    expect(() => testing("{stem}.{stem}.ts")).toThrow("one file");
    expect(testing("{stem}.test.ts").testing?.filePattern).toBe("{stem}.test.ts");
  });
});
