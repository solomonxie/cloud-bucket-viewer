// Maps a file name to a preview/edit kind for the detail sheet, and to the
// content-type used when saving edited text back to S3.

const IMAGE = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif", "svg"];
const VIDEO = ["mp4", "webm", "mov", "m4v"];
const AUDIO = ["mp3", "wav", "aac", "ogg", "m4a", "flac"];
const TEXT = [
  "txt", "log", "csv", "tsv", "ini", "conf", "cfg", "env", "yml", "yaml",
  "json", "xml", "html", "css", "js", "mjs", "ts", "py", "go", "rs", "java",
  "c", "cpp", "h", "sh",
];

// Bigger than this, skip fetching the whole object into a text editor —
// point at Download instead.
const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;

const MIME_BY_EXT = {
  json: "application/json",
  js: "text/javascript",
  mjs: "text/javascript",
  ts: "text/typescript",
  css: "text/css",
  html: "text/html",
  xml: "application/xml",
  yml: "text/yaml",
  yaml: "text/yaml",
  md: "text/markdown",
};

function extOf(name) {
  return name.split(".").pop().toLowerCase();
}

export function previewKind(name) {
  const ext = extOf(name);
  if (ext === "md" || ext === "markdown") return "markdown";
  if (IMAGE.includes(ext)) return "image";
  if (VIDEO.includes(ext)) return "video";
  if (AUDIO.includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (TEXT.includes(ext)) return "text";
  return null;
}

export function isTooLargeForTextPreview(size) {
  return size > MAX_TEXT_PREVIEW_BYTES;
}

export function mimeForName(name) {
  return MIME_BY_EXT[extOf(name)] || "text/plain; charset=utf-8";
}
