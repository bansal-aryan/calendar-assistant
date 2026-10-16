import type { Job } from './calendar.ts';
import type { DeliveryStore } from './store.ts';
// Only an explicit resource-exhausted rejection is safe to retry. Network
// timeouts and unknown errors may occur after Photon accepted the message.
export async function deliver(job: Job, store: DeliveryStore, send:(text:string)=>Promise<unknown>, sleep:(ms:number)=>Promise<void>=ms=>new Promise(r=>setTimeout(r,ms))):Promise<'sent'|'uncertain'|'duplicate'> {
  if(!await store.claim(job.key)) return 'duplicate';
  try {
    for(const chunk of job.text.match(/[\s\S]{1,1400}/gu)??[]) {
      for(let attempt=0;;attempt++) {
        try {await send(chunk);break;}
        catch(error) {
          const code=typeof error==='object'&&error!==null&&'code' in error ? error.code : undefined;
          if(code!==8||attempt>=2||Date.now()+2**attempt*1000>=job.expires) throw error;
          await sleep(2**attempt*1000);
        }
      }
    }
    await store.finish(job.key,'sent');return 'sent';
  } catch {await store.finish(job.key,'uncertain');return 'uncertain';}
}
