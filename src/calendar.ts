import { Temporal } from '@js-temporal/polyfill';
export type Event = { id: string; summary?: string; status?: string; start: {dateTime?: string; date?: string}; end: {dateTime?: string; date?: string}; attendees?: {self?: boolean; responseStatus?: string}[] };
export type Settings = { zone: string; name: string; lead: number; reminder: number };
export type Job = { key: string; due: number; expires: number; text: string };
export const dayAt = (day: string, hour: number, zone: string) => Temporal.PlainDate.from(day).toZonedDateTime({timeZone: zone, plainTime: `${String(hour).padStart(2,'0')}:00`}).epochMilliseconds;
export const dateAt = (now: number, zone: string) => Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(zone).toPlainDate().toString();
export const addDays = (day: string, days: number) => Temporal.PlainDate.from(day).add({days}).toString();
const start = (e: Event, zone: string) => e.start.dateTime ? Date.parse(e.start.dateTime) : dayAt(e.start.date!, 0, zone);
const end = (e: Event, zone: string) => e.end.dateTime ? Date.parse(e.end.dateTime) : dayAt(e.end.date!, 0, zone);
export function jobs(events: Event[], now: number, cfg: Settings): Job[] {
  const today = dateAt(now, cfg.zone);
  const active = events.filter(e => e.status !== 'cancelled' && !e.attendees?.some(a => a.self && a.responseStatus === 'declined'));
  const time = (n: number) => new Intl.DateTimeFormat('en-US', {timeZone: cfg.zone, hour:'numeric', minute:'2-digit'}).format(n);
  const result: Job[] = [];
  for (const day of [today, addDays(today, 1)]) {
    const lo = dayAt(day, 0, cfg.zone), hi = dayAt(addDays(day, 1), 0, cfg.zone);
    const daily = active.filter(e => start(e,cfg.zone) < hi && end(e,cfg.zone) > lo).sort((a,b) => start(a,cfg.zone)-start(b,cfg.zone));
    const first = daily.find(e => e.start.dateTime && start(e,cfg.zone) >= lo);
    const due = first ? start(first,cfg.zone)-cfg.lead*60_000 : dayAt(day,9,cfg.zone);
    const remaining = daily.filter(e => end(e,cfg.zone)>now);
    const greeting = day > today ? `Here’s your schedule for tomorrow, ${cfg.name}!` : `Good morning, ${cfg.name}!`;
    const details = remaining.map(e => `${e.summary || 'Untitled event'}${e.start.date ? ' (all day)' : ` at ${time(start(e,cfg.zone))}`}`).join('; ');
    result.push({key:`summary:${day}`,due,expires:Math.max(dayAt(day,12,cfg.zone),due+60_000),text:`${greeting} ${details ? `You have ${details}${day>today?' tomorrow':' today'}.` : daily.length ? 'You have no more events today.' : 'You have no events today.'}`});
  }
  for (const e of active.filter(e=>e.start.dateTime)) {
    const at = start(e,cfg.zone);
    result.push({key:`reminder:primary:${e.id}:${at}`,due:at-cfg.reminder*60_000,expires:at,text:`Just a reminder you have ${e.summary || 'Untitled event'} in ${Math.max(1,Math.ceil((at-now)/60_000))} minutes.`});
  }
  return result;
}
export class ApiError extends Error { constructor(public status: number) { super(`Google API HTTP ${status}`); } }
export async function fetchEvents(env: NodeJS.ProcessEnv, now: number, zone: string, days = 2): Promise<Event[]> {
  const token = await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID!,client_secret:env.GOOGLE_CLIENT_SECRET!,refresh_token:env.GOOGLE_REFRESH_TOKEN!,grant_type:'refresh_token'}),signal:AbortSignal.timeout(20_000)});
  if (!token.ok) throw new ApiError(token.status);
  const auth = await token.json() as {access_token:string};
  const today=dateAt(now,zone); const events:Event[]=[]; let page='';
  do {
    const query=new URLSearchParams({timeMin:new Date(dayAt(today,0,zone)).toISOString(),timeMax:new Date(dayAt(addDays(today,days),0,zone)).toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'2500',...(page?{pageToken:page}:{})});
    const response=await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${query}`,{headers:{Authorization:`Bearer ${auth.access_token}`},signal:AbortSignal.timeout(20_000)});
    if(!response.ok) throw new ApiError(response.status);
    const data=await response.json() as {items?:Event[];nextPageToken?:string}; events.push(...data.items??[]);page=data.nextPageToken??'';
  } while(page);
  return events;
}
