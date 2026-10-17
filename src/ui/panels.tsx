import { useRef, useState } from 'react';
import { useStore, type Step } from '../store';
import * as A from '../pipeline';
import { PRESETS, FONT_CHOICES, MOODS } from '../engine/styles';
import { IMAGE_MODEL_SUGGESTIONS } from '../providers/images';
import { LLM_SUGGESTIONS } from '../providers/llm';
import { LOCAL_ASR_MODELS } from '../providers/transcribe';
import { exportVideo } from '../engine/export';
import type { Style, Shot } from '../engine/types';

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;
const run = (fn: () => any) => async () => { try { await fn(); } catch (e: any) { useStore.getState().set({ status: String(e.message || e), busy: false }); } };
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

// ---------------- Song ----------------
export function SongPanel() {
  const p = useStore(s => s.project), update = useStore(s => s.update), set = useStore(s => s.set), city = useStore(s => s.city), signWords = useStore(s => s.signWords);
  return (
    <section className="panel">
      <h2>Song</h2>
      <label className="drop">
        <input type="file" accept="audio/*" onChange={e => e.target.files?.[0] && run(() => A.loadAudio(e.target.files![0]))()} />
        <strong>{p.audio ? p.audio.name : 'Choose an audio file'}</strong>
        <span>{p.analysis ? `${p.analysis.tempo.toFixed(1)} BPM · ${Math.round(p.analysis.dur)} s · ${p.analysis.beats.length} beats` : 'MP3, WAV or M4A. The beat is analysed on your device.'}</span>
      </label>
      <Field label="Title"><input value={p.meta.title} onChange={e => update(p => { p.meta.title = e.target.value; })} /></Field>
      <Field label="Artist"><input value={p.meta.artist} onChange={e => update(p => { p.meta.artist = e.target.value; })} /></Field>
      <Field label="End-card line" hint="Shown under the title at the end."><input value={p.meta.tagline ?? ''} onChange={e => update(p => { p.meta.tagline = e.target.value; })} /></Field>
      <Field label="Format">
        <div className="seg">{[['16:9', 1920, 1080], ['9:16', 1080, 1920]].map(([n, w, h]) => <button key={n} aria-pressed={p.width === w} onClick={() => update(p => { p.width = w as number; p.height = h as number; })}>{n} {n === '9:16' ? 'Reels / TikTok' : 'YouTube'}</button>)}</div>
      </Field>
      <Field label="City or setting" hint="Used in scene prompts, e.g. Milwaukee, Wisconsin."><input value={city} onChange={e => set({ city: e.target.value })} /></Field>
      <Field label="Sign-pop words" hint="Comma-separated street names or places. Street names in the lyrics are also found automatically."><input value={signWords} onChange={e => set({ signWords: e.target.value })} onBlur={() => useStore.getState().project.lines.length && A.refreshDerived()} /></Field>
    </section>
  );
}

// ---------------- Words ----------------
export function WordsPanel({ seek, audio }: { seek: (t: number) => void; audio: React.RefObject<HTMLAudioElement> }) {
  const p = useStore(s => s.project), update = useStore(s => s.update), asr = useStore(s => s.asr), set = useStore(s => s.set), busy = useStore(s => s.busy);
  const [taps, setTaps] = useState<number[] | null>(null); const [lrc, setLrc] = useState('');
  const parsedCount = p.lyricsRaw.split('\n').filter(l => l.trim() && !/^\[.*\]$/.test(l.trim())).length;
  const startTap = () => { setTaps([]); if (audio.current) { audio.current.currentTime = 0; audio.current.play(); } };
  const tap = () => setTaps(t => (t ? [...t, audio.current?.currentTime ?? 0] : t));
  return (
    <section className="panel" onKeyDown={e => { if (taps && e.code === 'Space') { e.preventDefault(); tap(); } }}>
      <h2>Lyrics and timing</h2>
      <Field label="Lyrics" hint="Paste the official lyrics. Use [Hook], [Verse 1], [Bridge] tags. A tag with no lines repeats that section.">
        <textarea rows={10} value={p.lyricsRaw} onChange={e => update(p => { p.lyricsRaw = e.target.value; })} placeholder={'[Intro]\nAyy\n\n[Hook]\n…'} />
      </Field>
      <Field label="Timing engine">
        <select value={asr.kind === 'local' ? asr.model : 'openai'} onChange={e => set({ asr: e.target.value === 'openai' ? { kind: 'openai', model: 'whisper-1' } : { kind: 'local', model: e.target.value } })}>
          {LOCAL_ASR_MODELS.map(m => <option key={m} value={m}>On-device (free): {m.split('/')[1]}</option>)}
          <option value="openai">OpenAI Whisper (your key)</option>
        </select>
      </Field>
      <div className="row">
        <button className="primary" disabled={busy || !p.analysis || !parsedCount} onClick={run(() => A.alignAuto())}>Time lyrics automatically</button>
        <button disabled={!p.analysis || !parsedCount} onClick={() => A.alignSpread(p.analysis!.beats[4] ?? 0, p.analysis!.dur - 4)}>Spread evenly</button>
      </div>
      <details><summary>No AI: tap-sync or LRC</summary>
        {!taps ? <button disabled={!p.analysis || !parsedCount} onClick={startTap}>Start tap-sync</button>
          : <div className="tapper"><p>Press <kbd>Space</kbd> (or the button) at the start of each line. {taps.length}/{parsedCount}</p>
            <button className="primary" onClick={tap}>Tap: {p.lyricsRaw.split('\n').filter(l => l.trim() && !/^\[.*\]$/.test(l.trim()))[taps.length] ?? 'done'}</button>
            <button onClick={() => { A.alignTaps(taps); setTaps(null); audio.current?.pause(); }}>Use these taps</button></div>}
        <Field label="LRC timing"><textarea rows={3} value={lrc} onChange={e => setLrc(e.target.value)} placeholder="[00:12.30] first line" /></Field>
        <button disabled={!lrc} onClick={() => A.alignLrc(lrc)}>Import LRC</button>
      </details>
      {p.lines.length > 0 && <ol className="lines">{p.lines.map(l => (
        <li key={l.i} className={l.style}>
          <button className="t" onClick={() => seek(l.start)}>{fmt(l.start)}</button>
          <span className="txt">{l.words.map((w, k) => <span key={k} className={w.m === false ? 'guess' : ''}>{w.d} </span>)}</span>
          <span className="nudge"><button aria-label="Earlier" onClick={() => A.nudgeLine(l.i, -0.1)}>−</button><button aria-label="Later" onClick={() => A.nudgeLine(l.i, 0.1)}>+</button></span>
        </li>))}</ol>}
    </section>
  );
}

// ---------------- Look ----------------
export function LookPanel() {
  const st = useStore(s => s.project.style), meta = useStore(s => s.project.meta), update = useStore(s => s.update);
  const S = (fn: (s: Style) => void) => update(p => fn(p.style));
  const color = (k: keyof Style['palette'], label: string) => <label className="swatch"><input type="color" value={/^#/.test(st.palette[k]) ? st.palette[k] : '#000000'} onChange={e => S(s => { (s.palette as any)[k] = e.target.value; })} />{label}</label>;
  const font = (k: keyof Style['fonts'], label: string) => <Field label={label}><select value={st.fonts[k]} onChange={e => S(s => { s.fonts[k] = e.target.value; })}>{FONT_CHOICES.map(f => <option key={f}>{f}</option>)}</select></Field>;
  const slider = (label: string, v: number, min: number, max: number, step: number, fn: (s: Style, v: number) => void) => <Field label={`${label}: ${v}`}><input type="range" min={min} max={max} step={step} value={v} onChange={e => S(s => fn(s, +e.target.value))} /></Field>;
  const toggle = (k: keyof Style['features'], label: string) => <label className="check"><input type="checkbox" checked={st.features[k]} onChange={e => S(s => { s.features[k] = e.target.checked; })} />{label}</label>;
  return (
    <section className="panel">
      <h2>Look</h2>
      <div className="presets">{Object.entries(PRESETS).map(([k, v]) => <button key={k} aria-pressed={st.name === v.name} onClick={() => update(p => { p.style = structuredClone(v); })}>{v.name}</button>)}</div>
      <h3>Colour</h3>
      <div className="swatches">{color('text', 'Text')}{color('accent', 'Accent')}{color('accent2', 'Second accent')}{color('hot', 'Hot words')}{color('sign', 'Signs')}{color('signAlt', 'Alt signs')}{color('bg', 'Cards')}</div>
      <h3>Type</h3>
      {font('lyric', 'Lyrics')}{font('hot', 'Hot words')}{font('display', 'Titles')}{font('ui', 'Small text')}
      <Field label="Lyric position"><select value={st.lyrics.layout} onChange={e => S(s => { s.lyrics.layout = e.target.value as any; })}><option value="lower-left">Lower left</option><option value="lower-center">Lower centre</option><option value="center">Centre</option></select></Field>
      <Field label="Word reveal"><select value={st.lyrics.reveal} onChange={e => S(s => { s.lyrics.reveal = e.target.value as any; })}><option value="rise">Rise</option><option value="blur">Blur in</option><option value="pop">Pop</option><option value="type">Type on</option></select></Field>
      {slider('Lyric size', st.lyrics.size, 50, 130, 2, (s, v) => (s.lyrics.size = v))}
      <Field label="Hot words" hint="Comma-separated. Shown in the hot-word font and colour."><input value={st.lyrics.hotWords.join(', ')} onChange={e => S(s => { s.lyrics.hotWords = e.target.value.split(',').map(x => x.trim().toUpperCase()).filter(Boolean); })} /></Field>
      <label className="check"><input type="checkbox" checked={st.lyrics.alliteration} onChange={e => S(s => { s.lyrics.alliteration = e.target.checked; })} />Highlight words that start with the line's letter</label>
      <label className="check"><input type="checkbox" checked={st.lyrics.case === 'upper'} onChange={e => S(s => { s.lyrics.case = e.target.checked ? 'upper' : 'as-is'; })} />Capitals</label>
      <h3>Motion</h3>
      {slider('Kick zoom', st.motion.kickZoom, 0, 0.04, 0.002, (s, v) => (s.motion.kickZoom = v))}
      {slider('Cut punch', st.motion.cutPunch, 0, 0.1, 0.005, (s, v) => (s.motion.cutPunch = v))}
      {slider('Shake', st.motion.shake, 0, 8, 0.5, (s, v) => (s.motion.shake = v))}
      <label className="check"><input type="checkbox" checked={st.motion.whipPans} onChange={e => S(s => { s.motion.whipPans = e.target.checked; })} />Whip pans at section starts</label>
      <label className="check"><input type="checkbox" checked={st.motion.letterMask} onChange={e => S(s => { s.motion.letterMask = e.target.checked; })} />Open letter scenes through the letter</label>
      <h3>Grade</h3>
      {slider('Bloom', st.grade.bloom, 0, 0.6, 0.02, (s, v) => (s.grade.bloom = v))}
      {slider('Grain', st.grade.grain, 0, 0.25, 0.01, (s, v) => (s.grade.grain = v))}
      {slider('Vignette', st.grade.vignette, 0, 0.9, 0.05, (s, v) => (s.grade.vignette = v))}
      {slider('Light leak', st.grade.lightLeak, 0, 0.4, 0.02, (s, v) => (s.grade.lightLeak = v))}
      {slider('Letterbox', st.grade.letterbox, 0, 140, 2, (s, v) => (s.grade.letterbox = v))}
      <Field label="Particles"><select value={st.particles} onChange={e => S(s => { s.particles = e.target.value as any; })}>{['embers', 'rain', 'snow', 'dust', 'none'].map(x => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Section change"><select value={st.transitions.section} onChange={e => S(s => { s.transitions.section = e.target.value as any; })}><option value="film-burn">Film burn</option><option value="light-sweep">Light sweep</option><option value="flash">Flash</option><option value="none">Cut</option></select></Field>
      <Field label="Hook drop"><select value={st.transitions.drop} onChange={e => S(s => { s.transitions.drop = e.target.value as any; })}><option value="flash">Flash</option><option value="flash-rgb">Flash + colour split</option><option value="none">Cut</option></select></Field>
      <h3>Graphics</h3>
      <div className="checks">{toggle('signs', 'Street-sign pops')}{toggle('captions', 'Location captions')}{toggle('stamps', 'Shout stamps')}{toggle('bigLetters', 'Giant letters')}{toggle('ruler', 'A–Z ruler')}{toggle('dictionaryOpen', 'Dictionary opening')}{toggle('dropLockup', 'Title on hook drops')}{toggle('footer', 'Letterbox credits')}</div>
      {st.features.dictionaryOpen && <Field label="Dictionary entry" hint="First line is the headword, then one definition per line.">
        <textarea rows={4} value={(meta.definition ?? []).join('\n')} onChange={e => update(p => { p.meta.definition = e.target.value.split('\n'); })} placeholder={'al·pha·bet hus·tler\n/ ˈalfəˌbet ˈhəs(ə)lər /   noun\n1.  One who runs the whole alphabet.\n2.  See also: Milwaukee.'} /></Field>}
    </section>
  );
}

// ---------------- Cast ----------------
function Thumbs({ kind }: { kind: 'avatar' | 'location' | 'cover' }) {
  const assets = useStore(s => s.project.assets.filter(a => a.kind === kind)), blobs = useStore(s => s.blobs);
  return <div className="thumbs">{assets.map(a => <figure key={a.id}><img src={blobs[a.id] ? URL.createObjectURL(blobs[a.id]) : ''} alt={a.name} /><button aria-label={`Remove ${a.name}`} onClick={() => A.removeAsset(a.id)}>×</button></figure>)}
    <label className="add"><input type="file" accept="image/*" multiple={kind !== 'cover'} onChange={e => [...(e.target.files ?? [])].forEach(f => A.addAsset(f, kind, undefined, f.name))} />Add</label></div>;
}
export function CastPanel() {
  const p = useStore(s => s.project), update = useStore(s => s.update);
  return (
    <section className="panel">
      <h2>Cast</h2>
      <h3>Main character</h3>
      <p className="note">Add 2–4 clear photos of the artist: front-facing, good light, different angles. They are sent with every scene that features the artist so the face stays consistent.</p>
      <Thumbs kind="avatar" />
      <Field label="Signature look" hint="Wardrobe and details to keep the same in every scene."><textarea rows={3} value={p.avatar.description} onChange={e => update(p => { p.avatar.description = e.target.value; })} placeholder="Curly dark hair, salt-and-pepper goatee, black t-shirt, gold Cuban link chain with a square pendant" /></Field>
      <h3>Album cover</h3><p className="note">Used on the end card.</p><Thumbs kind="cover" />
      <h3>Real locations</h3><p className="note">Photos of real places. Attach them to scenes to recreate the location.</p><Thumbs kind="location" />
    </section>
  );
}

// ---------------- Scenes ----------------
export function ScenesPanel() {
  const p = useStore(s => s.project), update = useStore(s => s.update), set = useStore(s => s.set), mood = useStore(s => s.mood), im = useStore(s => s.imageModel), llm = useStore(s => s.llm), busy = useStore(s => s.busy), blobs = useStore(s => s.blobs);
  const locs = p.assets.filter(a => a.kind === 'location');
  const done = p.scenes.filter(s => s.status === 'done').length;
  return (
    <section className="panel">
      <h2>Scenes</h2>
      <Field label="Mood"><select value={mood} onChange={e => set({ mood: e.target.value })}>{Object.keys(MOODS).map(m => <option key={m}>{m}</option>)}</select></Field>
      <Field label="Cutting"><select value={p.plan.mode} onChange={e => update(p => { p.plan.mode = e.target.value as any; })}><option value="per-line">One shot per lyric line</option><option value="alphabet">Alphabet: one scene per letter</option><option value="beats">Fast: cut every few beats</option></select></Field>
      {p.plan.mode === 'beats' && <Field label={`Beats per shot: ${p.plan.beatsPerShot}`}><input type="range" min={2} max={8} value={p.plan.beatsPerShot} onChange={e => update(p => { p.plan.beatsPerShot = +e.target.value; })} /></Field>}
      <button className="primary" disabled={!p.lines.length} onClick={run(() => A.planVideo())}>{p.shots.length ? 'Re-plan the edit' : 'Plan the edit'}</button>
      {p.scenes.length > 0 && <>
        <h3>Image model</h3>
        <div className="row">
          <select value={im.provider} onChange={e => set({ imageModel: { ...im, provider: e.target.value as any, model: IMAGE_MODEL_SUGGESTIONS[e.target.value as 'openai'][0] } })}><option value="openai">OpenAI</option><option value="gemini">Google Gemini</option><option value="fal">fal.ai</option></select>
          <input list="im-models" value={im.model} onChange={e => set({ imageModel: { ...im, model: e.target.value } })} aria-label="Model" />
          <datalist id="im-models">{IMAGE_MODEL_SUGGESTIONS[im.provider].map(m => <option key={m} value={m} />)}</datalist>
          {im.provider === 'openai' && <select value={im.quality} onChange={e => set({ imageModel: { ...im, quality: e.target.value as any } })}><option>low</option><option>medium</option><option>high</option></select>}
        </div>
        <details><summary>Optional: let an LLM write richer prompts</summary>
          <div className="row">
            <select value={llm?.provider ?? ''} onChange={e => set({ llm: e.target.value ? { provider: e.target.value as any, model: LLM_SUGGESTIONS[e.target.value as 'openai'][0] } : null })}><option value="">Off (templates only)</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option><option value="openrouter">OpenRouter</option></select>
            {llm && <input list="llm-models" value={llm.model} onChange={e => set({ llm: { ...llm, model: e.target.value } })} aria-label="LLM model" />}
            {llm && <datalist id="llm-models">{LLM_SUGGESTIONS[llm.provider].map(m => <option key={m} value={m} />)}</datalist>}
          </div>
          <button disabled={!llm || busy} onClick={run(A.polish)}>Rewrite prompts</button>
        </details>
        <div className="row"><button className="primary" disabled={busy} onClick={run(() => A.generateAll())}>Generate {p.scenes.length - done} scenes</button><span className="count">{done}/{p.scenes.length} ready</span></div>
        <ul className="scenes">{p.scenes.map(sc => (
          <li key={sc.id} className={`scene ${sc.status}`}>
            <div className="scene-img">{blobs[sc.id] ? <img src={URL.createObjectURL(blobs[sc.id])} alt={`Scene ${sc.id}`} /> : <span>{sc.status === 'generating' ? 'Generating…' : sc.id}</span>}</div>
            <textarea rows={4} value={sc.prompt} onChange={e => update(p => { p.scenes.find(s => s.id === sc.id)!.prompt = e.target.value; })} aria-label={`Prompt for ${sc.id}`} />
            <div className="row small">
              <label className="check"><input type="checkbox" checked={sc.withAvatar} onChange={e => update(p => { p.scenes.find(s => s.id === sc.id)!.withAvatar = e.target.checked; })} />Artist in shot</label>
              {locs.length > 0 && <select value={sc.refIds.find(r => locs.some(l => l.id === r)) ?? ''} onChange={e => update(p => { const s = p.scenes.find(s => s.id === sc.id)!; s.refIds = [...s.refIds.filter(r => !locs.some(l => l.id === r)), ...(e.target.value ? [e.target.value] : [])]; })}><option value="">No location photo</option>{locs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select>}
              <button disabled={sc.status === 'generating'} onClick={() => A.generateScene(sc.id)}>{sc.status === 'done' ? 'Regenerate' : 'Generate'}</button>
              <label className="btn">Upload<input type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && A.addAsset(e.target.files[0], 'image', sc.id, sc.id).then(() => update(p => { p.scenes.find(s => s.id === sc.id)!.status = 'done'; }))} /></label>
            </div>
            {sc.error && <p className="err">{sc.error}</p>}
          </li>))}</ul>
      </>}
    </section>
  );
}

// ---------------- Edit ----------------
export function EditPanel({ seek }: { seek: (t: number) => void }) {
  const p = useStore(s => s.project), update = useStore(s => s.update), time = useStore(s => s.time);
  const idx = p.shots.findIndex(s => time >= s.from && time < s.to); const s: Shot | undefined = p.shots[idx];
  const U = (fn: (s: Shot) => void) => update(p => fn(p.shots[idx]));
  const ids = [...new Set([...p.scenes.map(s => s.id), ...p.assets.filter(a => a.kind !== 'avatar').map(a => a.id)])];
  return (
    <section className="panel">
      <h2>Edit</h2>
      <p className="note">Scrub the timeline to pick a shot. Cuts are already placed on the beat.</p>
      <div className="row"><button onClick={() => update(p => { const i = p.shots.findIndex(s => time > s.from + 0.1 && time < s.to - 0.1); if (i < 0) return; const a = p.shots[i]; const b = { ...a, from: +time.toFixed(3) }; a.to = b.from; p.shots.splice(i + 1, 0, b); })}>Split at playhead</button>
        <button disabled={idx <= 0} onClick={() => update(p => { const a = p.shots[idx - 1]; a.to = p.shots[idx].to; p.shots.splice(idx, 1); })}>Merge with previous</button></div>
      {s && <div className="shot-edit">
        <p><button className="t" onClick={() => seek(s.from)}>{fmt(s.from)}</button> → {fmt(s.to)} · shot {idx + 1} of {p.shots.length}</p>
        <Field label="Image"><select value={s.img} onChange={e => U(s => { s.img = e.target.value; })}><option value="">Card</option>{ids.map(i => <option key={i}>{i}</option>)}</select></Field>
        <Field label={`Zoom ${s.z0.toFixed(2)} → ${s.z1.toFixed(2)}`}><div className="row"><input type="range" min={1} max={1.5} step={0.01} value={s.z0} onChange={e => U(s => { s.z0 = +e.target.value; })} /><input type="range" min={1} max={1.5} step={0.01} value={s.z1} onChange={e => U(s => { s.z1 = +e.target.value; })} /></div></Field>
        <Field label={`Pan ${s.x0} → ${s.x1}`}><div className="row"><input type="range" min={-6} max={6} step={0.5} value={s.x0} onChange={e => U(s => { s.x0 = +e.target.value; })} /><input type="range" min={-6} max={6} step={0.5} value={s.x1} onChange={e => U(s => { s.x1 = +e.target.value; })} /></div></Field>
        <Field label="Location caption"><input value={s.caption ?? ''} onChange={e => U(s => { s.caption = e.target.value || undefined; })} placeholder="BAY VIEW" /></Field>
        <div className="checks"><label className="check"><input type="checkbox" checked={!!s.drop} onChange={e => U(s => { s.drop = e.target.checked || undefined; })} />Drop punch</label><label className="check"><input type="checkbox" checked={!!s.whip} onChange={e => U(s => { s.whip = e.target.checked || undefined; })} />Whip in</label><label className="check"><input type="checkbox" checked={!!s.flash} onChange={e => U(s => { s.flash = e.target.checked || undefined; })} />Flash</label></div>
      </div>}
    </section>
  );
}

// ---------------- Export ----------------
export function ExportPanel() {
  const p = useStore(s => s.project), images = useStore(s => s.images), audio = useStore(s => s.audioBuffer);
  const [res, setRes] = useState(1080); const [q, setQ] = useState<'high' | 'very-high'>('very-high');
  const [prog, setProg] = useState<number | null>(null); const [url, setUrl] = useState<string | null>(null); const [ext, setExt] = useState('mp4'); const ac = useRef<AbortController | null>(null);
  const vertical = p.height > p.width, long = Math.round((res * 16) / 9 / 2) * 2;
  const W = vertical ? res : long, H = vertical ? long : res;
  const missing = p.scenes.filter(s => s.status !== 'done').length;
  const go = run(async () => {
    if (!audio) throw new Error('Load the song first.');
    if (!('VideoEncoder' in window)) throw new Error('This browser cannot encode video. Use Chrome or Edge, or the command-line renderer.');
    ac.current = new AbortController(); setUrl(null); setProg(0);
    try {
      const out = await exportVideo(p, images, audio, { width: W, height: H, quality: q, onProgress: x => setProg(x), signal: ac.current.signal });
      setExt(out.ext); setUrl(URL.createObjectURL(out.blob));
    } finally { setProg(null); }
  });
  const file = `${p.meta.artist ? p.meta.artist + ' - ' : ''}${p.meta.title}`.replace(/[\\/:*?"<>|]/g, '');
  return (
    <section className="panel">
      <h2>Export</h2>
      {missing > 0 && <p className="note">{missing} scenes have no image yet. Those shots render as dark plates.</p>}
      <Field label="Resolution"><div className="seg">{[720, 1080, 1440].map(r => <button key={r} aria-pressed={res === r} onClick={() => setRes(r)}>{r}p</button>)}</div></Field>
      <Field label="Quality"><div className="seg"><button aria-pressed={q === 'high'} onClick={() => setQ('high')}>Smaller file</button><button aria-pressed={q === 'very-high'} onClick={() => setQ('very-high')}>Best</button></div></Field>
      {prog === null ? <button className="primary" disabled={!p.shots.length} onClick={go}>Export video ({W}×{H})</button>
        : <div className="progress"><div style={{ width: `${prog * 100}%` }} /><span>{Math.round(prog * 100)}%</span><button onClick={() => ac.current?.abort()}>Cancel</button></div>}
      {url && <a className="primary btn" href={url} download={`${file}.${ext}`}>Download {file}.{ext}</a>}
      {url && ext === 'webm' && <p className="note">This browser has no H.264 encoder, so the video is WebM. Chrome, Edge and Safari export MP4.</p>}
      <h3>Project file</h3>
      <p className="note">Saves the edit, timing, look and images in one file. Open it on another computer, or render it from the command line.</p>
      <div className="row"><button onClick={run(async () => { const b = await A.exportProjectFile(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = `${file}.beatframe.json`; a.click(); })}>Download project</button>
        <label className="btn">Open project<input type="file" accept=".json" hidden onChange={e => e.target.files?.[0] && A.importProjectFile(e.target.files[0])} /></label></div>
      <pre className="cli">npx beatframe render "{file}.beatframe.json" --audio song.mp3 --out video.mp4</pre>
    </section>
  );
}

export const STEPS: { id: Step; label: string }[] = [
  { id: 'song', label: 'Song' }, { id: 'words', label: 'Lyrics' }, { id: 'look', label: 'Look' }, { id: 'cast', label: 'Cast' },
  { id: 'scenes', label: 'Scenes' }, { id: 'edit', label: 'Edit' }, { id: 'export', label: 'Export' },
];
