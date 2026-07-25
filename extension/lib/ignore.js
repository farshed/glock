// Reproduces the file selection tokei's directory walker performs, which
// counting a tarball entry-by-entry would otherwise miss.

/** In ascending precedence order. */
export const IGNORE_FILES = [".gitignore", ".ignore", ".tokeignore"];

export const UNMATCHED = 0;
export const IGNORED = 1;
/** Outranks the hidden-file rule: ripgrep ships `!/.github/` for exactly this. */
export const WHITELISTED = -1;

export function isHidden(path) {
  return path.split("/").some((seg) => seg.startsWith(".") && seg !== "." && seg !== "..");
}

function compile(pattern, base) {
  let negated = false;
  let body = pattern;

  if (body.startsWith("!")) {
    negated = true;
    body = body.slice(1);
  }

  let dirOnly = false;
  if (body.endsWith("/")) {
    dirOnly = true;
    body = body.slice(0, -1);
  }

  // A slash anywhere but the end anchors the pattern to the ignore file's
  // directory; otherwise it matches a basename at any depth.
  const anchored = body.includes("/");
  if (body.startsWith("/")) body = body.slice(1);

  let re = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "*") {
      if (body[i + 1] === "*") {
        re += ".*";
        i++;
        if (body[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "[") {
      const close = body.indexOf("]", i);
      if (close === -1) {
        re += "\\[";
      } else {
        re += body.slice(i, close + 1);
        i = close;
      }
    } else {
      re += c.replace(/[.+^${}()|\\]/g, "\\$&");
    }
  }

  const prefix = base ? `${base}/` : "";
  const source = anchored ? `^${prefix}${re}` : `^${prefix}(?:.*/)?${re}`;
  // An ignored directory takes its subtree with it. `build/` must match
  // something beneath the name — a file merely named `build` is not a match.
  const tail = dirOnly ? "(?:/.*)" : "(?:/.*)?";
  return { re: new RegExp(`${source}${tail}$`), negated };
}

/**
 * @param {Map<string, string>} files path -> contents, e.g. "src/.gitignore"
 * @returns {(path: string) => number} one of UNMATCHED / IGNORED / WHITELISTED
 */
export function buildIgnore(files) {
  const rules = [];

  // Later rules win, so order by ascending specificity.
  const ordered = [...files].sort(([a], [b]) => {
    const depth = a.split("/").length - b.split("/").length;
    if (depth !== 0) return depth;
    const rank = (p) => IGNORE_FILES.indexOf(p.slice(p.lastIndexOf("/") + 1));
    return rank(a) - rank(b);
  });

  for (const [file, contents] of ordered) {
    const slash = file.lastIndexOf("/");
    const base = slash === -1 ? "" : file.slice(0, slash);

    for (const raw of contents.split("\n")) {
      const line = raw.replace(/\r$/, "").trim();
      if (!line || line.startsWith("#")) continue;
      try {
        rules.push(compile(line, base));
      } catch {
        // An untranslatable pattern is better skipped than fatal.
      }
    }
  }

  return (path) => {
    let verdict = UNMATCHED;
    for (const rule of rules) {
      if (rule.re.test(path)) verdict = rule.negated ? WHITELISTED : IGNORED;
    }
    return verdict;
  };
}
