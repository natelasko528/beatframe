import { useRef, useState } from 'react';
import { useStore, type Tab } from '../store';
import * as A from '../pipeline';
import { FONT_CHOICES } from '../engine/styles';
import { exportVideo } from '../engine/export';
import type { Direction } from '../engine/stages';
import { Preview } from './Preview';
import { Timeline } from './Timeline';

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const safe = (fn: () => any) => async () => { try { await fn(); } catch (e: any) { useStore.getState().set({ status: String(e.message || e), busy: false }); } };
const same = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);

/** A setting with its AI suggestion: shows "Suggested" when untouched, or a reset link when changed. */
function Setting({ label, k, children, hint }: { label: string; k: keyof Direction; children: React.ReactNode; hint?: string }) {
  const d = useStore(s => s.project.direction), sug = useStore(s => s.project.suggested);
  const changed = d && sug && !same(d[k], sug[k]);
  return (
    <div className="setting">
      <div className="setting-head"><span>{label}</span>{sug && (changed ? <button className="reset" onClick={() => A.resetDirectionField(k)}>Use suggestion</button> : <em className="sugg">Suggested</em>)}</div>
      {children}{hint && <small>{hint}</small>}
    </div>
  );
}
const edit = A.editDirection;

function DirectionTab() {
  const d = useStore(s => s.project.direction), reading = useStore(s => s.project.reading), notes = useStore(s => s.project.frameNotes), ai = useStore(s => s.ai), busy = useStore(s => s.busy), letters = useStore(s => s.project.letters.length);
  const hot = useStore(s => s.project.style.lyrics.hotWords);
  const [wish, setWish] = useState('');
  if (!d) return <p className="empty">No direction yet.</p>;
  return (
    <div className="tab-body">
      <article className="concept big"><h2>{d.concept}</h2><p>{d.world}</p>{d.why && <p className="why">{d.why}</p>}
        {reading && reading.genre !== 'unknown' && <p className="tags">{[reading.genre, reading.subgenre, ...reading.themes.slice(0, 4)].filter(Boolean).map(t => <span key={t}>{t}</span>)}</p>}</article>
      <div className="redirect">
        <input value={wish} onChange={e => setWish(e.target.value)} placeholder={ai ? 'Tell the director what to change, e.g. "brighter, daytime, beach"' : 'Add an AI key to get new directions'} disabled={!ai} onKeyDown={e => e.key === 'Enter' && wish && safe(() => A.redirect(wish))()} aria-label="New direction" />
        <button disabled={!ai || busy} onClick={safe(() => A.redirect(wish))}>{wish ? 'Redirect' : 'New idea'}</button>
      </div>

      <h3>Look</h3>
      <Setting label="Light and grade" k="mood" hint="Added to every scene's image prompt."><textarea rows={2} value={d.mood} onChange={e => edit(x => { x.mood = e.target.value; })} /></Setting>
      <Setting label="Colours" k="palette">
        <div className="palette">{(Object.keys(d.palette) as (keyof Direction['palette'])[]).map(c => <label key={c}><input type="color" value={d.palette[c]} onChange={e => edit(x => { x.palette[c] = e.target.value; })} /><span>{({ background: 'Cards', text: 'Text', accent: 'Accent', accent2: 'Accent 2', hot: 'Hot words', sign: 'Signs' } as any)[c]}</span></label>)}</div>
      </Setting>
      <Setting label="Type" k="fonts">
        <div className="grid2">{(['lyric', 'display', 'hot', 'small'] as const).map(f => <label key={f} className="mini"><span>{({ lyric: 'Lyrics', display: 'Titles', hot: 'Hot words', small: 'Small text' })[f]}</span>
          <select value={d.fonts[f]} onChange={e => edit(x => { x.fonts[f] = e.target.value; })} style={{ fontFamily: d.fonts[f] }}>{FONT_CHOICES.map(o => <option key={o} style={{ fontFamily: o }}>{o}</option>)}</select></label>)}</div>
      </Setting>
      <Setting label="Atmosphere" k="particles"><div className="seg">{(['none', 'dust', 'embers', 'rain', 'snow'] as const).map(o => <button key={o} aria-pressed={d.particles === o} onClick={() => edit(x => { x.particles = o; })}>{o}</button>)}</div></Setting>
      <Setting label="Film finish" k="grade">
        <div className="sliders">
          {([['letterbox', 'Letterbox bars', 0, 120, 2], ['bloom', 'Glow', 0, 0.5, 0.02], ['grain', 'Grain', 0, 0.2, 0.01], ['vignette', 'Vignette', 0, 0.8, 0.05], ['lightLeak', 'Light leak', 0, 0.3, 0.02]] as const).map(([k2, l, mn, mx, stp]) =>
            <label key={k2}><span>{l}</span><input type="range" min={mn} max={mx} step={stp} value={d.grade[k2] as number} onChange={e => edit(x => { (x.grade as any)[k2] = +e.target.value; })} /></label>)}
          <label className="check"><input type="checkbox" checked={d.grade.colourSplitOnDrops} onChange={e => edit(x => { x.grade.colourSplitOnDrops = e.target.checked; })} />Colour split on drops</label>
        </div>
      </Setting>

      <h3>Lyrics on screen</h3>
      <Setting label="Layout" k="lyrics">
        <div className="seg">{(['lower-left', 'lower-center', 'center'] as const).map(o => <button key={o} aria-pressed={d.lyrics.layout === o} onClick={() => edit(x => { x.lyrics.layout = o; })}>{({ 'lower-left': 'Lower left', 'lower-center': 'Lower centre', center: 'Centre' })[o]}</button>)}</div>
        <div className="seg">{(['rise', 'blur', 'pop', 'type'] as const).map(o => <button key={o} aria-pressed={d.lyrics.reveal === o} onClick={() => edit(x => { x.lyrics.reveal = o; })}>{({ rise: 'Rise', blur: 'Blur in', pop: 'Pop', type: 'Type' })[o]}</button>)}</div>
        <label className="slider-row"><span>Size {d.lyrics.size}</span><input type="range" min={60} max={120} step={2} value={d.lyrics.size} onChange={e => edit(x => { x.lyrics.size = +e.target.value; })} /></label>
        <label className="check"><input type="checkbox" checked={d.lyrics.caps} onChange={e => edit(x => { x.lyrics.caps = e.target.checked; })} />Capitals</label>
      </Setting>
      <div className="setting"><div className="setting-head"><span>Hot words</span></div>
        <input value={hot.join(', ')} onChange={e => useStore.getState().update(p => { p.style.lyrics.hotWords = e.target.value.split(',').map(w => w.trim().toUpperCase()).filter(Boolean); if (p.reading) p.reading.hotWords = p.style.lyrics.hotWords; })} /></div>

      <h3>Motion and graphics</h3>
      <Setting label="Energy" k="energy" hint="Zoom punches on kicks, shake and whip pans."><input type="range" min={0} max={1} step={0.05} value={d.energy} onChange={e => edit(x => { x.energy = +e.target.value; })} aria-label="Energy" /></Setting>
      <Setting label="Transitions" k="transitions">
        <div className="grid2"><label className="mini"><span>Section changes</span><select value={d.transitions.section} onChange={e => edit(x => { x.transitions.section = e.target.value as any; })}><option value="film-burn">Film burn</option><option value="light-sweep">Light sweep</option><option value="flash">Flash</option><option value="none">Cut</option></select></label>
          <label className="mini"><span>Hook drops</span><select value={d.transitions.drop} onChange={e => edit(x => { x.transitions.drop = e.target.value as any; })}><option value="flash">Flash</option><option value="flash-rgb">Flash + colour split</option><option value="none">Cut</option></select></label></div>
      </Setting>
      <Setting label="Graphics" k="graphics">
        <div className="checks">
          {([['placeSigns', 'Place-name signs'], ['locationCaptions', 'Location captions'], ['shoutStamps', 'Shout stamps'], ['titleOnDrops', 'Title on drops'], ['letterbox_credits', 'Credits in the bars']] as const).map(([k2, l]) =>
            <label key={k2} className="check"><input type="checkbox" checked={d.graphics[k2] as boolean} onChange={e => edit(x => { (x.graphics as any)[k2] = e.target.checked; })} />{l}</label>)}
        </div>
        <div className="seg"><button aria-pressed={d.graphics.opener === 'classic'} onClick={() => edit(x => { x.graphics.opener = 'classic'; })}>Classic opener</button><button aria-pressed={d.graphics.opener === 'definition'} onClick={() => edit(x => { x.graphics.opener = 'definition'; })}>Dictionary opener</button></div>
        {letters > 0 && <small>Alphabet song: giant letters and the A–Z ruler are on.</small>}
      </Setting>
      <Setting label="End card" k="titleCard"><input value={d.titleCard.tagline} onChange={e => edit(x => { x.titleCard.tagline = e.target.value; })} />
        {d.graphics.opener === 'definition' && <textarea rows={4} value={d.titleCard.definition.join('\n')} onChange={e => edit(x => { x.titleCard.definition = e.target.value.split('\n'); })} />}</Setting>
      {notes?.length ? <p className="frame-notes"><b>Frame check:</b> {notes.join(' ')}</p> : null}
    </div>
  );
}

function ScenesTab({ seek }: { seek: (t: number) => void }) {
  const p = useStore(s => s.project), blobs = useStore(s => s.blobs), ai = useStore(s => s.ai), im = useStore(s => s.imageModel), busy = useStore(s => s.busy);
  const [open, setOpen] = useState<string | null>(null);
  const missing = p.scenes.filter(s => s.status !== 'done').length;
  return (
    <div className="tab-body">
      <div className="row between"><p className="note">{p.scenes.length} scenes across {p.shots.length} shots, cut to the beat.</p>
        {missing > 0 && <button className="primary" disabled={!im || busy} onClick={safe(() => A.generateAll())}>Make {missing} images</button>}</div>
      {!im && <p className="warn">No image key: upload your own pictures on each scene, or add an OpenAI, Gemini or fal key.</p>}
      <ul className="scene-list">{p.scenes.map(s => {
        const first = p.shots.find(x => x.img === s.id);
        return (
          <li key={s.id} className={`scene st-${s.status ?? 'idle'}`}>
            <button className="scene-thumb" onClick={() => first && seek(first.from + 0.3)} aria-label={`Jump to scene ${s.id}`}>
              {blobs[s.id] ? <img src={URL.createObjectURL(blobs[s.id])} alt="" /> : <span>{s.status === 'generating' ? 'Painting…' : 'No image yet'}</span>}
              {first && <em>{fmt(first.from)}</em>}{s.verdict && <i className={s.verdict.pass ? 'ok' : 'bad'} title={s.verdict.issues.join('; ')}>{s.verdict.score}/10</i>}
            </button>
            <div className="scene-body">
              <p className="lyric">{s.word ? <b>{s.word} · </b> : null}“{s.lyric}”</p>
              <textarea rows={3} defaultValue={s.idea} key={s.idea} onBlur={e => e.target.value !== s.idea && A.setSceneIdea(s.id, e.target.value)} aria-label={`Idea for scene ${s.id}`} placeholder="Describe the scene" />
              <div className="row small">
                <label className="check"><input type="checkbox" checked={s.withAvatar} disabled={!p.avatar.refIds.length} onChange={e => A.setSceneArtist(s.id, e.target.checked)} />Artist in shot</label>
                <button disabled={!ai} onClick={safe(() => A.rewriteScene(s.id))} title="Ask your AI for a different idea">New idea</button>
                <button disabled={!im || s.status === 'generating'} onClick={() => A.generateScene(s.id)}>{blobs[s.id] ? 'Repaint' : 'Paint'}</button>
                <label className="btn">Upload<input type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && A.addAsset(e.target.files[0], 'image', s.id, s.id).then(() => useStore.getState().update(pp => { pp.scenes.find(x => x.id === s.id)!.status = 'done'; }))} /></label>
                <button className="linkish" onClick={() => setOpen(open === s.id ? null : s.id)}>{open === s.id ? 'Hide prompt' : 'Full prompt'}</button>
              </div>
              {open === s.id && <textarea className="prompt" rows={6} defaultValue={s.prompt} onBlur={e => e.target.value !== s.prompt && A.setScenePrompt(s.id, e.target.value)} aria-label="Full image prompt" />}
              {s.error && <p className="err">{s.error}</p>}
            </div>
          </li>);
      })}</ul>
    </div>
  );
}

function LyricsTab({ seek }: { seek: (t: number) => void }) {
  const p = useStore(s => s.project), update = useStore(s => s.update), busy = useStore(s => s.busy);
  return (
    <div className="tab-body">
      <p className="note">Click a time to jump there, fix a line's words, or nudge it if it lands early or late.</p>
      <ol className="lines">{p.lines.map(l => (
        <li key={l.i} className={l.style}>
          <button className="t" onClick={() => seek(l.start)}>{fmt(l.start)}</button>
          <input defaultValue={l.text} key={l.text} onBlur={e => e.target.value !== l.text && A.editLineText(l.i, e.target.value)} aria-label={`Line at ${fmt(l.start)}`} />
          <span className="nudge"><button aria-label="Earlier" onClick={() => A.nudgeLine(l.i, -0.1)}>−</button><button aria-label="Later" onClick={() => A.nudgeLine(l.i, 0.1)}>+</button></span>
        </li>))}</ol>
      <details><summary>Paste official lyrics and re-time</summary>
        <textarea rows={8} value={p.lyricsRaw} onChange={e => update(pp => { pp.lyricsRaw = e.target.value; })} placeholder={'[Hook]\n…'} />
        <button disabled={busy} onClick={safe(A.retimeLyrics)}>Re-time to the vocal</button>
      </details>
    </div>
  );
}

function ArtistTab() {
  const p = useStore(s => s.project), blobs = useStore(s => s.blobs), update = useStore(s => s.update);
  const avatars = p.assets.filter(a => a.kind === 'avatar'), covers = p.assets.filter(a => a.kind === 'cover');
  return (
    <div className="tab-body">
      <div className="setting"><div className="setting-head"><span>Artist photos</span></div><p className="note">2–4 clear photos keep the face consistent. They're sent only with scenes that feature the artist.</p>
        <div className="photos">{avatars.map(a => <figure key={a.id}><img src={blobs[a.id] ? URL.createObjectURL(blobs[a.id]) : ''} alt={a.name} /><button aria-label="Remove" onClick={() => A.removeAsset(a.id)}>×</button></figure>)}
          <label className="photo-add"><input type="file" accept="image/*" multiple hidden onChange={e => Array.from(e.target.files ?? []).forEach(f => A.addAsset(f, 'avatar', undefined, f.name))} />+ Add</label></div></div>
      <div className="setting"><div className="setting-head"><span>Look details</span></div><textarea rows={3} value={p.avatar.description} onChange={e => update(pp => { pp.avatar.description = e.target.value; })} onBlur={() => A.refreshPrompts()} placeholder="Anything to keep the same in every scene: hair, jewellery, tattoos" /></div>
      <div className="setting"><div className="setting-head"><span>Wardrobe</span>{p.suggested && <em className="sugg">Suggested</em>}</div><input value={p.direction?.wardrobe ?? ''} onChange={e => A.editDirection(x => { x.wardrobe = e.target.value; })} /></div>
      <div className="setting"><div className="setting-head"><span>Album cover</span></div><p className="note">Shown on the end card.</p>
        <div className="photos">{covers.map(a => <figure key={a.id}><img src={blobs[a.id] ? URL.createObjectURL(blobs[a.id]) : ''} alt="Cover" /><button aria-label="Remove" onClick={() => A.removeAsset(a.id)}>×</button></figure>)}
          {!covers.length && <label className="photo-add"><input type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && A.addAsset(e.target.files[0], 'cover', undefined, 'cover')} />+ Add</label>}</div></div>
    </div>
  );
}

function ExportTab() {
  const p = useStore(s => s.project), images = useStore(s => s.images), audio = useStore(s => s.audioBuffer);
  const [res, setRes] = useState(1080); const [prog, setProg] = useState<number | null>(null); const [out, setOut] = useState<{ url: string; ext: string } | null>(null); const ac = useRef<AbortController | null>(null);
  const vertical = p.height > p.width, long = Math.round((res * 16) / 9 / 2) * 2, W = vertical ? res : long, H = vertical ? long : res;
  const file = `${p.meta.artist ? p.meta.artist + ' - ' : ''}${p.meta.title}`.replace(/[\\/:*?"<>|]/g, '');
  const go = safe(async () => {
    if (!audio) throw new Error('The song is missing. Start a new video.');
    if (!('VideoEncoder' in window)) throw new Error('This browser can’t encode video. Use Chrome, Edge or Safari.');
    ac.current = new AbortController(); setOut(null); setProg(0);
    try { const r = await exportVideo(p, images, audio, { width: W, height: H, quality: 'very-high', onProgress: x => setProg(x), signal: ac.current.signal }, A.clipBlobs()); setOut({ url: URL.createObjectURL(r.blob), ext: r.ext }); }
    finally { setProg(null); }
  });
  return (
    <div className="tab-body">
      <div className="setting"><div className="setting-head"><span>Resolution</span></div>
        <div className="seg">{[480, 720, 1080, 1440, 2160].map(r => <button key={r} aria-pressed={res === r} onClick={() => setRes(r)}>{r === 2160 ? '4K' : `${r}p`}</button>)}</div>
        <small>{W}×{H}. Rendered natively at this size on your device; nothing is uploaded.</small></div>
      {prog === null ? <button className="cta" disabled={!p.shots.length} onClick={go}>Export video</button>
        : <div className="progress"><div style={{ width: `${prog * 100}%` }} /><span>Rendering {Math.round(prog * 100)}%</span><button onClick={() => ac.current?.abort()}>Cancel</button></div>}
      {out && <a className="cta" href={out.url} download={`${file}.${out.ext}`}>Download {out.ext.toUpperCase()}</a>}
      {out?.ext === 'webm' && <p className="note">This browser has no H.264 encoder, so the file is WebM. Chrome, Edge and Safari export MP4.</p>}
      <div className="setting"><div className="setting-head"><span>Project file</span></div><p className="note">Everything in one file: timing, direction, scenes and images. Open it later or render it from the command line.</p>
        <div className="row"><button onClick={safe(async () => { const b = await A.exportProjectFile(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${file}.beatframe.json`; a.click(); })}>Download project</button>
          <label className="btn">Open project<input type="file" accept=".json" hidden onChange={e => e.target.files?.[0] && A.importProjectFile(e.target.files[0])} /></label></div></div>
    </div>
  );
}

const TABS: { id: Tab; label: string }[] = [{ id: 'vibe', label: 'Direction' }, { id: 'scenes', label: 'Scenes' }, { id: 'words', label: 'Lyrics' }, { id: 'cast', label: 'Artist' }, { id: 'export', label: 'Export' }];

export function Studio({ audio, seek, toggle, playing }: { audio: React.RefObject<HTMLAudioElement>; seek: (t: number) => void; toggle: () => void; playing: boolean }) {
  const tab = useStore(s => s.tab), set = useStore(s => s.set), p = useStore(s => s.project), time = useStore(s => s.time), spend = useStore(s => s.spend), status = useStore(s => s.status), busy = useStore(s => s.busy);
  return (
    <div className="studio">
      <header className="bar">
        <p className="brand">BeatFrame</p>
        <div className="bar-title"><b>{p.meta.title}</b>{p.meta.artist && <span>{p.meta.artist}</span>}</div>
        <span className={`status ${busy ? 'is-busy' : ''}`} role="status">{status}</span>
        <span className="spend" title="Spent on your own keys">${(spend.ai + spend.images).toFixed(2)} spent</span>
        <button onClick={() => set({ tab: 'export' })} className="primary">Export</button>
        <button onClick={() => confirm('Start a new video? This one is cleared from this browser.') && A.resetProject()}>New video</button>
      </header>
      <main className="stage">
        <Preview audioRef={audio} />
        <div className="transport">
          <button className="play" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'Pause' : 'Play'}</button>
          <span className="clock">{fmt(time)} / {fmt(p.analysis?.dur ?? 0)}</span>
          {p.analysis && <span className="meta">{Math.round(p.analysis.tempo)} BPM{p.analysis.features ? ` · ${p.analysis.features.key} ${p.analysis.features.mode}` : ''}{p.reading && p.reading.genre !== 'unknown' ? ` · ${p.reading.genre}` : ''}</span>}
        </div>
      </main>
      <aside className="inspector">
        <nav className="tabs" role="tablist">{TABS.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => set({ tab: t.id })}>{t.label}</button>)}</nav>
        {tab === 'vibe' && <DirectionTab />}{tab === 'scenes' && <ScenesTab seek={seek} />}{tab === 'words' && <LyricsTab seek={seek} />}{tab === 'cast' && <ArtistTab />}{tab === 'export' && <ExportTab />}
      </aside>
      <footer className="tl"><Timeline seek={seek} /></footer>
    </div>
  );
}
