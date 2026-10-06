import { parse } from "acorn";

interface JavaScriptComment {
  end: number;
  start: number;
  value: string;
}

export function sanitizeJavaScriptComments(source: string) {
  const comments: JavaScriptComment[] = [];
  parse(source, {
    allowAwaitOutsideFunction: true,
    allowHashBang: true,
    ecmaVersion: "latest",
    onComment(_block, value, start, end) {
      comments.push({ end, start, value });
    },
    sourceType: "module",
  });

  for (const comment of comments.reverse()) {
    const replacement = /^[#@]\s*sourceMappingURL=/.test(comment.value.trim())
      ? ""
      : source
          .slice(comment.start, comment.end)
          .replace(/\bimport(?=\s*\()/g, "typeImport");
    source = `${source.slice(0, comment.start)}${replacement}${source.slice(comment.end)}`;
  }

  return source;
}
