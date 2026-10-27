import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FilterCriteria, OutputFormat, OutputMode, MarketOutputMode, Progress, RunResult, UpgradeReport } from '../engine/index';
import type { AppInfo, Preview, Scanned } from '../shared/api';
import { NO_BRAND } from '../shared/constants';
import { langLabel } from '../shared/lang';

type Step = 'intake' | 'select' | 'running' | 'done';
type Scan = { status: 'idle' | 'scanning' | 'ready' | 'error'; data?: Scanned; error?: string };
const api = window.splitTM;
const FORMATS: { id: OutputFormat; label: string; hint: string }[] = [
  { id: 'xlsx', label: 'Excel', hint: '.xlsx' }, { id: 'csv', label: 'CSV', hint: '.csv' },
  { id: 'md', label: 'Markdown', hint: '.md' }, { id: 'tmx', label: 'TMX', hint: '.tmx' },
];
const STAGES = ['Filtering', 'Exporting', 'Logging', 'Done'] as const;
const nf = new Intl.NumberFormat();
const day = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const base = (p: string) => p.split(/[\\/]/).pop() ?? p;
const toggle = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export function App() {
  const [step, setStep] = useState<Step>('intake');
  const [files, setFiles] = useState<string[]>([]);
  const [scan, setScan] = useState<Scan>({ status: 'idle' });
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'info' | 'warn'; text: string } | null>(null);
  const [brands, setBrands] = useState<string[]>([]);
  const [projects, setProjects] = useState<string[]>([]);
  const [customers, setCustomers] = useState<string[]>([]);
  const [approvals, setApprovals] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [allToAll, setAllToAll] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [format, setFormat] = useState<OutputFormat>('xlsx');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [outputMode, setOutputMode] = useState<OutputMode>('single');
  const [marketOutputMode, setMarketOutputMode] = useState<MarketOutputMode>('combined');
  const selected = preview?.count ?? null;

  useEffect(() => { void api.info().then((r) => r.ok && setInfo(r.data)); }, []);
  useEffect(() => {
    void api.upgradeNotice().then((r) => {
      const u: UpgradeReport | null = r.ok ? r.data : null;
      if (!u) return;
      if (u.warnings.length) setNotice({ kind: 'warn', text: u.warnings.join(' ') });
      else if (u.status === 'upgraded') setNotice({ kind: 'info', text: `Updated from ${u.from} to ${u.to}. Your settings, output files and processing log were kept.` });
    });
  }, []);
  useEffect(() => api.onProgress(setProgress), []);

  const resetFilters = () => { setBrands([]); setProjects([]); setCustomers([]); setApprovals([]); setSources([]); setTargets([]); setAllToAll(false); setFrom(''); setTo(''); };

  const runScan = useCallback(async (list: string[]) => {
    resetFilters(); setError(null);
    if (!list.length) { setScan({ status: 'idle' }); return; }
    setScan({ status: 'scanning' });
    const r = await api.scan(list);
    setScan(r.ok ? { status: 'ready', data: r.data } : { status: 'error', error: r.error });
  }, []);

  const addFiles = useCallback((paths: string[]) => {
    const ok = paths.filter((p) => /\.(tmx|zip)$/i.test(p));
    const rejected = paths.length - ok.length;
    if (rejected) setError(`${rejected} file${rejected > 1 ? 's were' : ' was'} skipped. Only .tmx and .zip files are supported.`);
    const next = [...new Set([...files, ...ok])];
    if (next.length !== files.length) { setFiles(next); void runScan(next); }
  }, [files, runScan]);

  const removeFile = (p: string) => { const next = files.filter((f) => f !== p); setFiles(next); void runScan(next); };
  const pick = async () => { const r = await api.pickFiles(); if (r.ok) addFiles(r.data); else setError(r.error); };

  const filter: FilterCriteria = useMemo(() => ({
    brands, projects, customers, approvalStatuses: approvals, sourceLanguages: sources, targetLanguages: targets, allToAll,
    dateFrom: from ? new Date(`${from}T00:00:00Z`) : undefined, dateTo: to ? new Date(`${to}T23:59:59Z`) : undefined,
  }), [brands, projects, customers, approvals, sources, targets, allToAll, from, to]);

  const token = useRef(0);
  useEffect(() => {
    if (scan.status !== 'ready') { setPreview(null); return; }
    const t = ++token.current;
    const h = setTimeout(async () => { const r = await api.preview(filter); if (t === token.current && r.ok) setPreview(r.data); }, 120);
    return () => clearTimeout(h);
  }, [filter, scan.status]);

  const run = async () => {
    setError(null); setProgress(null); setStep('running');
    const r = await api.process(filter, format, brands.length > 1 ? outputMode : 'single', marketOutputMode);
    if (r.ok) { setResult(r.data); setStep('done'); } else { setError(r.error); setStep('select'); }
  };
  const newRun = () => { setFiles([]); setScan({ status: 'idle' }); resetFilters(); setResult(null); setError(null); setStep('intake'); };
  const changeRoot = async () => { const r = await api.chooseOutputRoot(); if (r.ok && r.data) setInfo(r.data); };

  const ready = scan.status === 'ready' ? scan.data! : null;
  const stepIdx = { intake: 0, select: 1, running: 2, done: 2 }[step];

  return (
    <div className="app">
      <div className="floor" aria-hidden="true" />
      <header className="top">
        <div className="brand"><span className="logo" aria-hidden="true" /><span className="name">Split TM</span></div>
        <ol className="steps" aria-label="Progress">
          {['Add files', 'Select', 'Export'].map((s, i) => (
            <li key={s} className={i === stepIdx ? 'on' : i < stepIdx ? 'past' : ''} aria-current={i === stepIdx ? 'step' : undefined}><span>{String(i + 1).padStart(2, '0')}</span>{s}</li>
          ))}
        </ol>
        <span className={`ver ${info?.channel === 'developer' ? 'dev' : ''}`}>v{info?.version ?? '…'}{info?.channel === 'developer' ? ' · developer build' : ''}</span>
      </header>

      {error && <div className="banner" role="alert"><span>{error}</span><button className="x" onClick={() => setError(null)} aria-label="Dismiss">×</button></div>}

      {notice && <div className={`banner ${notice.kind}`} role={notice.kind === 'warn' ? 'alert' : 'status'}><span>{notice.text}</span><button className="x" onClick={() => setNotice(null)} aria-label="Dismiss">×</button></div>}

      <main className="stage">
        {step === 'intake' && <Intake files={files} scan={scan} onPick={pick} onDrop={(fl) => addFiles(fl.map((f) => api.pathForFile(f)))} onRemove={removeFile} onNext={() => setStep('select')} />}
        {step === 'select' && ready && (
          <Select data={ready} filter={filter} format={format} selected={selected} preview={preview} outputMode={outputMode} setOutputMode={setOutputMode} marketOutputMode={marketOutputMode} setMarketOutputMode={setMarketOutputMode} info={info}
            state={{ brands, projects, customers, approvals, sources, targets, allToAll, from, to }}
            set={{ setBrands, setProjects, setCustomers, setApprovals, setSources, setTargets, setAllToAll, setFrom, setTo, setFormat }}
            onBack={() => setStep('intake')} onRun={run} onChangeRoot={changeRoot} />
        )}
        {step === 'running' && <Running progress={progress} />}
        {step === 'done' && result && <Done result={result} onOpen={async () => { const r = await api.openPath(result.outputDir); if (!r.ok) setError(r.error); }} onNew={newRun} onClose={() => void api.closeApp()} />}
      </main>
    </div>
  );
}

function Intake(p: { files: string[]; scan: Scan; onPick: () => void; onDrop: (f: File[]) => void; onRemove: (p: string) => void; onNext: () => void }) {
  const [over, setOver] = useState(false);
  const s = p.scan.data?.scan;
  return (
    <div className="intake">
      <section className={`panel drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); p.onDrop(Array.from(e.dataTransfer.files)); }}>
        <div className="cube" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
        <h1>Drop TMX or ZIP files here</h1>
        <p className="muted">ZIP packages are opened automatically. Everything is processed on this computer.</p>
        <button className={`btn ${p.files.length ? '' : 'primary'}`} onClick={p.onPick}>Add files…</button>
      </section>

      <section className="panel files" aria-live="polite">
        <h2>Input files <span className="count">{p.files.length}</span></h2>
        {p.files.length === 0 ? <p className="empty">No files added yet.</p> : (
          <ul>{p.files.map((f) => (
            <li key={f}><span className="tag">{/\.zip$/i.test(f) ? 'ZIP' : 'TMX'}</span><span className="fname" title={f}>{base(f)}</span>
              <button className="x" onClick={() => p.onRemove(f)} aria-label={`Remove ${base(f)}`}>×</button></li>
          ))}</ul>
        )}
        {p.scan.status === 'scanning' && <div className="status"><span className="spin" aria-hidden="true" />Scanning…</div>}
        {p.scan.status === 'error' && <div className="status err">{p.scan.error}</div>}
        {s && (
          <div className="status ok">
            Found {nf.format(s.unitCount)} translation units · {s.brands.length} brands · {s.projects.length} projects · {s.sourceLanguages.join(', ')} → {s.targetLanguages.join(', ') || 'no targets'}
          </div>
        )}
        <div className="actions"><button className="btn primary" disabled={p.scan.status !== 'ready'} onClick={p.onNext}>Continue</button></div>
      </section>
    </div>
  );
}

type SelState = { brands: string[]; projects: string[]; customers: string[]; approvals: string[]; sources: string[]; targets: string[]; allToAll: boolean; from: string; to: string };
type SelSet = { setBrands: (v: string[]) => void; setProjects: (v: string[]) => void; setCustomers: (v: string[]) => void; setApprovals: (v: string[]) => void; setSources: (v: string[]) => void; setTargets: (v: string[]) => void; setAllToAll: (v: boolean) => void; setFrom: (v: string) => void; setTo: (v: string) => void; setFormat: (v: OutputFormat) => void };

function Select(p: { data: Scanned; filter: FilterCriteria; format: OutputFormat; selected: number | null; preview: Preview | null; outputMode: OutputMode; setOutputMode: (m: OutputMode) => void; marketOutputMode: MarketOutputMode; setMarketOutputMode: (m: MarketOutputMode) => void; info: AppInfo | null; state: SelState; set: SelSet; onBack: () => void; onRun: () => void; onChangeRoot: () => void }) {
  const { scan, facets } = p.data; const st = p.state; const set = p.set;
  const brandEntries: [string, number][] = [...Object.entries(facets.brands), ...(facets.noBrand ? [[NO_BRAND, facets.noBrand] as [string, number]] : [])];
  const none = p.selected === 0;
  const dMin = day(scan.minCreation), dMax = day(scan.maxCreation);
  return (
    <div className="select">
      <div className="stats">
        <Stat label="Translation units" value={nf.format(scan.unitCount)} />
        <Stat label="Unique brands" value={String(scan.brands.length)} />
        <Stat label="Brand assignments" value={nf.format(scan.brandAssignments)} note="Units can carry several brands" />
        <Stat label="Projects" value={String(scan.projects.length)} />
        <Stat label="Customers" value={String(scan.customers.length)} />
        <Stat label="Files" value={String(scan.fileCount)} />
      </div>

      {scan.skippedCount > 0 && (
        <div className="note warn" role="status">
          <b>{nf.format(scan.skippedCount)}</b> translation unit{scan.skippedCount > 1 ? 's have' : ' has'} no source-language entry and will be skipped. They are recorded in the processing log; all other units are processed normally.
          <details><summary>Show details</summary><ul>{p.data.skipped.slice(0, 10).map((k, i) => <li key={i}>TUID {k.tuid || '(none)'} · {k.sourceFile} · {k.reason}</li>)}{scan.skippedCount > 10 && <li>…and {scan.skippedCount - 10} more (see the log)</li>}</ul></details>
        </div>
      )}

      <div className="cols">
        <ChecklistPanel title="Brand" primary entries={brandEntries} value={st.brands} onChange={set.setBrands} hint="Leave empty to include all brands." />
        <div className="side">
          <ChecklistPanel title="Approval status" entries={Object.entries(facets.approvalStatuses)} value={st.approvals} onChange={set.setApprovals} compact hint="Leave empty for all." />
          <section className="panel mini">
            <h2>Languages <span className="count">{st.allToAll ? 'All-to-All' : st.sources.length || st.targets.length ? 'Selected' : 'All'}</span></h2>
            <label className="toggle"><input type="checkbox" checked={st.allToAll} onChange={(e) => { set.setAllToAll(e.target.checked); if (e.target.checked) { set.setSources([]); set.setTargets([]); } }} />All-to-All <span className="hint">every source and target language, in one file</span></label>
          </section>
          <ChecklistPanel title="Source language" entries={Object.entries(facets.sourceLanguages)} value={st.sources} onChange={set.setSources} label={langLabel} disabled={st.allToAll} compact hint={st.allToAll ? 'All-to-All is on.' : 'Leave empty for all sources.'} />
          <ChecklistPanel title="Target language" entries={Object.entries(facets.targetLanguages)} value={st.targets} onChange={set.setTargets} label={langLabel} disabled={st.allToAll} compact hint={st.allToAll ? 'All-to-All is on.' : 'Leave empty for all targets.'} />
          <ChecklistPanel title="Project" entries={Object.entries(facets.projects)} value={st.projects} onChange={set.setProjects} compact searchable hint="Leave empty for all." />
          <section className="panel mini">
            <h2>Creation date <span className="count">range</span></h2>
            <div className="row two">
              <label className="field">From<input type="date" value={st.from} min={dMin} max={dMax} onChange={(e) => set.setFrom(e.target.value)} /></label>
              <label className="field">To<input type="date" value={st.to} min={dMin} max={dMax} onChange={(e) => set.setTo(e.target.value)} /></label>
            </div>
            {dMin && <p className="hint">Data spans {dMin} to {dMax}</p>}
          </section>
          <section className="panel mini">
            <h2>Customer</h2>
            {Object.keys(facets.customers).length > 0 && (
              <div className="chips" role="group" aria-label="Customer filter (optional)">{Object.keys(facets.customers).map((c) => (
                <button key={c} className={`chip ${st.customers.includes(c) ? 'on' : ''}`} aria-pressed={st.customers.includes(c)} onClick={() => set.setCustomers(toggle(st.customers, c))}>{c}</button>))}</div>
            )}
            <p className="hint">Optional. Not selected by default.</p>
          </section>
        </div>
      </div>

      {(st.brands.length > 1 || st.allToAll || st.sources.length + st.targets.length > 2) && (
        <div className={`output-panels ${st.brands.length > 1 && (st.allToAll || st.sources.length + st.targets.length > 2) ? 'two-panels' : ''}`}>
          {st.brands.length > 1 && <ModePanel mode={p.outputMode} setMode={p.setOutputMode} />}
          {(st.allToAll || st.sources.length + st.targets.length > 2) && <MarketModePanel mode={p.marketOutputMode} setMode={p.setMarketOutputMode} />}
        </div>
      )}

      <footer className="bar panel">
        <button className="btn" onClick={p.onBack}>Back</button>
        <div className="seg" role="radiogroup" aria-label="Output format">
          {FORMATS.map((f) => (
            <button key={f.id} role="radio" aria-checked={p.format === f.id} className={p.format === f.id ? 'on' : ''} onClick={() => set.setFormat(f.id)}>{f.label}<small>{f.hint}</small></button>))}
        </div>
        <div className="where" title={p.info?.outputRoot}>Output: <b>{p.info ? base(p.info.outputRoot) : '…'}</b> <button className="link" onClick={p.onChangeRoot}>Change</button></div>
        <div className={`sel ${none ? 'warn' : ''}`} aria-live="polite"><b>{p.selected === null ? '…' : nf.format(p.selected)}</b> of {nf.format(scan.unitCount)} units selected{st.brands.length > 1 && p.outputMode === 'separate' ? ` · ${st.brands.filter((b) => (p.preview?.perBrand[b] ?? 1) > 0).length} files` : ''}{none ? ' — adjust filters' : ''}</div>
        <button className="btn primary" disabled={!p.selected} onClick={p.onRun}>Process</button>
      </footer>
    </div>
  );
}

function ModePanel(p: { mode: OutputMode; setMode: (m: OutputMode) => void }) {
  const opts: { id: OutputMode; title: string; sub: string }[] = [
    { id: 'single', title: 'Single File', sub: 'Combine selected brands' },
    { id: 'separate', title: 'Separate Files', sub: 'One output file per brand' },
  ];
  return (
    <section className="panel modebar" aria-label="Multiple Brand output">
      <h2>Multiple Brand Output</h2>
      <div className="mode-options" role="radiogroup" aria-label="Multiple Brand output mode">
        {opts.map((o) => (
          <button key={o.id} role="radio" aria-checked={p.mode === o.id} className={`mode ${p.mode === o.id ? 'on' : ''}`} onClick={() => p.setMode(o.id)}>
            <span className="dot" aria-hidden="true" /><span><b>{o.title}</b><small>{o.sub}</small></span>
          </button>))}
      </div>
    </section>
  );
}

function MarketModePanel(p: { mode: MarketOutputMode; setMode: (m: MarketOutputMode) => void }) {
  const opts: { id: MarketOutputMode; title: string; sub: string }[] = [
    { id: 'combined', title: 'Multilingual File', sub: 'Combine all selected markets in one file' },
    { id: 'individual', title: 'Individual Market File', sub: 'One bilingual file per source–target pair' },
  ];
  return (
    <section className="panel modebar" aria-label="Multiple language output">
      <h2>Multiple File Output</h2>
      <div className="mode-options" role="radiogroup" aria-label="Multiple language output mode">
        {opts.map((o) => (
          <button key={o.id} role="radio" aria-checked={p.mode === o.id} className={`mode ${p.mode === o.id ? 'on' : ''}`} onClick={() => p.setMode(o.id)}>
            <span className="dot" aria-hidden="true" /><span><b>{o.title}</b><small>{o.sub}</small></span>
          </button>))}
      </div>
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="stat" title={note}><b>{value}</b><span>{label}</span></div>;
}

function ChecklistPanel(p: { title: string; entries: [string, number][]; value: string[]; onChange: (v: string[]) => void; primary?: boolean; compact?: boolean; searchable?: boolean; hint?: string; label?: (k: string) => string; disabled?: boolean }) {
  const [q, setQ] = useState('');
  const lbl = p.label ?? ((k: string) => k);
  const list = p.entries.filter(([k]) => `${k} ${lbl(k)}`.toLowerCase().includes(q.toLowerCase()));
  const showSearch = p.searchable || p.entries.length > 8;
  return (
    <section className={`panel check ${p.primary ? 'primary' : ''} ${p.compact ? 'compact' : ''} ${p.disabled ? 'disabled' : ''}`} aria-disabled={p.disabled}>
      <div className="head">
        <h2>{p.title} <span className="count">{p.value.length ? `${p.value.length} selected` : 'All'}</span></h2>
        <div className="mini-actions">
          <button className="link" disabled={p.disabled} onClick={() => p.onChange(p.entries.map(([k]) => k))}>All</button>
          <button className="link" disabled={p.disabled} onClick={() => p.onChange([])}>Clear</button>
        </div>
      </div>
      {showSearch && <input className="search" disabled={p.disabled} placeholder={`Search ${p.title.toLowerCase()}…`} value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Search ${p.title}`} />}
      {p.entries.length === 0 ? <p className="empty">Nothing found in the input.</p> : (
        <ul className="list">{list.map(([k, n]) => (
          <li key={k}><label><input type="checkbox" disabled={p.disabled} checked={p.value.includes(k)} onChange={() => p.onChange(toggle(p.value, k))} /><span className="lbl">{lbl(k)}</span><span className="n">{nf.format(n)}</span></label></li>))}
          {list.length === 0 && <li className="empty">No match.</li>}
        </ul>
      )}
      {p.hint && <p className="hint">{p.hint}</p>}
    </section>
  );
}

function Running({ progress }: { progress: Progress | null }) {
  const idx = Math.max(0, STAGES.indexOf((progress?.stage as typeof STAGES[number]) ?? 'Filtering'));
  return (
    <section className="panel run" aria-live="polite">
      <div className="orb" aria-hidden="true" />
      <h1>Processing…</h1>
      <ol className="stagelist">{STAGES.slice(0, 3).map((s, i) => <li key={s} className={i < idx ? 'past' : i === idx ? 'on' : ''}>{s}</li>)}</ol>
      <div className="bar-track" aria-hidden="true"><div className="bar-fill" style={{ width: `${((idx + 0.5) / 3) * 100}%` }} /></div>
      <p className="muted">Records scanned: <b>{nf.format(progress?.recordsScanned ?? 0)}</b> · Records selected: <b>{nf.format(progress?.recordsSelected ?? 0)}</b></p>
    </section>
  );
}

function Done({ result, onOpen, onNew, onClose }: { result: RunResult; onOpen: () => void; onNew: () => void; onClose: () => void }) {
  const rows: [string, string][] = [
    ['Run ID', result.runId], ['Input files', String(result.inputFileCount)], ['Output format', FORMATS.find((f) => f.id === result.format)?.label ?? result.format],
    ['Output mode', result.outputMode === 'separate' ? 'Separate Files per Brand' : 'Single File'],
    ['Records read', nf.format(result.recordsRead)],
    ['Records selected', nf.format(result.recordsSelected)], ['Records exported', nf.format(result.recordsExported)],
    ...(result.recordsSkipped ? ([['Records skipped', nf.format(result.recordsSkipped)]] as [string, string][]) : []),
    ['Languages', result.languages.join(', ')],
    ['Duration', `${(result.durationMs / 1000).toFixed(1)} s`], ['Output location', result.outputDir],
  ];
  return (
    <section className="panel done">
      <div className="tick" aria-hidden="true">✓</div>
      <h1>Processing Complete</h1>
      <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd title={v}>{v}</dd></div>)}</dl>
      <div className="filesout"><h2>Files generated <span className="count">{result.files.length}</span></h2><ul>{result.files.map((f) => <li key={f.path} title={f.path}><span className="ok" aria-hidden="true">✓</span><span className="fn">{f.name}</span><span className="n">{nf.format(f.records)} records</span></li>)}</ul></div>
      {result.warnings.length > 0 && <div className="note warn" role="status"><b>Not everything was exported</b><ul>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul><span className="hint">Details are saved in the processing log.</span></div>}
      <div className="actions"><button className="btn primary" onClick={onOpen}>Open Output Folder</button><button className="btn" onClick={onNew}>New run</button><button className="btn" onClick={onClose}>Close</button></div>
    </section>
  );
}
