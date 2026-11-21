const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = __dirname;

function create(disk = {}) {
    const tracks = [
        {file:'trackinfo/decker.trackinfo',id:'decker',laps:3},
        {file:'trackinfo/Mintop.trackinfo',id:'Mintop',laps:4},
        {file:'trackinfo/DelbSx.trackinfo',id:'DelbSx',laps:5},
        {file:'trackinfo/DelbSx.trackinfo',id:'DelbSx',laps:2}
    ];
    const source = Object.fromEntries(tracks.map(track=>[track.file,'dir='+track.id+'\n']));
    const commands = [], messages = [], roles = ['Nobody','Admin'];
    let selected=0,current=null,erode=6,raceErode=6,fail=false;
    const mxserver = {
        max_slots:2,
        get_rank:slot=>roles[slot],
        get_status:()=> 'Player',
        get_uid:slot=>slot+1,
        get_slot_info:()=>({name:'Test Rider'}),
        get_string(key,index) { return key==='track_dir' ? current?.id||'' : tracks[index].file; },
        get_number(key,index) {
            if(key==='track_count') return tracks.length;
            if(key==='finish_laps_list') return tracks[index].laps;
            if(key==='finish_laps') return current?.laps||0;
            if(key==='erode') return raceErode*1024;
            return 0;
        },
        file_to_string:file=>source[file]||disk[file]||'',
        string_to_file(file,content) {if(fail)throw Error('disk full');disk[file]=content;},
        schedule_command:command=>commands.push(command),
        send:(slot,message)=>messages.push({slot,message}),
        broadcast:message=>messages.push({slot:null,message}),
        log() {}
    };
    const context = vm.createContext({mxserver});
    vm.runInContext('var mx317RotationConfig='+JSON.stringify({id:'2026-11',defaultTrack:'Mintop',erode:6,tracks:[]})+';',context);
    vm.runInContext(fs.readFileSync(path.join(root,'server/317mx-rotation.js'),'utf8'),context);
    vm.runInContext(fs.readFileSync(path.join(root,'reference/votes.js'),'utf8'),context);
    function native(line) {
        if(line.startsWith('exec ')) {
            assert(disk[line.slice(5)].startsWith('#mxserverscript\n'));
            disk[line.slice(5)].trim().split('\n').slice(1).forEach(native);
        } else if(line.startsWith('erode ')) erode=Number(line.slice(6));
        else if(line.startsWith('settrack ')) selected=Number(line.slice(9));
        else if(line.startsWith('removetrack ')) {
            const index=Number(line.slice(12)); tracks.splice(index,1);
            if(selected>index)selected--;else selected=Math.min(selected,tracks.length-1);
        } else if(line.startsWith('317mx_selection_applied ')) mxserver.command_handler(2,line);
    }
    function settle() {
        for(const command of commands.splice(0)) {
            assert(!/^at \+\d+ restart/.test(command),'no automatic restart is scheduled');
            if(command.startsWith('at +0 exec ')) native(command.slice(6));
        }
    }
    function restart() {
        settle();
        assert.equal(mxserver.info_handler(0,'server,restart'),0);
        current={...tracks[selected]};
        raceErode=erode;
        mxserver.start_handler();
        settle();
        return current.id;
    }
    function vote(command) {
        mxserver.command_handler(0,'callvote '+command);
        mxserver.command_handler(1,'vote yes');
        settle();
    }
    function owner(command) {
        if(!mxserver.info_handler(1,'server,'+command))native(command);
        mxserver.second_handler();settle();
    }
    function state() {
        return Object.entries(disk).filter(([name])=>/-[ab]\.json$/.test(name))
            .map(([,value])=>JSON.parse(value)).sort((a,b)=>b.seq-a.seq)[0];
    }
    return {restart,vote,owner,state,mxserver,disk,messages,tracks,
        current:()=>current,erode:()=>raceErode,fail:value=>{fail=value;}};
}

let sim=create();
assert.equal(sim.restart(),'Mintop');
sim.vote('settrack 2');
assert.equal(sim.state().visit.pending,true);
assert.equal(sim.restart(),'DelbSx','initial load starts the allowance');
assert.equal(sim.state().visit.remaining,3);
assert.equal(sim.restart(),'DelbSx','restart one stays on the voted track');
assert.equal(sim.state().visit.remaining,2);
sim.vote('erode 2.5');
assert.equal(sim.restart(),'DelbSx','restart two stays on the voted track');
assert.equal(sim.erode(),2.5);
assert.equal(sim.state().visit.remaining,1);
assert.equal(sim.restart(),'Mintop','restart three returns to Mintop');
assert(!sim.state().visit);
assert.equal(sim.erode(),2.5);
sim.vote('settrack 2');sim.restart();sim.restart();
sim.vote('settrack 3');sim.restart();
assert.equal(sim.current().laps,2);
assert.equal(sim.state().visit.remaining,3,'another passed vote resets the allowance');
sim.owner('removetrack 0');
assert.equal(sim.state().visit.index,2,'removing an earlier track preserves the voted entry');
assert.equal(sim.restart(),'DelbSx');assert.equal(sim.current().laps,2);
assert.equal(sim.restart(),'DelbSx');assert.equal(sim.current().laps,2);
assert.equal(sim.restart(),'Mintop');

sim=create();sim.restart();sim.vote('settrack 2');sim.restart();
sim=create({...sim.disk});
assert.equal(sim.restart(),'DelbSx','saved allowance survives a process restart');
assert.equal(sim.state().visit.remaining,2);
sim.restart();assert.equal(sim.state().visit.remaining,1);
assert.equal(sim.restart(),'Mintop');
sim.vote('settrack 2');sim.restart();sim.owner('settrack 0');
assert.equal(sim.restart(),'decker','owner selection overrides a voted visit');
assert.equal(sim.restart(),'Mintop');

sim=create();sim.restart();sim.fail(true);sim.vote('settrack 2');sim.fail(false);
assert.equal(sim.restart(),'Mintop','failed vote persistence does not start an allowance');
sim=create();sim.restart();sim.vote('settrack 2');sim.restart();sim.owner('removetrack 2');
assert.equal(sim.restart(),'Mintop','removing the voted track cancels its allowance');
console.log('PASS: initial load plus two replays, third restart returns to Mintop, unfinished races, revotes, erode persistence, duplicate tracks, catalog edits, process restarts, owner overrides and save failures.');
