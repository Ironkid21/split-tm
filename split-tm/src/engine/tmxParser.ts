import { SaxesParser } from 'saxes';
import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { TranslationUnit, SkippedUnit } from './model.js';
import { parseTmxDate } from './tmxDate.js';

export interface ParseOptions {
  sourceFile: string;
  onUnit: (tu: TranslationUnit) => void;
  onSkip?: (s: SkippedUnit) => void;
  brandPropType?: string;
}
export interface HeaderInfo { srclang: string; customer: string; attrs: Record<string, string>; }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => esc(s).replace(/"/g, '&quot;');

/** Streams a TMX document (UTF-8 or UTF-16 with BOM) and emits one TranslationUnit at a time. Memory does not depend on file size. */
export async function parseTmxStream(input: Readable, opts: ParseOptions): Promise<HeaderInfo> {
  const brandType = opts.brandPropType ?? 'JLR';
  const header: HeaderInfo = { srclang: '', customer: '', attrs: {} };
  let inHeader = false, inTu = false, inTuv = false, inSeg = false, propType: string | null = null, propText = '';
  let segXml = '', tuvLang = '';
  let tu: { tuid: string; attrs: Record<string, string>; creationDate: Date | null; modifiedDate: Date | null; tuvs: { lang: string; xml: string }[]; props: [string, string][] } | null = null;

  const parser = new SaxesParser();
  parser.on('error', (e) => { throw new Error(`Invalid TMX (${opts.sourceFile}): ${e.message}`); });
  parser.on('opentag', (node) => {
    const a = node.attributes as Record<string, string>;
    if (inSeg) {
      segXml += `<${node.name}${Object.entries(a).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('')}>`;
      return;
    }
    switch (node.name) {
      case 'header': inHeader = true; header.srclang = a.srclang ?? ''; header.attrs = { ...a }; break;
      case 'tu':
        inTu = true;
        tu = {
          tuid: a.tuid ?? '', creationDate: parseTmxDate(a.creationdate), modifiedDate: parseTmxDate(a.changedate), tuvs: [], props: [],
          attrs: Object.fromEntries(Object.entries(a).filter(([k]) => !['tuid', 'creationdate', 'changedate'].includes(k))),
        };
        break;
      case 'prop': propType = a.type ?? ''; propText = ''; break;
      case 'tuv': if (inTu) { inTuv = true; tuvLang = a['xml:lang'] ?? a.lang ?? ''; } break;
      case 'seg': if (inTuv) { inSeg = true; segXml = ''; } break;
    }
  });
  const text = (t: string) => { if (inSeg) segXml += esc(t); else if (propType !== null) propText += t; };
  parser.on('text', text);
  parser.on('cdata', text);
  parser.on('closetag', (node) => {
    const name = node.name;
    if (inSeg && name !== 'seg') { segXml += `</${name}>`; return; }
    switch (name) {
      case 'seg': if (inSeg) { inSeg = false; tu?.tuvs.push({ lang: tuvLang, xml: segXml }); } break;
      case 'tuv': inTuv = false; break;
      case 'prop': {
        const val = propText.trim();
        if (inHeader && propType === 'user-defined') {
          const m = /^CUSTOMER:\s*(.+)$/i.exec(val);
          if (m) header.customer = m[1].trim();
        } else if (inTu && propType !== null && tu) tu.props.push([propType, val]);
        propType = null; break;
      }
      case 'header': inHeader = false; break;
      case 'tu': {
        inTu = false;
        if (!tu) break;
        const t = tu; tu = null;
        const get = (k: string) => t.props.filter(([pk, v]) => pk === k && v).map(([, v]) => v);
        const metadata: Record<string, string[]> = {};
        for (const [k, v] of t.props) (metadata[k] ??= []).push(v);
        const src = t.tuvs.find((x) => x.lang === header.srclang) ?? (header.srclang === '*all*' ? t.tuvs[0] : undefined);
        if (!src) {
          opts.onSkip?.({ tuid: t.tuid, sourceFile: opts.sourceFile, reason: header.srclang ? `Missing source-language entry (${header.srclang})` : 'TMX header has no source language (srclang)' });
          break;
        }
        opts.onUnit({
          tuid: t.tuid, sourceFile: opts.sourceFile, customer: header.customer,
          projects: get('x-Project'), brands: [...new Set(get(brandType))],
          approvalStatus: get('x-xtm-status')[0] ?? '', translationStatus: get('Status')[0] ?? '',
          creationDate: t.creationDate, modifiedDate: t.modifiedDate,
          source: { language: src.lang, text: src.xml },
          targets: t.tuvs.filter((x) => x !== src).map((x) => ({ language: x.lang, text: x.xml })),
          originalXml: '', attrs: t.attrs, metadata,
        });
      }
    }
  });

  let decoder: TextDecoder | null = null;
  for await (const chunk of input) {
    const buf = chunk as Buffer;
    if (!decoder) {
      const enc = buf[0] === 0xff && buf[1] === 0xfe ? 'utf-16le' : buf[0] === 0xfe && buf[1] === 0xff ? 'utf-16be' : 'utf-8';
      decoder = new TextDecoder(enc);
    }
    parser.write(decoder.decode(buf, { stream: true }));
  }
  if (decoder) parser.write(decoder.decode());
  parser.close();
  return header;
}

export const parseTmx = (path: string, opts: ParseOptions): Promise<HeaderInfo> =>
  parseTmxStream(createReadStream(path, { highWaterMark: 1 << 20 }), opts);
