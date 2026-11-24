import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Dataset } from '../src/engine/dataset';
import { processRun, dimensionFileName } from '../src/engine/processor';
import { defaultPaths } from '../src/engine/paths';
import type { OutputConfiguration } from '../src/engine/model';

const tuv = (lang: string, text: string) => `<tuv xml:lang="${lang}"><seg>${text}</seg></tuv>`;
const unit = (id: number, brand: string, approval: string, project: string, source: string, target: string) =>
  `<tu tuid="${id}"><prop type="JLR">${brand}</prop><prop type="x-xtm-status">${approval}</prop><prop type="x-Project">${project}</prop>${tuv(source, `source ${id}`)}${tuv(target, `target ${id}`)}</tu>`;
const tmx = `<?xml version="1.0"?><tmx version="1.4"><header srclang="en-GB"/><body>${
  unit(1, 'A', 'approved', 'P1', 'en-GB', 'fr-FR') +
  unit(2, 'B', 'review', 'P2', 'de-DE', 'en-GB')
}</body></tmx>`;

async function setup(contents = tmx) {
  const dir = mkdtempSync(join(tmpdir(), 'split-tm-v2-'));
  const input = join(dir, 'input.tmx');
  writeFileSync(input, contents);
  const dataset = new Dataset();
  await dataset.addTmx(input, 'input.tmx');
  const paths = defaultPaths({ appData: join(dir, 'app'), outputRoot: join(dir, 'out') });
  return { dir, input, dataset, paths };
}

describe('Split TM 2.0 output configuration', () => {
  it('creates the valid independent dimension combinations in every selected format', async () => {
    const { input, dataset, paths } = await setup();
    const config: OutputConfiguration = {
      brandMode: 'separate', marketMode: 'individual',
      approvalMode: 'separate', projectMode: 'separate',
      formats: ['csv', 'tmx'],
    };
    const result = await processRun({ inputs: [input], filter: {}, outputConfig: config, paths, dataset });

    expect(result.outputConfig).toEqual(config);
    expect(result.formats).toEqual(['csv', 'tmx']);
    expect(result.files).toHaveLength(4);
    expect(result.files.map((f) => f.format)).toEqual(['csv', 'tmx', 'csv', 'tmx']);
    expect(result.files.map((f) => f.records)).toEqual([1, 1, 1, 1]);
    expect(result.warnings.join(' ')).toContain('empty output combination');
    expect(readdirSync(result.outputDir).length).toBe(4);
  });

  it('preserves non-Latin characters in generated filename tokens', () => {
    expect(dimensionFileName('ブランド', '承認済み', 'ja-JP', 'プロジェクト'))
      .toBe('ブランド_承認済み_JA_JP_プロジェクト');
  });

  it('counts an empty-source unit once when tabular and TMX formats are mixed', async () => {
    const contents = `<?xml version="1.0"?><tmx version="1.4"><header srclang="en-GB"/><body>${
      unit(1, 'A', 'approved', 'P1', 'en-GB', 'fr-FR').replace('source 1', '') +
      unit(2, 'A', 'approved', 'P1', 'en-GB', 'fr-FR')
    }</body></tmx>`;
    const { input, dataset, paths } = await setup(contents);
    const result = await processRun({
      inputs: [input], filter: {}, paths, dataset,
      outputConfig: { brandMode: 'single', marketMode: 'combined', approvalMode: 'single', projectMode: 'single', formats: ['csv', 'tmx'] },
    });
    expect(result.recordsSelected).toBe(2);
    expect(result.recordsSkipped).toBe(1);
    expect(result.files.map((f) => f.records)).toEqual([1, 2]);
    expect(readFileSync(result.files.find((f) => f.format === 'tmx')!.path, 'utf8')).toContain('tuid="1"');
  });
});
