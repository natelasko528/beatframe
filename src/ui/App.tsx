import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { Preview } from './Preview';
import { Timeline } from './Timeline';
import { SongPanel, WordsPanel, LookPanel, CastPanel, ScenesPanel, EditPanel, ExportPanel, STEPS } from './panels';
import * as K from '../providers/keys';
import * as A from '../pipeline';
import { Gate } from './Gate';

function Settings({ close }: { close: () => void }) {
  const keys = useStore(s => s.keys), set = useStore(s => s.set);
  const [draft, setDraft] = useState(keys); const [remember, setRemember] = useState(true); const [pass, setPass] = useState('');
  const k = (id: K.ProviderId, label: string, hint: string) => (
    <label className="field"><span className="field-label">{label}</span>
      <input type="password" autoComplete="off" value={draft.keys[id] ?? ''} onChange={e => setDraft({ ...draft, keys: { ...draft.keys, [id]: e.target.value.trim() } })} placeholder="Not set" /><small>{hint}</small></label>);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="keys-title" onKeyDown={e => e.key === 'Escape' && close()}>
      <div className="sheet">
        <h2 id="keys-title">Your API keys</h2>
        <p className="note">Keys stay in this browser and are sent only to the provider you choose. Nothing is stored on our servers.</p>
        {k('openai', 'OpenAI', 'Images (gpt-image) and Whisper timing.')}
        {k('gemini', 'Google Gemini', 'Images (Nano Banana) and prompt writing.')}
        {k('fal', 'fal.ai', 'Images (FLUX Kontext, Nano Banana edit).')}
        {k('anthropic', 'Anthropic', 'Optional prompt writing.')}
        {k('openrouter', 'OpenRouter', 'Optional prompt writing with any model.')}
        <label className="field"><span className="field-label">OpenAI-compatible base URL</span><input value={draft.openaiBase} onChange={e => setDraft({ ...draft, openaiBase: e.target.value })} /><small>Change this to use Azure OpenAI or another compatible gateway.</small></label>
        <label className="check"><input type="checkbox" checked={draft.useProxy} onChange={e => setDraft({ ...draft, useProxy: e.target.checked })} />Route requests through this site's pass-through proxy (only if a provider blocks browser requests)</label>
        <label className="check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />Remember on this device</label>
        <label className="field"><span className="field-label">Lock with a passphrase (optional)</span><input type="password" value={pass} onChange={e => setPass(e.target.value)} /><small>Encrypts the saved keys. You will enter it once per visit.</small></label>
        <div className="row">
          <button className="primary" onClick={async () => { await K.save(draft, { remember, passphrase: pass || undefined }); set({ keys: draft }); close(); }}>Save keys</button>
          <button onClick={() => { K.forget(); set({ keys: K.DEFAULT_KEYS }); close(); }}>Remove all keys</button>
          <button onClick={close}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function Unlock({ done }: { done: () => void }) {
  const [pass, setPass] = useState(''); const [err, setErr] = useState('');
  return (
    <div className="modal" role="dialog" aria-modal="true"><form className="sheet" onSubmit={async e => { e.preventDefault(); try { useStore.getState().set({ keys: await K.unlock(pass) }); done(); } catch { setErr('That passphrase did not unlock your keys.'); } }}>
      <h2>Unlock your keys</h2><input type="password" autoFocus value={pass} onChange={e => setPass(e.target.value)} />{err && <p className="err">{err}</p>}
      <div className="row"><button className="primary">Unlock</button><button type="button" onClick={done}>Skip</button></div></form></div>);
}

export function App() {
  const step = useStore(s => s.step), set = useStore(s => s.set), status = useStore(s => s.status), busy = useStore(s => s.busy), audioUrl = useStore(s => s.audioUrl), p = useStore(s => s.project), time = useStore(s => s.time);
  const audio = useRef<HTMLAudioElement>(null); const [showKeys, setShowKeys] = useState(false); const [locked, setLocked] = useState(K.isLocked());
  const [playing, setPlaying] = useState(false);
  useEffect(() => { const k = K.loadPlain(); if (k) set({ keys: k }); A.restore(); }, [set]);
  useEffect(() => A.autosave(), [p]);
  const seek = (t: number) => { set({ time: t }); if (audio.current) audio.current.currentTime = t; };
  const toggle = () => { const a = audio.current; if (!a) return; if (a.paused) { a.currentTime = useStore.getState().time; a.play(); } else a.pause(); };
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.code === 'Space' && !(e.target as HTMLElement).closest('input,textarea,select,button,[role=dialog]') && step !== 'words') { e.preventDefault(); toggle(); } }; window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); });
  const done: Record<string, boolean> = { song: !!p.analysis, words: p.lines.length > 0, look: true, cast: p.avatar.refIds.length > 0, scenes: p.scenes.length > 0 && p.scenes.every(s => s.status === 'done'), edit: p.shots.length > 0, export: false };
  return (
    <Gate>
      <div className="app">
        <header className="bar">
          <span className="brand">BeatFrame</span>
          <input className="title" value={p.meta.title} onChange={e => useStore.getState().update(p => { p.meta.title = e.target.value; })} aria-label="Project title" />
          <span className={`status ${busy ? 'is-busy' : ''}`} role="status">{status}</span>
          <button onClick={() => setShowKeys(true)}>API keys</button>
          <button onClick={() => confirm('Start a new project? The current one is cleared from this browser.') && A.resetProject()}>New</button>
        </header>
        <nav className="steps" aria-label="Steps">
          <ol>{STEPS.map((s, i) => <li key={s.id}><button aria-current={step === s.id ? 'step' : undefined} className={done[s.id] ? 'is-done' : ''} onClick={() => set({ step: s.id })}><span className="n">{i + 1}</span>{s.label}</button></li>)}</ol>
        </nav>
        <main className="stage">
          <Preview audioRef={audio} />
          <div className="transport">
            <button className="play" onClick={toggle} disabled={!audioUrl} aria-label={playing ? 'Pause' : 'Play'}>{playing ? 'Pause' : 'Play'}</button>
            <span className="clock">{Math.floor(time / 60)}:{(time % 60).toFixed(1).padStart(4, '0')}</span>
            {audioUrl && <audio ref={audio} src={audioUrl} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} preload="auto" />}
          </div>
        </main>
        <aside className="inspector">
          {step === 'song' && <SongPanel />}{step === 'words' && <WordsPanel seek={seek} audio={audio} />}{step === 'look' && <LookPanel />}
          {step === 'cast' && <CastPanel />}{step === 'scenes' && <ScenesPanel />}{step === 'edit' && <EditPanel seek={seek} />}{step === 'export' && <ExportPanel />}
        </aside>
        <footer className="tl"><Timeline seek={seek} /></footer>
        {showKeys && <Settings close={() => setShowKeys(false)} />}
        {locked && <Unlock done={() => setLocked(false)} />}
      </div>
    </Gate>
  );
}
