import test from 'node:test';
import assert from 'node:assert/strict';
import { jobs, dayAt, fetchEvents, type Event } from '../src/calendar.ts';
import { Store } from '../src/store.ts';
const cfg={zone:'America/Los_Angeles',name:'Aryan',lead:120,reminder:30};
const event=(id='one',at='2026-10-16T10:00:00-07:00'):Event=>({id,summary:'Standup',start:{dateTime:at},end:{dateTime:new Date(Date.parse(at)+3600000).toISOString()}});
const now=Date.parse('2026-10-16T08:00:00-07:00');
test('summary two hours before first event and reminder thirty minutes before',()=>{
 const all=jobs([event()],now,cfg);assert.equal(all[0]!.due,now);assert.match(all[0]!.text,/Good morning, Aryan.*10:00 AM/);
 const r=all.find(j=>j.key.startsWith('reminder'))!;assert.equal(r.due,now+90*60000);assert.match(jobs([event()],r.due,cfg).at(-1)!.text,/30 minutes/);
});
test('early next-day event gets previous-evening wording',()=>{
 const all=jobs([event('early','2026-10-17T01:00:00-07:00')],now,cfg);assert.equal(all[1]!.due,Date.parse('2026-10-16T23:00:00-07:00'));assert.match(all[1]!.text,/schedule for tomorrow/);
});
test('all-day events and empty days use nine AM without reminders',()=>{
 const e:Event={id:'day',summary:'Birthday',start:{date:'2026-10-16'},end:{date:'2026-10-17'}};
 const all=jobs([e],now,cfg);assert.equal(all.length,2);assert.equal(all[0]!.due,now+3600000);assert.match(all[0]!.text,/Birthday \(all day\)/);assert.match(jobs([],now,cfg)[0]!.text,/no events today/);
});
test('cancelled and declined events are excluded; rescheduling changes reminder key',()=>{
 assert.equal(jobs([{...event(),status:'cancelled'},{...event('two'),attendees:[{self:true,responseStatus:'declined'}]}],now,cfg).length,2);
 assert.notEqual(jobs([event()],now,cfg).at(-1)!.key,jobs([event('one','2026-10-16T11:00:00-07:00')],now,cfg).at(-1)!.key);
});
test('DST day boundaries span 23 or 25 hours',()=>{
 assert.equal(dayAt('2026-03-09',0,cfg.zone)-dayAt('2026-03-08',0,cfg.zone),23*3600000);
 assert.equal(dayAt('2026-11-02',0,cfg.zone)-dayAt('2026-11-01',0,cfg.zone),25*3600000);
});
test('late reminders report actual minutes and expire at start',()=>{
 const at=Date.parse(event().start.dateTime!);const r=jobs([event()],at-5*60000,cfg).at(-1)!;assert.match(r.text,/5 minutes/);assert.equal(r.expires,at);
});
test('SQLite suppresses duplicate and ambiguous delivery claims',()=>{
 const store=new Store(':memory:');assert.equal(store.claim('summary:today'),true);store.finish('summary:today','sent');assert.equal(store.claim('summary:today'),false);
 assert.equal(store.claim('reminder:one'),true);store.finish('reminder:one','uncertain');assert.equal(store.has('reminder:one'),true);store.close();
});
test('calendar fetch follows pages and expands recurring occurrences',async()=>{
 const original=globalThis.fetch;const urls:string[]=[];
 globalThis.fetch=async(input)=>{const url=String(input);urls.push(url);return new Response(JSON.stringify(url.includes('oauth2')?{access_token:'fake'}:url.includes('pageToken')?{items:[event('second')]}:{items:[event()],nextPageToken:'next'}),{status:200});};
 try {const result=await fetchEvents({GOOGLE_CLIENT_ID:'fake',GOOGLE_CLIENT_SECRET:'fake',GOOGLE_REFRESH_TOKEN:'fake'},now,cfg.zone);assert.equal(result.length,2);assert.ok(urls[1]!.includes('singleEvents=true'));assert.ok(urls[2]!.includes('pageToken=next'));}finally{globalThis.fetch=original;}
});

test('delivery retries only explicit rejection and does not retry ambiguous sends',async()=>{
 const {deliver}=await import('../src/delivery.ts');const store=new Store(':memory:');let calls=0;
 const job={key:'retry',due:0,expires:Date.now()+60000,text:'Hello'};
 assert.equal(await deliver(job,store,async()=>{if(++calls===1) throw {code:8};},async()=>{}),'sent');assert.equal(calls,2);
 calls=0;assert.equal(await deliver({...job,key:'uncertain'},store,async()=>{calls++;throw new Error('timeout');},async()=>{}),'uncertain');assert.equal(calls,1);
 assert.equal(await deliver({...job,key:'uncertain'},store,async()=>{calls++;}),'duplicate');assert.equal(calls,1);store.close();
});
test('persistent delivery state survives restart including in-flight sends',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const directory=await mkdtemp(`${tmpdir()}/calendar-test-`);
 try {const path=`${directory}/state.sqlite`;const first=new Store(path);first.claim('pending');first.claim('done');first.finish('done','sent');first.close();const second=new Store(path);assert.equal(second.claim('pending'),false);assert.equal(second.claim('done'),false);second.close();}finally{await rm(directory,{recursive:true,force:true});}
});
test('Google failures propagate without returning a false empty calendar',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('{}',{status:401});
 try{await assert.rejects(fetchEvents({},now,cfg.zone),/HTTP 401/);}finally{globalThis.fetch=original;}
});
test('delivery awaits asynchronous persistence before sending',async()=>{
 const {deliver}=await import('../src/delivery.ts');const steps:string[]=[];
 const store={claim:async()=>{await Promise.resolve();steps.push('claim');return true;},has:async()=>false,finish:async()=>{await Promise.resolve();steps.push('finish');},close:async()=>{}};
 assert.equal(await deliver({key:'pg',due:0,expires:Date.now()+60000,text:'Test'},store,async()=>{steps.push('send');}),'sent');assert.deepEqual(steps,['claim','send','finish']);
});
