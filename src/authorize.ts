import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const {GOOGLE_CLIENT_ID:clientId,GOOGLE_CLIENT_SECRET:clientSecret}=process.env;
if(!clientId||!clientSecret) throw new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for a Google Desktop OAuth client.');
const state=randomBytes(32).toString('hex'),verifier=randomBytes(32).toString('base64url');
let redirect='';
const server=createServer(async(req,res)=>{
  const url=new URL(req.url??'/',redirect);
  if(url.pathname!=='/callback'){res.writeHead(404).end();return;}
  if(url.searchParams.get('state')!==state){res.writeHead(400).end('Invalid authorization state');return;}
  if(!url.searchParams.get('code')){res.writeHead(400).end('Authorization was not completed. Retry the setup command.');return;}
  try {
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,code:url.searchParams.get('code')!,code_verifier:verifier,redirect_uri:redirect,grant_type:'authorization_code'}),signal:AbortSignal.timeout(20_000)});
    if(!response.ok) throw new Error('Authorization exchange failed');
    const data=await response.json() as {refresh_token?:string};if(!data.refresh_token) throw new Error('No refresh token');
    await mkdir('.secrets',{recursive:true,mode:0o700});
    await writeFile('.secrets/google-token.json',JSON.stringify({GOOGLE_REFRESH_TOKEN:data.refresh_token}),{mode:0o600,flag:'wx'});
    res.end('Calendar connected. You can close this tab.');
    console.log('Refresh token saved to .secrets/google-token.json (not printed). Local runs load it automatically. Add it to Heroku config vars for deployment.');
    clearTimeout(timeout);server.close();
  } catch {res.writeHead(500).end('Setup failed. Check OAuth configuration or whether .secrets/google-token.json already exists.');console.error('Authorization failed; no credentials logged.');}
});
server.listen(0,'127.0.0.1',()=>{
  const address=server.address();if(!address||typeof address==='string') throw new Error('No callback port');
  redirect=`http://127.0.0.1:${address.port}/callback`;
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:clientId,redirect_uri:redirect,response_type:'code',scope:'https://www.googleapis.com/auth/calendar.events.readonly',access_type:'offline',prompt:'consent',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
  console.log(`Open this URL in your browser to authorize your Google account:\n${url}`);
});
const timeout=setTimeout(()=>{console.error('Authorization timed out; run the setup command again.');server.close();process.exitCode=1;},300_000);
