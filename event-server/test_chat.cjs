const fs=require('fs'),vm=require('vm'),assert=require('assert');
const lines=[];const mxserver={max_slots:2,get_uid:()=>15155,_317mx_event_pin:'decker',_317mx_event_meta:{trackName:'Decker Training Facility',title:'Decker Fun Race'},_317mx_rotation_tracks:[{name:'Decker Training Complex'},{name:'Mintop MX'}],send:(s,line)=>lines.push(line),log(){}};
vm.runInNewContext(fs.readFileSync(__dirname+'/server/317mx-announcements.js','utf8'),{mxserver});
mxserver.ready_handler(0);const count=lines.length;mxserver.ready_handler(0);assert.equal(lines.length,count);
assert.equal(lines.filter(line=>/\x1b\[(?:3[1-6])m/.test(line)).length,1);
const clean=lines.map(line=>line.replace(/\x1b\[[0-9;]*m/g,''));
assert(clean.some(line=>line.includes('Mintop MX is the default')));
for(const text of ['server,callvote settrack #','server,callvote erode #','server,listtracks','restart 3 after loading'])
    assert(clean.some(line=>line.includes(text)));
assert(!clean.some(line=>/Decker Fun Race|QUALIFYING TRACK|Pinned|Nov 21|events.html/.test(line)));
assert(clean.filter(line=>/^\+-+\+$/.test(line)).length>=5);
for(const line of clean)assert.equal(line.length,68);
console.log('PASS: mostly white welcome, one accent header, symmetric borders and no duplicate ready spam.');
