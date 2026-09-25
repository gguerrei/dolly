# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Nothing yet.

## [0.1.1] (2026-09-25)

The working documents moved out of the repository; nothing in the code
changed, and `@dollysheep/core`'s README on npm no longer carries links
that went nowhere.

## [0.1.0] (2026-09-25)

The first release. dolly extracts a pattern from a project you like
(layout, naming, toolchain and its captured configs, dependencies by
purpose, languages, testing, commands, license, commits and releases),
scaffolds new projects from it, checks and fits existing ones against it
behind a dry run and a checkpoint branch, learns from a project as it
changes, and exports the pattern as a `.dolly` bundle or as one file for
Claude Code, Cursor, Copilot, Gemini, Windsurf, Cline or any agent. The
command ships as one binary per platform with the GUI embedded, as the
`dollysheep` npm package, and as desktop installers; the engine ships as
`@dollysheep/core`. The AI layer is optional and bring your own key.
`SECURITY.md` says what dolly trusts and never does.
