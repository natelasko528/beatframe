// Creates a Stripe Checkout session for the signed-in Supabase user.
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).end();
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const { data: { user } } = await admin.auth.getUser(token);
  if (!user) return res.status(401).json({ error: 'Sign in first' });
  const origin = req.headers.origin || `https://${req.headers.host}`;
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription', line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
    customer_email: user.email!, client_reference_id: user.id, allow_promotion_codes: true,
    success_url: `${origin}/?subscribed=1`, cancel_url: `${origin}/`, subscription_data: { metadata: { user_id: user.id } },
  });
  res.status(200).json({ url: session.url });
}
