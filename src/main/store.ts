import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

const root = () => app.getPath("userData");

function file(name: string) {
  return path.join(root(), name);
}

export function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file(name), "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Atomic write: write a temp file then rename, so a crash never leaves half a file. */
export function writeJson(name: string, data: unknown) {
  const target = file(name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, target);
}

export function removeFile(name: string) {
  try {
    fs.unlinkSync(file(name));
  } catch {
    /* already gone */
  }
}

/** A JSON document kept in memory and flushed to disk shortly after each change. */
export class JsonDoc<T> {
  data: T;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private name: string,
    fallback: T,
  ) {
    this.data = readJson(name, fallback);
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      writeJson(this.name, this.data);
    }, 400);
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    writeJson(this.name, this.data);
  }
}

export function safeName(id: string) {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}
