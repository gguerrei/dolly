import type { Releases } from "../pattern/schema";

/** The Keep a Changelog header `new` stamps and check's fix creates. */
export function renderChangelog(releases: Releases): string {
  const adherence =
    releases.versioning === "semver"
      ? ",\nand this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)."
      : ".";
  return `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)${adherence}

## [Unreleased]
`;
}
