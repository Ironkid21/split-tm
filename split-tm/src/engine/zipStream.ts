import yauzl from 'yauzl';
import type { Readable } from 'node:stream';
import { basename } from 'node:path';

/** An entry name that could escape a folder if it were ever extracted. We never extract to disk, but such entries are refused and reported. */
export const isUnsafeEntryName = (n: string) => n.split(/[\\/]/).includes('..') || /^([\\/]|[a-zA-Z]:)/.test(n);

/**
 * Streams every .tmx entry of a ZIP, one at a time, straight from the archive (nothing is extracted to disk).
 * The callback must consume the stream. Memory use does not depend on the size of the entries.
 */
export function forEachTmxInZip(zipPath: string, cb: (name: string, stream: Readable) => Promise<void>): Promise<{ count: number; unsafe: string[] }> {
  const label = basename(zipPath);
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, validateEntrySizes: true, autoClose: true, decodeStrings: false }, (err, zip) => {
      if (err || !zip) return reject(new Error(`Corrupt or unreadable ZIP: ${label}`));
      let count = 0;
      const unsafe: string[] = [];
      zip.on('error', (e) => reject(new Error(`Corrupt or unreadable ZIP: ${label} (${e.message})`)));
      zip.on('end', () => (count ? resolve({ count, unsafe }) : reject(new Error(`ZIP contains no TMX files: ${label}`))));
      zip.on('entry', (entry: yauzl.Entry) => {
        // decodeStrings:false -> raw bytes, so unsafe names reach our own check instead of failing the whole archive
        const name = Buffer.isBuffer(entry.fileName) ? (entry.fileName as Buffer).toString('utf8') : String(entry.fileName);
        if (name.endsWith('/') || !/\.tmx$/i.test(name)) return zip.readEntry();
        if (isUnsafeEntryName(name)) { unsafe.push(name); return zip.readEntry(); }
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(new Error(`Corrupt or unreadable ZIP entry "${name}" in ${label}`));
          cb(name, stream).then(() => { count++; zip.readEntry(); }, (e2) => { stream.destroy(); zip.close(); reject(e2); });
        });
      });
      zip.readEntry();
    });
  });
}
