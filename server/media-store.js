import fs from 'node:fs/promises';
import path from 'node:path';

export function createMediaStore(directory) {
  const root = path.resolve(directory);
  return {
    async init() { await fs.mkdir(root, { recursive: true }); },
    pathFor(sha, ext) { return path.join(root, `${sha}${ext}`); },
    async write(filePath, buffer) { await fs.writeFile(filePath, buffer); },
    async read(filePath) { return fs.readFile(filePath); }
  };
}
