import { addDays, dateAt, dayAt, type Event } from './calendar.ts';
export type Intent = 'next' | 'remaining' | 'today' | 'help';
export function intent(text:string):Intent {
 const q=text.toLowerCase().replace(/[’']/g,'').replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
 if(/\b(tomorrow|yesterday|week|month)\b/.test(q)) return 'help';
 if(/^(whats |what is )?next$/.test(q)) return 'next';
 if(/\bnext\b/.test(q)&&/\b(event|meeting|appointment|up|on)\b/.test(q)) return 'next';
 if(/\b(else|left|remaining|rest)\b/.test(q)&&/\b(today|day|have|schedule|events)\b/.test(q)) return 'remaining';
 if(/\b(today|day|agenda|schedule)\b/.test(q)) return 'today';
 return 'help';
}
export const help='Ask me “What’s my next event?”, “What else do I have today?”, or “What’s my schedule today?”';
export function answer(kind:Intent,events:Event[],now:number,zone:string):string {
 if(kind==='help') return help;
 const date=dateAt(now,zone),lo=dayAt(date,0,zone),hi=dayAt(addDays(date,1),0,zone);
 const start=(e:Event)=>e.start.dateTime?Date.parse(e.start.dateTime):dayAt(e.start.date!,0,zone);
 const end=(e:Event)=>e.end.dateTime?Date.parse(e.end.dateTime):dayAt(e.end.date!,0,zone);
 const active=events.filter(e=>e.status!=='cancelled'&&!e.attendees?.some(a=>a.self&&a.responseStatus==='declined')).sort((a,b)=>start(a)-start(b));
 const time=(n:number)=>new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(n);
 const title=(e:Event)=>e.summary||'Untitled event';
 if(kind==='next') {
   const next=active.find(e=>e.start.dateTime&&start(e)>=now);
   if(!next) return 'You have no upcoming timed events in the next 30 days.';
   const when=dateAt(start(next),zone)===date?'today':new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'long',month:'short',day:'numeric'}).format(start(next));
   return `Your next event is ${title(next)}, ${when} at ${time(start(next))}.`;
 }
 const daily=active.filter(e=>start(e)<hi&&end(e)>lo&&(kind==='today'||end(e)>now));
 if(!daily.length) return kind==='remaining'?'You have no more events today.':'You have no events today.';
 return `${kind==='remaining'?'Here’s what’s left today':'Here’s your day'}:\n`+daily.map(e=>`• ${title(e)} — ${e.start.date?'all day':time(start(e))}${!e.start.date&&start(e)<=now&&end(e)>now?' (happening now)':''}`).join('\n');
}
export function allowed(sender:string|undefined,recipient:string,direction:string,spaceType:string):boolean {
 const phone=(value:string)=>value.replace(/[\s().-]/g,'');
 return direction==='inbound'&&spaceType==='dm'&&!!sender&&phone(sender)===phone(recipient);
}
