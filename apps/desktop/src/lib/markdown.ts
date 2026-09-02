/**
 * The conventions panel's renderer: the small markdown a pattern.md body
 * uses (headings, paragraphs, bullet and numbered lists, fenced code, code
 * spans, bold, italic, links), turned into HTML that is safe to mount with
 * v-html. The prose is pattern content, which may have arrived in someone
 * else's bundle, so every character is escaped first and only the markup
 * this file adds is markup; links keep http(s) only.
 */

const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A private-use character no escaped text can contain marks where each code span goes. */
const MARK = "\uE000";

/** Code spans first (their contents stay literal), then bold, italic, and links. */
function inline(text: string): string {
  const spans: string[] = [];
  const held = text.replace(/`([^`\n]+)`/g, (_, code: string) => {
    spans.push(`<code>${escapeHtml(code)}</code>`);
    return `${MARK}${spans.length - 1}${MARK}`;
  });
  const marked = escapeHtml(held)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>")
    .replace(
      /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>',
    );
  return marked.replace(/\uE000(\d+)\uE000/g, (_, index: string) => spans[Number(index)] as string);
}

export function renderMarkdown(markdown: string): string {
  const lines = markdown.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | undefined;
  let fence: string[] | undefined;

  const flushParagraph = () => {
    if (paragraph.length > 0) html.push(`<p>${inline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list) {
      const items = list.items.map((item) => `<li>${item}</li>`).join("");
      html.push(`<${list.tag}>${items}</${list.tag}>`);
    }
    list = undefined;
  };

  for (const line of lines) {
    if (fence) {
      if (/^```/.test(line)) {
        html.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
        fence = undefined;
      } else fence.push(line);
      continue;
    }
    if (/^```/.test(line)) {
      flushParagraph();
      flushList();
      fence = [];
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = (heading[1] as string).length;
      html.push(`<h${level}>${inline(heading[2] as string)}</h${level}>`);
      continue;
    }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      flushParagraph();
      const tag = bullet ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      list ??= { tag, items: [] };
      list.items.push(inline(((bullet ?? numbered) as RegExpMatchArray)[1] as string));
      continue;
    }
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }
    // A wrapped list item continues on an indented line; anything else is paragraph text.
    if (list && /^\s+\S/.test(line)) {
      list.items[list.items.length - 1] += ` ${inline(line.trim())}`;
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  if (fence) html.push(`<pre><code>${escapeHtml(fence.join("\n"))}</code></pre>`);
  flushParagraph();
  flushList();
  return html.join("\n");
}
