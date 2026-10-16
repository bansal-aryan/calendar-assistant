import { Client } from 'pg';
import type { DeliveryStore } from './store.ts';
export class PostgresStore implements DeliveryStore {
  private constructor(private client: Client) {}
  static async open(connectionString: string): Promise<PostgresStore> {
    const client = new Client({connectionString, ssl: {rejectUnauthorized:false}, connectionTimeoutMillis:15000, query_timeout:15000});
    // Heroku Postgres requires TLS and uses certificates that may be self-signed.
    client.on('error',()=>{console.error('Postgres connection lost; restarting worker');process.exit(1);});
    await client.connect();
    try {
      const lock=await client.query('SELECT pg_try_advisory_lock(72130942) AS acquired');
      if(!lock.rows[0]?.acquired) throw new Error('Another calendar worker is already running');
      await client.query('CREATE TABLE IF NOT EXISTS deliveries (key TEXT PRIMARY KEY, status TEXT NOT NULL, updated BIGINT NOT NULL)');
      await client.query("UPDATE deliveries SET status='uncertain' WHERE status='sending'");
      return new PostgresStore(client);
    } catch(error){await client.end();throw error;}
  }
  async claim(key:string):Promise<boolean> {
    const result=await this.client.query("INSERT INTO deliveries VALUES ($1,'sending',$2) ON CONFLICT (key) DO NOTHING RETURNING key",[key,Date.now()]);
    return result.rowCount===1;
  }
  async has(key:string):Promise<boolean> {return (await this.client.query('SELECT key FROM deliveries WHERE key=$1',[key])).rowCount===1;}
  async finish(key:string,status:'sent'|'uncertain'):Promise<void> {await this.client.query('UPDATE deliveries SET status=$1,updated=$2 WHERE key=$3',[status,Date.now(),key]);}
  async close():Promise<void> {await this.client.end();}
}
