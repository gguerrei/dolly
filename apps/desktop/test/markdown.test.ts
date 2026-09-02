import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../src/lib/markdown";

describe("renderMarkdown", () => {
  test("renders the shapes a pattern.md body uses", () => {
    const html = renderMarkdown(
      [
        "Describe your conventions here.",
        "",
        "## Extraction notes",
        "",
        "### Layout",
        "",
        "- src/ mixes shapes; set `layout` by hand.",
        "- Second note, with **weight** and *stress* and a [link](https://example.com/x).",
        "",
        "1. first",
        "2. second",
        "",
        "```ts",
        "const a = 1 < 2;",
        "```",
      ].join("\n"),
    );
    expect(html).toContain("<p>Describe your conventions here.</p>");
    expect(html).toContain("<h2>Extraction notes</h2>");
    expect(html).toContain("<h3>Layout</h3>");
    expect(html).toContain("<li>src/ mixes shapes; set <code>layout</code> by hand.</li>");
    expect(html).toContain("<strong>weight</strong>");
    expect(html).toContain("<em>stress</em>");
    expect(html).toContain(
      '<a href="https://example.com/x" rel="noopener noreferrer" target="_blank">link</a>',
    );
    expect(html).toContain("<ol><li>first</li><li>second</li></ol>");
    expect(html).toContain("<pre><code>const a = 1 &lt; 2;</code></pre>");
  });

  test("never lets the prose's own markup through, and keeps links to http(s)", () => {
    const html = renderMarkdown(
      [
        '<img src=x onerror="alert(1)"> and `<b>code</b>`',
        "",
        "- [nope](javascript:alert(1)) and [ok](https://dolly.dev)",
      ].join("\n"),
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("<code>&lt;b&gt;code&lt;/b&gt;</code>");
    expect(html).not.toContain('javascript:alert(1))"');
    expect(html).toContain("[nope](javascript:alert(1))");
    expect(html).toContain('href="https://dolly.dev"');
  });

  test("a wrapped list item stays one item, and CRLF prose reads the same", () => {
    const html = renderMarkdown("- one line\r\n  and its wrap\r\n- two\r\n");
    expect(html).toBe("<ul><li>one line and its wrap</li><li>two</li></ul>");
  });
});
