const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function simulation(officialTime = 5000) {
    const personal = [], broadcast = [], timings = [[], []], statuses = ['Player', 'Player'];
    let finishCalls = 0;
    const mxserver = {
        max_slots: 2,
        get_number(key) { return ({first_lap_length:3,normal_lap_length:3,finish_laps:3,
            finish_time:0,drop_time:100,holeshot_index:1})[key] || 0; },
        get_string: () => 'Mintop',
        get_uid: slot => 100 + slot,
        get_status: slot => statuses[slot],
        get_slot_info: slot => ({name:slot ? 'Clean rider' : 'Fast cutter'}),
        file_to_string(path) {
            if (path.endsWith('lap-records.json')) return JSON.stringify({tracks:{Mintop:{
                time:officialTime,riders:{100:6000,101:6000},fetchedAt:Date.now()
            }}});
            return ['dir=Mintop','firstlap=3','normallap=3','starttime=100','time=0','laps=3',
                'players:','slot=0','uid=100','name=Fast cutter','slot=1','uid=101',
                'name=Clean rider','times:',
                ...timings.flatMap((times,slot)=>Object.keys(times).map(index=>slot+' '+index+' '+times[index]))
            ].join('\n');
        },
        send: (slot, text) => personal.push({slot,text}),
        broadcast: text => broadcast.push(text),
        finish_handler() { finishCalls++; },
        log() {}
    };
    const context = vm.createContext({mxserver});
    for (const file of ['scoring.js','317mx-lap-messages.js'])
        vm.runInContext(fs.readFileSync(file==='scoring.js'?__dirname+'/reference/scoring.js':__dirname+'/server/'+file,'utf8'), context);
    mxserver.start_handler();
    const gate=(slot,index,time)=>{timings[slot][index]=time;mxserver.timing_handler(slot,index,time);};
    const tick=(count=1)=>{for(let i=0;i<count;i++) mxserver.second_handler();};
    return {context,mxserver,personal,broadcast,statuses,gate,tick,finishCalls:()=>finishCalls};
}

let sim=simulation();
sim.gate(0,0,200);sim.gate(0,1,300);sim.tick();
assert.equal(sim.personal.length,0);
sim.gate(1,0,190);sim.gate(1,1,280);sim.tick(2);
assert.equal(sim.broadcast.filter(x=>x.includes('[ HOLESHOT ]')).length,1);
assert(sim.broadcast.find(x=>x.includes('[ HOLESHOT ]')).includes('Clean rider'));
sim.gate(0,2,1000);sim.gate(1,2,1100);sim.tick();
assert.equal(sim.personal.length,0,'lap one stays silent');
sim.gate(0,3,1400);sim.gate(0,4,1900);sim.tick();
assert.equal(sim.personal.length,0,'intermediate gates stay silent');
sim.gate(0,5,2500);sim.tick();
assert.equal(sim.personal.length,1);
assert.match(sim.personal[0].text,/LAP 2 COUNTED.*PERSONAL BEST/);
assert(sim.broadcast.some(x=>x.includes('SESSION FASTEST + SERVER BEST')));
sim.gate(0,5,2500);sim.tick();
assert.equal(sim.personal.length,1,'duplicate finish stays silent');
sim.gate(1,3,1600);sim.gate(1,5,2800);sim.tick();
assert.equal(sim.personal.length,1,'allow reordered timing data before rejecting a lap');
sim.tick(2);
assert.equal(sim.personal.length,2);
assert.match(sim.personal[1].text,/\x1b\[31m.*LAP NOT VALID.*Lap 2 did not count/);
sim.gate(1,4,2000);sim.tick();
assert.equal(sim.personal.length,2,'late data does not repeat a completed notice');
sim.gate(0,6,3000);sim.gate(0,7,3500);sim.gate(0,8,4000);sim.tick(3);
assert(!sim.broadcast.some(x=>x.includes('WON THE RACE')));
sim.gate(1,6,3300);sim.gate(1,7,3900);sim.gate(1,8,4500);sim.tick(3);
assert.equal(sim.broadcast.filter(x=>x.includes('WON THE RACE')).length,1);
sim.tick(5);sim.mxserver.finish_handler();
assert.equal(sim.broadcast.filter(x=>x.includes('WON THE RACE')).length,1);
assert.equal(sim.finishCalls(),1);

sim=simulation();
// The first finisher skipped gates. Official cut penalties must select the clean rider.
for (let index=0;index<6;index++) sim.gate(0,index,200+index*1000);
sim.gate(0,8,7900);
for (let index=0;index<9;index++) sim.gate(1,index,250+index*1000);
sim.tick(4);
assert.equal(sim.broadcast.filter(x=>x.includes('WON THE RACE')).length,1);
assert(sim.broadcast.find(x=>x.includes('WON THE RACE')).includes('Clean rider'));
assert.equal(sim.broadcast.filter(x=>x.includes('SESSION FASTEST')&&x.includes('Fast cutter')).length,1);
assert(sim.personal.some(x=>x.text.includes('[ LAP NOT VALID ]')&&x.text.includes('Lap 3')));

sim=simulation();
sim.gate(0,0,200);sim.gate(0,1,300);sim.gate(0,2,1000);
sim.gate(0,3,1400);sim.gate(0,5,2500);sim.tick();
sim.gate(0,4,1900);sim.tick();
assert.equal(sim.personal.length,1);
assert(sim.personal[0].text.includes('COUNTED'));
sim=simulation(500);
for (let index=0;index<6;index++) sim.gate(0,index,200+index*1000);
sim.tick();
assert(sim.broadcast.some(x=>x.includes('[ SESSION FASTEST ]')));
assert(!sim.broadcast.some(x=>x.includes('SERVER BEST')));
console.log('PASS: second-lap start, white clean laps and red invalid labels, packet reordering, private notices, global records/holeshot, and cut-adjusted winner after all finishes.');
