import test from 'node:test';
import assert from 'node:assert/strict';
import {intent,answer,allowed} from '../src/questions.ts';
import type {Event} from '../src/calendar.ts';
const zone='America/Los_Angeles',now=Date.parse('2026-10-16T12:00:00-07:00');
const event=(id:string,hour:number):Event=>({id,summary:id,start:{dateTime:`2026-10-16T${hour}:00:00-07:00`},end:{dateTime:`2026-10-16T${hour}:30:00-07:00`}});
test('recognizes common questions and punctuation',()=>{
 assert.equal(intent('Whats my next event'),'next');assert.equal(intent('What’s next?'),'next');assert.equal(intent('What else do I have today?'),'remaining');assert.equal(intent('What is left on my schedule?'),'remaining');assert.equal(intent('What does my day look like?'),'today');assert.equal(intent('hello'),'help');assert.equal(intent('What is my schedule tomorrow?'),'help');
});
test('next event skips finished, ongoing, cancelled and declined events',()=>{
 const events=[event('past',10),event('ongoing',12),{...event('cancelled',13),status:'cancelled'},{...event('declined',14),attendees:[{self:true,responseStatus:'declined'}]},event('Dinner',18)];
 assert.match(answer('next',events,now+60000,zone),/Dinner.*6:00 PM PDT/);
});
test('remaining includes ongoing and all-day; full day retains finished events',()=>{
 const events=[event('Past',10),event('Current',12),event('Later',18),{id:'day',summary:'Birthday',start:{date:'2026-10-16'},end:{date:'2026-10-17'}}];
 const remaining=answer('remaining',events,now+60000,zone);assert.doesNotMatch(remaining,/Past/);assert.match(remaining,/Current.*happening now/);assert.match(remaining,/Birthday — all day/);assert.match(answer('today',events,now,zone),/Past/);
});
test('empty calendar and next-day events are explicit',()=>{
 assert.equal(answer('remaining',[],now,zone),'You have no more events today.');assert.match(answer('next',[],now,zone),/next 30 days/);
 const next={...event('Tomorrow',10),start:{dateTime:'2026-10-17T10:00:00-07:00'},end:{dateTime:'2026-10-17T11:00:00-07:00'}};assert.match(answer('next',[next],now,zone),/Saturday, Oct 17/);assert.equal(answer('today',[next],now,zone),'You have no events today.');
});
test('only the authorized inbound direct sender can query the calendar',()=>{
 const phone='+14255550123';assert.equal(allowed('+1 (425) 555-0123',phone,'inbound','dm'),true);assert.equal(allowed(phone,phone,'outbound','dm'),false);assert.equal(allowed(phone,phone,'inbound','group'),false);assert.equal(allowed('+14255550124',phone,'inbound','dm'),false);assert.equal(allowed(undefined,phone,'inbound','dm'),false);
});
