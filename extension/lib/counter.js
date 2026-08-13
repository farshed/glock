import { readTar } from "./tar.js";
import { buildIgnore, IGNORE_FILES, IGNORED, isHidden, WHITELISTED } from "./ignore.js";

let wasmPromise = null;

function loadWasm() {
  if (!wasmPromise) {
    wasmPromise = (async () => {
      const url = chrome.runtime.getURL("tokei.wasm");
      const bytes = await (await fetch(url)).arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, {});
      return instance.exports;
    })();
  }
  return wasmPromise;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * @param {ReadableStream<Uint8Array>} gzipStream
 * @returns {Promise<{code:number, comments:number, blanks:number, total:number, files:number}>}
 */
export async function countTarball(gzipStream) {
  const wasm = await loadWasm();

  const tar = new Uint8Array(
    await new Response(gzipStream.pipeThrough(new DecompressionStream("gzip")))
      .arrayBuffer(),
  );

  // Two passes: ignore rules can live in any directory and may appear after the
  // files they affect, so the file list must be complete before selecting.
  const ignoreFiles = new Map();
  const candidates = [];

  for (const { path, body } of readTar(tar)) {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (IGNORE_FILES.includes(name)) {
      ignoreFiles.set(path, decoder.decode(body));
      continue;
    }
    candidates.push({ path, body });
  }

  const ignoreMatch = buildIgnore(ignoreFiles);
  const selected = (path) => {
    const verdict = ignoreMatch(path);
    if (verdict === WHITELISTED) return true;
    if (verdict === IGNORED) return false;
    return !isHidden(path);
  };

  const out = wasm.alloc(12);
  const totals = { code: 0, comments: 0, blanks: 0, total: 0, files: 0 };

  try {
    for (const { path, body } of candidates) {
      if (!selected(path)) continue;

      const pathBytes = encoder.encode(path);
      const pathPtr = wasm.alloc(pathBytes.length);
      const bodyPtr = wasm.alloc(body.length);
      try {
        // Fresh views each time – allocating can grow memory and detach the
        // previous ArrayBuffer.
        new Uint8Array(wasm.memory.buffer, pathPtr, pathBytes.length).set(pathBytes);
        new Uint8Array(wasm.memory.buffer, bodyPtr, body.length).set(body);

        const rc = wasm.count(pathPtr, pathBytes.length, bodyPtr, body.length, out);
        if (rc !== 0) continue;

        const [code, comments, blanks] = new Uint32Array(wasm.memory.buffer, out, 3);
        totals.code += code;
        totals.comments += comments;
        totals.blanks += blanks;
        totals.files++;
      } finally {
        wasm.dealloc(bodyPtr, body.length);
        wasm.dealloc(pathPtr, pathBytes.length);
      }
    }
  } finally {
    wasm.dealloc(out, 12);
  }

  totals.total = totals.code + totals.comments + totals.blanks;
  return totals;
}
