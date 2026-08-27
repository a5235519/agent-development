import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteCodexGatewayClient } from '../server/codex-gateway-client.mjs';

test('submits only the fixed sandbox envelope and replays Codex events',async()=>{const requests=[];let reads=0;const fetchImpl=async(url,options={})=>{requests.push({url,options});if(url.endsWith('/api/tasks'))return response(201,{task:{id:'task_1',status:'running'}});if(url.includes('/events'))return response(200,{events:reads++?[{eventId:'event_2',seq:2,type:'turn.completed'}]:[{eventId:'event_1',seq:1,type:'turn.started'}]});if(url.endsWith('/api/tasks/task_1'))return response(200,{task:{id:'task_1',status:reads>1?'completed':'running'}});throw new Error(url)};const client=new RemoteCodexGatewayClient({baseUrl:'http://gateway.test',fetchImpl,pollIntervalMs:0});await client.startTask({prompt:'fixed',cwd:'/isolated'});const events=[];const task=await client.waitForTask('task_1',{onEvent:event=>events.push(event.type),timeoutMs:1000});assert.equal(task.status,'completed');assert.deepEqual(events,['turn.started','turn.completed']);const body=JSON.parse(requests[0].options.body);assert.equal(body.sandbox,'workspace-write');assert.equal(body.approvalPolicy,'never')});

function response(status,body){return {ok:status>=200&&status<300,status,json:async()=>body}}
