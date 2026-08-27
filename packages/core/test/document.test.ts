import { describe, expect, test } from "bun:test";
import {
  PatternParseError,
  parsePatternDocument,
  serializePatternDocument,
} from "../src/pattern/document";

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
