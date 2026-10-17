// Optional paywall. Off by default (self-hosted / personal use). Turn it on with VITE_GATE=supabase plus
// VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY and VITE_STRIPE_PRICE_ID. Access = an active row in public.subscriptions.
import { useEffect, useState } from 'react';
import { createClient, type Session } from '@supabase/supabase-js';

const GATE = import.meta.env.VITE_GATE === 'supabase';
const sb = GATE ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY) : null;

export function Gate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null); const [active, setActive] = useState<boolean | null>(GATE ? null : true);
  const [email, setEmail] = useState(''); const [sent, setSent] = useState(false); const [err, setErr] = useState('');
  useEffect(() => {
    if (!sb) return;
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setSession(s)); return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!sb || !session) return;
    sb.from('subscriptions').select('status,current_period_end').eq('user_id', session.user.id).maybeSingle()
      .then(({ data }) => setActive(!!data && ['active', 'trialing'].includes(data.status) && new Date(data.current_period_end) > new Date()));
  }, [session]);
  if (!GATE || active) return <>{children}</>;
  return (
    <div className="gate">
      <div className="sheet">
        <h1 className="brand-big">BeatFrame</h1>
        <p className="lede">Turn a song into a finished lyric music video, cut on the beat, in your browser.</p>
        {!session ? (sent ? <p>Check {email} for your sign-in link.</p> :
          <form onSubmit={async e => { e.preventDefault(); const { error } = await sb!.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin } }); if (error) setErr(error.message); else setSent(true); }}>
            <label className="field"><span className="field-label">Email</span><input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
            <button className="primary">Email me a sign-in link</button>{err && <p className="err">{err}</p>}
          </form>)
          : active === null ? <p>Checking your plan…</p>
          : <div><p>Signed in as {session.user.email}. Start a plan to open the studio.</p>
            <button className="primary" onClick={async () => { const r = await fetch('/api/checkout', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } }); const j = await r.json(); if (j.url) location.href = j.url; else setErr(j.error || 'Checkout failed'); }}>Subscribe</button>
            <button onClick={() => sb!.auth.signOut()}>Sign out</button>{err && <p className="err">{err}</p>}</div>}
      </div>
    </div>
  );
}
