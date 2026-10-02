-- سجل أحداث اختبار جدوى الصوت المباشر (docs/live-test/): كل جهاز يرسل أحداثه (اتصال، انقطاع، قفل، عودة، حكم المختبِر).
-- إدراج فقط لـ anon وفي غرفة live-lab فقط، بلا قراءة؛ التحليل بـ SQL من لوحة المشروع. يُحذف بعد انتهاء التجربة.
create table public.aiws_live_probe (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  t_client  timestamptz,
  room      text not null check (room = 'live-lab'),
  device    text not null check (device ~ '^[a-z0-9]{6,32}$'),
  role      text not null check (role in ('listener', 'presenter')),
  label     text check (char_length(label) <= 40),
  variant   text check (variant in ('plain', 'session', 'hls')),
  ev        text not null check (ev ~ '^[a-z_]{1,32}$'),
  detail    jsonb check (pg_column_size(detail) <= 2000),
  ua        text check (char_length(ua) <= 400)
);
create index aiws_live_probe_device_at on public.aiws_live_probe (device, at);

alter table public.aiws_live_probe enable row level security;
revoke all on table public.aiws_live_probe from anon, authenticated;
grant insert on table public.aiws_live_probe to anon;
create policy aiws_live_probe_insert on public.aiws_live_probe for insert to anon with check (room = 'live-lab');
