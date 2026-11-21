const fs=require('fs'),vm=require('vm'),assert=require('assert');
const root=__dirname;
let now=1795226400000,control={phase:'qualifying',active:false,generatedAt:now/1000,deadline:now/1000+3600,notices:[],roster:[]};
const files={},commands=[],messages=[];let uid=15155,rank='Admin',status='Player';
const native={first_lap_length:3,normal_lap_length:2,finish_time:0,finish_laps:4,drop_time:128,track_count:1};
const api={max_slots:128,get_uid:slot=>slot===0?uid:0,get_rank:()=>rank,get_status:slot=>slot===0?status:'Empty',get_slot_info:()=>({name:'Cody',number:317}),get_string:(k)=>k==='track_dir'?'Mintop':k==='track_list'?'/trackinfo/Mintop.trackinfo':'',get_number:k=>native[k]||0,
file_to_string:path=>path.endsWith('control.json')?JSON.stringify(control):files[path]||'',string_to_file:(path,data)=>{files[path]=data;},schedule_command:cmd=>commands.push(cmd),send:(s,msg)=>messages.push(msg),broadcast:msg=>messages.push(msg),log:()=>{},
start_handler:()=>{},timing_handler:()=>{},second_handler:()=>{},command_handler:()=>0,info_handler:()=>0,ready_handler:()=>{},_317mx_rotation_tracks:[{file:'/trackinfo/Mintop.trackinfo',id:'Mintop',minutes:0,laps:4}]};
class FakeDate extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}}
const context=vm.createContext({mxserver:api,Date:FakeDate});
vm.runInContext(fs.readFileSync(root+'/reference/scoring.js','utf8'),context);
vm.runInContext(fs.readFileSync(root+'/server/317mx-event.js','utf8'),context);
api.start_handler();
for(const [i,t] of [[0,130],[1,256],[2,384],[3,512],[4,640]])api.timing_handler(0,i,t);
api.second_handler();let game=JSON.parse(files['/var/lib/317mx-events/game.json']);
assert.equal(game.qualifying[0].ticks,256);assert.equal(game.people[0].uid,15155);
api.start_handler();api.timing_handler(0,2,384);api.timing_handler(0,4,640);api.second_handler();
game=JSON.parse(files['/var/lib/317mx-events/game.json']);assert.equal(game.qualifying[0].ticks,256);
uid=55;api.command_handler(0,'event end');assert(!files['/var/lib/317mx-events/requests.json']);
uid=15155;api.command_handler(0,'event status');assert.equal(JSON.parse(files['/var/lib/317mx-events/requests.json'])[0].uid,15155);
control.active=true;control.phase='moto1';api.second_handler();uid=55;
assert.equal(api.info_handler(0,'server,restart'),1);assert.equal(api.info_handler(0,'server,callvote settrack 3'),1);
uid=15155;assert.equal(api.info_handler(0,'server,restart'),0);
control.action={id:1,commands:['broadcast TEST','maxplayers 40']};api.second_handler();
assert(commands.some(c=>c.includes('exec /var/lib/317mx-events/native.txt')));
api.command_handler(0,'317mx_event_ack 1');assert(!files['/var/lib/317mx-events/ack.json']);
api.command_handler(128,'317mx_event_ack 1');assert.equal(JSON.parse(files['/var/lib/317mx-events/ack.json']).id,1);
control.countdownAt=now/1000+10;control.countdownLabel='UID GRAB';api.second_handler();api.second_handler();
assert.equal(messages.filter(x=>x.includes('UID GRAB IN 10 SECONDS')).length,1);
control.phase='qualifying';control.active=false;control.deadline=now/1000+2;control.countdownAt=control.deadline;
now+=3000;control.generatedAt=now/1000;api.second_handler();
game=JSON.parse(files['/var/lib/317mx-events/game.json']);assert.equal(game.uidGrab.people[0].uid,15155);
uid=66;api.second_handler();game=JSON.parse(files['/var/lib/317mx-events/game.json']);assert.equal(game.uidGrab.people[0].uid,15155);
console.log('PASS: clean flying laps only, UID-authenticated owner controls, protected event votes/restarts, native acknowledgements and countdown deduplication.');
