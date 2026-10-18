import { useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import * as A from '../pipeline';
import * as K from '../providers/keys';
import { AI_MODELS, defaultAi, type AiProvider } from '../providers/ai';
import { detectProvider, PROVIDER_INFO } from './keys';

const BUDGETS = [{ n: 8, label: 'Lean' }, { n: 16, label: 'Standard' }, { n: 30, label: 'Premium' }];

export function Start() {
  const keys = useStore(s => s.keys), opts = useStore(s => s.opts), set = useStore(s => s.set), aiSel = useStore(s => s.ai);
  const [file, setFile] = useState<File | null>(null); const [drag, setDrag] = useState(false);
  const [lyrics, setLyrics] = useState(''); const [photos, setPhotos] = useState<File[]>([]);
  const [artist, setArtist] = useState(''); const [title, setTitle] = useState(''); const [notes, setNotes] = useState('');
  const [vertical, setVertical] = useState(false); const [more, setMore] = useState(false);
  const [keyInput, setKeyInput] = useState(''); const [keyErr, setKeyErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const ai = aiSel ?? defaultAi(keys.keys);
  const im = A.pickImageModel(ai, keys.keys as any);
  const est = A.estimate(opts.budget, ai, im, opts.checkImages);
  const haveKeys = Object.entries(keys.keys).filter(([, v]) => v) as [K.ProviderId, string][];

  const addKey = async () => {
    const p = detectProvider(keyInput); if (!p) { setKeyErr("That doesn't look like a Claude, OpenAI, Gemini, OpenRouter or fal key."); return; }
    const next = { ...keys, keys: { ...keys.keys, [p]: keyInput.trim() } };
    set({ keys: next, ai: aiSel ?? defaultAi(next.keys) }); await K.save(next, { remember: true }); setKeyInput(''); setKeyErr('');
  };
  const removeKey = async (p: K.ProviderId) => { const next = { ...keys, keys: { ...keys.keys, [p]: undefined } }; set({ keys: next, ai: aiSel?.provider === p ? defaultAi(next.keys) : aiSel }); await K.save(next, { remember: true }); };
  const onFile = (f?: File | null) => { if (f && /audio|video\/mp4|\.m4a$|\.mp3$|\.wav$/i.test(f.type + f.name)) { setFile(f); if (!title) setTitle(''); } };
  const go = () => file && A.autoCreate({ file, lyrics, photos, title, artist, notes, vertical });
  const needsImageKey = ai && !PROVIDER_INFO[ai.provider].images && !im;
  const photoUrls = useMemo(() => photos.map(p => URL.createObjectURL(p)), [photos]);

  return (
    <main className="start">
      <section className="start-hero">
        <p className="brand">BeatFrame</p>
        <h1>Drop a song.<br />Get a music video.</h1>
        <p className="lede">BeatFrame hears the beat, times every word and cuts on the downbeat for free. Your AI reads the lyrics, directs the look and writes every scene. You stay in the director's chair.</p>
        <ol className="how">
          <li><b>Code does the work.</b> Beat, tempo, key, lyric timing, the edit, motion and the final render run on your device.</li>
          <li><b>Your AI does the ideas.</b> Concept, colours, type and a scene for every moment, from your song's own words.</li>
          <li><b>You get the last word.</b> Every suggestion can be changed, reworded or regenerated.</li>
        </ol>
      </section>

      <section className="start-card" aria-label="New video">
        <div className={`drop ${drag ? 'is-drag' : ''} ${file ? 'has-file' : ''}`}
          onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current?.click()} role="button" tabIndex={0} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && fileRef.current?.click()}>
          <input ref={fileRef} type="file" accept="audio/*,.m4a,.mp3,.wav" hidden onChange={e => onFile(e.target.files?.[0])} />
          <svg className="drop-wave" viewBox="0 0 120 32" aria-hidden="true">{Array.from({ length: 30 }, (_, i) => { const h = 6 + Math.abs(Math.sin(i * 1.7) * 22) * (i % 5 === 0 ? 1 : 0.6); return <rect key={i} x={i * 4} y={16 - h / 2} width="2" height={h} rx="1" />; })}</svg>
          {file ? <><strong>{file.name}</strong><span>Ready · {(file.size / 1e6).toFixed(1)} MB · click to change</span></>
            : <><strong>Drop your song here</strong><span>MP3, WAV or M4A, any genre</span></>}
        </div>

        <div className="row2">
          <label className="field"><span>Artist</span><input value={artist} onChange={e => setArtist(e.target.value)} placeholder="Optional" /></label>
          <label className="field"><span>Song title</span><input value={title} onChange={e => setTitle(e.target.value)} placeholder={file ? 'From the file name' : 'Optional'} /></label>
        </div>

        <div className="field">
          <span>Artist photos <em>for a consistent face in every scene</em></span>
          <div className="photos">
            {photoUrls.map((u, i) => <figure key={u}><img src={u} alt={`Artist photo ${i + 1}`} /><button aria-label="Remove photo" onClick={() => setPhotos(photos.filter((_, k) => k !== i))}>×</button></figure>)}
            {photos.length < 4 && <label className="photo-add"><input type="file" accept="image/*" multiple hidden onChange={e => setPhotos([...photos, ...Array.from(e.target.files ?? [])].slice(0, 4))} />+ Add</label>}
          </div>
        </div>

        <button className="disclose" aria-expanded={more} onClick={() => setMore(!more)}>{more ? '−' : '+'} Lyrics, direction notes and format</button>
        {more && <div className="more">
          <label className="field"><span>Official lyrics <em>optional · improves spelling; [Hook] / [Verse] tags help</em></span><textarea rows={6} value={lyrics} onChange={e => setLyrics(e.target.value)} placeholder="Leave empty and BeatFrame transcribes the vocal" /></label>
          <label className="field"><span>Notes for the director <em>optional</em></span><textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. shot in my hometown, 90s VHS feel, no cars" /></label>
          <div className="field"><span>Format</span><div className="seg"><button aria-pressed={!vertical} onClick={() => setVertical(false)}>16:9 · YouTube</button><button aria-pressed={vertical} onClick={() => setVertical(true)}>9:16 · Reels, TikTok</button></div></div>
        </div>}

        <div className="ai-box">
          <div className="ai-head"><span>Your AI</span>{haveKeys.length > 0 && ai && (
            <select value={`${ai.provider}|${ai.model}`} onChange={e => { const [pr, md] = e.target.value.split('|'); set({ ai: { provider: pr as AiProvider, model: md } }); }} aria-label="AI model">
              {haveKeys.filter(([p]) => p !== 'fal').flatMap(([p]) => AI_MODELS[p as AiProvider].models.map(m => <option key={p + m} value={`${p}|${m}`}>{AI_MODELS[p as AiProvider].label} · {m}</option>))}
            </select>)}</div>
          {haveKeys.map(([p]) => <div className="key-chip" key={p}><span>{PROVIDER_INFO[p].name}</span><code>••••{keys.keys[p]!.slice(-4)}</code><button onClick={() => removeKey(p)} aria-label={`Remove ${PROVIDER_INFO[p].name} key`}>Remove</button></div>)}
          <div className="key-add">
            <input type="password" autoComplete="off" value={keyInput} onChange={e => setKeyInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addKey()} placeholder={haveKeys.length ? 'Add another key' : 'Paste a Claude, ChatGPT or Gemini API key'} aria-label="API key" />
            <button onClick={addKey} disabled={!keyInput}>Add</button>
          </div>
          {keyErr && <p className="err">{keyErr}</p>}
          <p className="fine">Keys stay in this browser and go only to that provider. No key yet? <a href={PROVIDER_INFO.gemini.getKey} target="_blank" rel="noreferrer">Gemini has a free tier</a>, or use <a href={PROVIDER_INFO.anthropic.getKey} target="_blank" rel="noreferrer">Claude</a> or <a href={PROVIDER_INFO.openai.getKey} target="_blank" rel="noreferrer">OpenAI</a>.</p>
          {needsImageKey && <p className="warn">{PROVIDER_INFO[ai!.provider].name} directs, but it can't paint. Add an OpenAI, Gemini or fal key for the scene images, or upload your own images later.</p>}
        </div>

        <div className="budget">
          <div className="seg" role="radiogroup" aria-label="Scene budget">{BUDGETS.map(b => <button key={b.n} role="radio" aria-checked={opts.budget === b.n} aria-pressed={opts.budget === b.n} onClick={() => set({ opts: { ...opts, budget: b.n } })}><b>{b.label}</b><small>{b.n} scenes</small></button>)}</div>
          <p className="estimate">{ai || im ? <>About <b>${est.total.toFixed(2)}</b> for this video{im ? <> · images ${est.images.toFixed(2)}</> : null}{ai ? <> · AI ${est.ai.toFixed(2)}</> : null}</> : 'Free without a key: beat, timing and edit run in code. You add the images.'}</p>
        </div>

        <button className="cta" disabled={!file} onClick={go}>Make my video</button>
      </section>
    </main>
  );
}
