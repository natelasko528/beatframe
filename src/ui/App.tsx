import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import * as K from '../providers/keys';
import * as A from '../pipeline';
import { defaultAi } from '../providers/ai';
import { Gate } from './Gate';
import { Start } from './Start';
import { Producing } from './Producing';
import { Studio } from './Studio';

function Unlock({ done }: { done: () => void }) {
  const [pass, setPass] = useState(''); const [err, setErr] = useState('');
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="unlock-t"><form className="sheet" onSubmit={async e => { e.preventDefault(); try { const k = await K.unlock(pass); useStore.getState().set({ keys: k, ai: defaultAi(k.keys) }); done(); } catch { setErr('That passphrase did not unlock your keys.'); } }}>
      <h2 id="unlock-t">Unlock your keys</h2><input type="password" autoFocus value={pass} onChange={e => setPass(e.target.value)} />{err && <p className="err">{err}</p>}
      <div className="row"><button className="primary">Unlock</button><button type="button" onClick={done}>Skip</button></div></form></div>);
}

export function App() {
  const screen = useStore(s => s.screen), set = useStore(s => s.set), audioUrl = useStore(s => s.audioUrl), p = useStore(s => s.project);
  const audio = useRef<HTMLAudioElement>(null); const [locked, setLocked] = useState(K.isLocked()); const [playing, setPlaying] = useState(false);
  useEffect(() => { const k = K.loadPlain(); if (k) set({ keys: k, ai: defaultAi(k.keys) }); A.restore(); }, [set]);
  useEffect(() => { if (screen === 'studio') A.autosave(); }, [p, screen]);
  const seek = (t: number) => { set({ time: t }); if (audio.current) audio.current.currentTime = t; };
  const toggle = () => { const a = audio.current; if (!a) return; if (a.paused) { a.currentTime = useStore.getState().time; a.play(); } else a.pause(); };
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (screen === 'studio' && e.code === 'Space' && !(e.target as HTMLElement).closest('input,textarea,select,button,[role=dialog]')) { e.preventDefault(); toggle(); } };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  });
  return (
    <Gate>
      {screen === 'start' && <Start />}
      {screen === 'producing' && <Producing />}
      {screen === 'studio' && <Studio audio={audio} seek={seek} toggle={toggle} playing={playing} />}
      {audioUrl && <audio ref={audio} src={audioUrl} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} preload="auto" />}
      {locked && <Unlock done={() => setLocked(false)} />}
    </Gate>
  );
}
