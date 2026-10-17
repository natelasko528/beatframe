// Keeps public.subscriptions in sync with Stripe. Point a Stripe webhook at /api/stripe-webhook.
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
export const config = { api: { bodyParser: false } };
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const raw = (req: any) => new Promise<Buffer>((res) => { const c: Buffer[] = []; req.on('data', (d: Buffer) => c.push(d)); req.on('end', () => res(Buffer.concat(c))); });
export default async function handler(req: any, res: any) {
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(await raw(req), req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET!); }
  catch (e: any) { return res.status(400).send(`Webhook error: ${e.message}`); }
  if (event.type.startsWith('customer.subscription.')) {
    const s = event.data.object as Stripe.Subscription; const user_id = s.metadata.user_id;
    const end = (s as any).current_period_end ?? s.items.data[0]?.current_period_end;
    if (user_id) await admin.from('subscriptions').upsert({ user_id, stripe_customer: String(s.customer), stripe_subscription: s.id, status: s.status, current_period_end: new Date(end * 1000).toISOString() });
  }
  res.status(200).json({ received: true });
}
