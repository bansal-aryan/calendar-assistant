import { DatabaseSync } from 'node:sqlite';
export interface DeliveryStore {
  claim(key:string): boolean | Promise<boolean>;
  has(key:string): boolean | Promise<boolean>;
  finish(key:string,status:'sent'|'uncertain'): void | Promise<void>;
  close(): void | Promise<void>;
}
export class Store implements DeliveryStore {
  private db: DatabaseSync;
  constructor(path:string) {
    this.db=new DatabaseSync(path);
    this.db.exec('CREATE TABLE IF NOT EXISTS deliveries (key TEXT PRIMARY KEY, status TEXT NOT NULL, updated INTEGER NOT NULL)');
    this.db.exec("UPDATE deliveries SET status='uncertain' WHERE status='sending'");
  }
  claim(key:string):boolean { return this.db.prepare("INSERT OR IGNORE INTO deliveries VALUES (?, 'sending', ?)").run(key,Date.now()).changes===1; }
  finish(key:string,status:'sent'|'uncertain') {this.db.prepare('UPDATE deliveries SET status=?, updated=? WHERE key=?').run(status,Date.now(),key);}
  has(key:string) {return !!this.db.prepare('SELECT key FROM deliveries WHERE key=?').get(key);}
  close(){this.db.close();}
}
