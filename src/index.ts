import { Spectrum } from 'spectrum-ts';
import { imessage } from '@spectrum-ts/imessage';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fetchEvents, jobs, type Settings } from './calendar.ts';
import { Store } from './store.ts';
import { PostgresStore } from './postgres-store.ts';
import { deliver } from './delivery.ts';
import { intent, answer, allowed, help } from './questions.ts';
const env={...process.env};
if(!env.GOOGLE_REFRESH_TOKEN || env.GOOGLE_REFRESH_TOKEN==='filled-after-authorization') {
  try {env.GOOGLE_REFRESH_TOKEN=(JSON.parse(await readFile('.secrets/google-token.json','utf8')) as {GOOGLE_REFRESH_TOKEN:string}).GOOGLE_REFRESH_TOKEN;}
  catch(error) {if(!(typeof error==='object'&&error!==null&&'code' in error&&error.code==='ENOENT')) throw new Error('Invalid local Google authorization file');}
}
if(!env.RECIPIENT_PHONE) {
  try {env.RECIPIENT_PHONE=(JSON.parse(await readFile('.secrets/recipient.json','utf8')) as {phone:string}).phone;}
  catch(error) {if(!(typeof error==='object'&&error!==null&&'code' in error&&error.code==='ENOENT')) throw new Error('Invalid local recipient configuration');}
}
const dry=process.argv.includes('--dry-run');
for(const key of ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN',...dry?[]:['PROJECT_ID','PROJECT_SECRET','RECIPIENT_PHONE']]) {
  if(!env[key]?.trim()) throw new Error(`Missing required configuration: ${key}`);
}
if(!dry && !/^\+[1-9]\d{7,14}$/.test(env.RECIPIENT_PHONE!)) throw new Error('RECIPIENT_PHONE must use international +countrycode format');
const cfg:Settings={zone:env.TIMEZONE??'America/Los_Angeles',name:env.RECIPIENT_NAME??'Aryan',lead:Number(env.SUMMARY_LEAD_MINUTES??120),reminder:Number(env.REMINDER_LEAD_MINUTES??30)};
new Intl.DateTimeFormat('en',{timeZone:cfg.zone});
for(const value of [cfg.lead,cfg.reminder]) if(!Number.isInteger(value)||value<1||value>1440) throw new Error('Lead times must be whole minutes from 1 to 1440');
if(dry) {
  const now=Date.now(); const events=await fetchEvents(env,now,cfg.zone);
  console.log(JSON.stringify(jobs(events,now,cfg),null,2));
} else {
  if(env.DYNO&&!env.DATABASE_URL) throw new Error('Heroku requires DATABASE_URL for persistent notification storage');
  const directory=env.DATA_DIR??'./data';
  if(!env.DATABASE_URL) await mkdir(directory,{recursive:true});
  const store=env.DATABASE_URL ? await PostgresStore.open(env.DATABASE_URL) : new Store(`${directory}/notifications.sqlite`);
  const app=await Spectrum({projectId:env.PROJECT_ID!,projectSecret:env.PROJECT_SECRET!,providers:[imessage.config()]});
  const provider=imessage(app);
  const space=await provider.space.create(await provider.user(env.RECIPIENT_PHONE!));
  console.log(JSON.stringify({event:'identity_manual_setup',name:env.CONVERSATION_NAME??'Aryan’s Calendar',iconConfigured:!!env.CONVERSATION_ICON,reason:'Photon cannot rename or set an icon for a direct iMessage conversation. Save the sender as a contact on your phone.'}));
  let lastSuccess=0,stopping=false;
  const server=createServer((_req,res)=>{res.statusCode=Date.now()-lastSuccess<180_000?200:503;res.end(JSON.stringify({healthy:res.statusCode===200,lastCalendarPoll:lastSuccess||null}));}).listen(Number(env.PORT??3000),'0.0.0.0');
  const stop=()=>{stopping=true;};process.once('SIGTERM',stop);process.once('SIGINT',stop);
  const replies=(async()=>{
    for await (const [conversation,message] of app.messages) {
      if(stopping) break;
      if(message.platform!=='imessage'||message.content.type!=='text') continue;
      const dm=imessage(conversation);
      if(!allowed(message.sender?.id,env.RECIPIENT_PHONE!,message.direction,dm.type)) continue;
      const key=`question:${message.platform}:${message.id}`;
      if(await store.has(key)) continue;
      let response=help;
      try {
        const kind=intent(message.content.text);
        if(kind!=='help') {
          const now=Date.now();
          const events=await fetchEvents(env,now,cfg.zone,kind==='next'?30:1);
          response=answer(kind,events,now,cfg.zone);
        }
      } catch {response='I couldn’t check your calendar right now. Please try again in a moment.';}
      const outcome=await deliver({key,due:Date.now(),expires:Date.now()+60_000,text:response},store,text=>conversation.send(text));
      console.log(JSON.stringify({event:'calendar_question',outcome}));
    }
  })().catch(()=>{console.error(JSON.stringify({event:'message_stream_failed'}));stopping=true;process.exitCode=1;});
  let failures=0;
  while(!stopping) {
    try {
      let now=Date.now(); const events=await fetchEvents(env,now,cfg.zone); lastSuccess=Date.now();failures=0;console.log(JSON.stringify({event:'calendar_poll_ok'}));
      for(const candidate of jobs(events,now,cfg).filter(j=>j.due<=now&&j.expires>now)) {
        if(stopping) break;
        if(await store.has(candidate.key)) continue;
        const fresh=await fetchEvents(env,Date.now(),cfg.zone);now=Date.now();
        const job=jobs(fresh,now,cfg).find(j=>j.key===candidate.key&&j.due<=now&&j.expires>now);
        if(!job) continue;
        const outcome=await deliver(job,store,text=>space.send(text));
        console.log(JSON.stringify({event:`notification_${outcome}`,kind:job.key.split(':')[0]}));
      }
    } catch {failures++;console.error(JSON.stringify({event:'calendar_poll_failed',attempt:failures,action:'Check Google authorization and network; credentials are not logged'}));}
    const delay=Math.min(300_000,60_000*2**Math.min(failures,3));
    for(let elapsed=0;elapsed<delay&&!stopping;elapsed+=1000) await new Promise(r=>setTimeout(r,1000));
  }
  server.close();await app.stop();await replies;await store.close();
}
