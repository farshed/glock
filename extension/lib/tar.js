// Minimal ustar reader for GitHub's `codeload` tarballs.

const BLOCK = 512;

const decoder = new TextDecoder();

function str(bytes, offset, length) {
  const slice = bytes.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return decoder.decode(end === -1 ? slice : slice.subarray(0, end)).trim();
}

// Sizes are octal, but GNU tar switches to base-256 for values that don't fit.
function readSize(bytes, offset) {
  if (bytes[offset] & 0x80) {
    let n = 0;
    for (let i = offset + 1; i < offset + 12; i++) n = n * 256 + bytes[i];
    return n;
  }
  const text = str(bytes, offset, 12);
  return text ? parseInt(text, 8) : 0;
}

// pax extended headers are "<len> <key>=<value>\n" records; only `path`
// matters, overriding the truncated name in the following header.
function parsePax(block) {
  const text = decoder.decode(block);
  const out = {};
  const re = /(\d+) ([^=]+)=([\s\S]*?)\n/g;
  let m;
  while ((m = re.exec(text))) out[m[2]] = m[3];
  return out;
}

/**
 * @param {Uint8Array} bytes
 * @yields {{ path: string, body: Uint8Array }}
 */
export function* readTar(bytes) {
  let offset = 0;
  let paxPath = null;

  while (offset + BLOCK <= bytes.length) {
    const header = bytes.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break;

    const size = readSize(header, 124);
    const type = String.fromCharCode(header[156]) || "0";
    let name = str(header, 0, 100);

    // ustar prefix field, for paths too long for the name field.
    const prefix = str(header, 345, 155);
    if (prefix) name = `${prefix}/${name}`;
    if (paxPath !== null) {
      name = paxPath;
      paxPath = null;
    }

    const dataStart = offset + BLOCK;
    const dataEnd = dataStart + size;
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "x" || type === "X") {
      const pax = parsePax(bytes.subarray(dataStart, dataEnd));
      if (pax.path) paxPath = pax.path;
      continue;
    }
    if (type === "g" || type === "L" || type === "K") continue;
    if (type !== "0" && type !== "\0" && type !== "") continue;

    // Strip GitHub's `{repo}-{sha}/` wrapper directory.
    const slash = name.indexOf("/");
    const path = slash === -1 ? name : name.slice(slash + 1);
    if (!path) continue;

    yield { path, body: bytes.subarray(dataStart, dataEnd) };
  }
}
