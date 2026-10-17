-- BeatFrame access control. Run in the Supabase SQL editor.
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer text, stripe_subscription text,
  status text not null default 'inactive',
  current_period_end timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.subscriptions enable row level security;
create policy "read own subscription" on public.subscriptions for select using (auth.uid() = user_id);
-- writes only via the service role (Stripe webhook)
