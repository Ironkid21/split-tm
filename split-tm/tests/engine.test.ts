import { APP_VERSION } from '../src/engine/version';
import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Dataset, filterUnits } from '../src/engine/dataset';
import { buildTable, toCsv, toMarkdown, toTmx } from '../src/engine/exporters';
import { forEachTmxInZip } from '../src/engine/zipStream';

const fx = 'tests/fixtures/sample.tmx';
const load = async () => { const d = new Dataset({ keepUnits: true }); await d.addFile(fx, 'sample.tmx'); return d; };

describe('engine', () => {
  it('scans dynamically, multi-brand', async () => {
    const s = (await load()).scan();
    expect(s.unitCount).toBe(2);
    expect(s.customers).toEqual(['Cust_A']);
    expect(s.brands).toEqual(['Discovery', 'Jaguar', 'Range_Rover']);
    expect(s.brandAssignments).toBe(3);
    expect(s.targetLanguages).toEqual(['de-DE', 'it-IT']);
  });
  it('filters by brand without duplicating units', async () => {
    const d = await load();
    expect(filterUnits(d.units, { brands: ['Range_Rover', 'Discovery'] })).toHaveLength(1);
    expect(filterUnits(d.units, { approvalStatuses: ['approved'] })).toHaveLength(1);
  });
  it('keeps columns aligned with blanks for missing targets', async () => {
    const t = buildTable((await load()).units);
    expect(t.header).toEqual(['en_GB', 'de_DE', 'it_IT']);
    expect(t.rows[1]).toEqual(['Hello world | pipe', '', 'Ciao']);
    expect(toCsv(t)).toContain('en_GB,de_DE,it_IT');
    expect(toMarkdown(t)).toContain('pipe'.replace('pipe', '\\|'));
  });
  it('preserves inline tags in TMX output', async () => {
    const out = toTmx((await load()).units, { srclang: 'en-GB', customer: 'Cust_A' });
    expect(out).toContain('<ph x="1">{1}</ph>');
    expect(out).toContain('<prop type="JLR">Range_Rover</prop>');
  });
  it('streams TMX entries from a ZIP, refuses traversal names, never writes to disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 't-'));
    const zp = join(dir, 'a.zip');
    writeFileSync(zp, zipSync({ 'a.tmx': readFileSync(fx), '../evil.tmx': strToU8('x'), 'notes.txt': strToU8('hi'), 'sub/b.tmx': readFileSync(fx) }));
    const seen: string[] = [];
    const r = await forEachTmxInZip(zp, async (name, stream) => { seen.push(name); for await (const _ of stream) { /* consume */ } });
    expect(seen).toEqual(['a.tmx', 'sub/b.tmx']); expect(r.unsafe).toEqual(['../evil.tmx']);
    const ds = new Dataset(); await ds.addZip(zp, 'a.zip');
    expect(ds.index.length).toBe(4); expect(ds.warnings[0]).toContain('evil.tmx');
  });
  it('reports corrupt ZIPs and ZIPs without TMX', async () => {
    const dir = mkdtempSync(join(tmpdir(), 't-'));
    writeFileSync(join(dir, 'bad.zip'), 'not a zip'); writeFileSync(join(dir, 'none.zip'), zipSync({ 'x.txt': strToU8('hi') }));
    await expect(new Dataset().addZip(join(dir, 'bad.zip'), 'bad.zip')).rejects.toThrow(/Corrupt or unreadable ZIP/);
    await expect(new Dataset().addZip(join(dir, 'none.zip'), 'none.zip')).rejects.toThrow(/no TMX files/);
  });
  it('keeps self-closing inline tags well-formed and handles UTF-16 input', async () => {
    const dir = mkdtempSync(join(tmpdir(), 't-'));
    const body = '<?xml version="1.0" encoding="UTF-16"?><tmx version="1.4"><header srclang="en-GB"/><body><tu tuid="1"><tuv xml:lang="en-GB"><seg>A <ph x="1"/> b &amp; c</seg></tuv><tuv xml:lang="de-DE"><seg>Ä ü</seg></tuv></tu></body></tmx>';
    writeFileSync(join(dir, 'u16.tmx'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, 'utf16le')]));
    const ds = new Dataset({ keepUnits: true }); await ds.addTmx(join(dir, 'u16.tmx'), 'u16.tmx');
    expect(ds.units[0].targets[0].text).toBe('Ä ü');
    const out = toTmx(ds.units, { srclang: 'en-GB' });
    expect(out).toContain('<ph x="1"></ph>'); expect(out).not.toContain('</ph></ph>');
    writeFileSync(join(dir, 'o.tmx'), out);
    const back = new Dataset({ keepUnits: true }); await back.addTmx(join(dir, 'o.tmx'), 'o'); expect(back.units[0].source.text).toBe(ds.units[0].source.text.replace('<ph x="1"></ph>', '<ph x="1"></ph>'));
  });
});

import { NO_BRAND } from '../src/engine/dataset';
describe('no-brand units', () => {
  it('are selectable via sentinel', async () => {
    const d = await load();
    d.units[1].brands = [];
    expect(filterUnits(d.units, { brands: [NO_BRAND] }).map((u) => u.tuid)).toEqual(['2']);
  });
});

describe('tmx fidelity', () => {
  it('keeps tu attributes and source header attributes, stamps current version', async () => {
    const d = await load();
    const out = toTmx(d.units, { srclang: 'en-GB', headerAttrs: d.headerAttrs });
    expect(out).toContain('creationid="UserA"');
    expect(out).toContain('datatype="xml"');
    expect(out).toContain('creationtool="Split TM"');
    expect(out).toContain(`creationtoolversion="${APP_VERSION}"`);
    expect(out).not.toContain('creationtool="XTM"');
  });
});

import { plain } from '../src/engine/exporters';
describe('tag-free text', () => {
  it('removes inline code elements with their content and keeps text', () => {
    expect(plain('<ph x="0" type="x">&lt;x id="x1"/&gt;</ph><bpt i="1">&lt;g id="i1"&gt;</bpt>Hello &amp; bye<ept i="1">&lt;/g&gt;</ept>')).toBe('Hello & bye');
    expect(plain('a <ph x="1">{1}</ph> b')).toBe('a b');
    expect(plain('1 &lt; 2')).toBe('1 < 2');
    expect(plain('<hi type="x">kept</hi> text')).toBe('kept text');
  });
});

describe('date filter', () => {
  it('uses the creation date only (the modified date is ignored)', async () => {
    const d = await load(); // tu 1: created 2026-08-12, modified 2026-09-09; tu 2: created 2026-01-01, no modified date
    const ids = (f: Parameters<typeof filterUnits>[1]) => filterUnits(d.units, f).map((u) => u.tuid);
    expect(ids({ dateFrom: new Date('2026-08-01T00:00:00Z') })).toEqual(['1']);
    expect(ids({ dateTo: new Date('2026-02-01T23:59:59Z') })).toEqual(['2']);
    expect(ids({ dateFrom: new Date('2026-09-01T00:00:00Z') })).toEqual([]); // only matches tu 1's MODIFIED date, so it must not count
    expect(ids({ dateFrom: new Date('2026-01-01T00:00:00Z'), dateTo: new Date('2026-01-01T23:59:59Z') })).toEqual(['2']); // inclusive bounds
  });
});
