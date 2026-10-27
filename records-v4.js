(() => {
const select=document.querySelector('#track-select'),out=document.querySelector('#record-tables'),message=document.querySelector('#record-status');
const params=new URLSearchParams(location.search);let selected=params.get('id')||'',wanted=params.get('track')||'',busy=false,refreshTimer;
const norm=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
async function read(path){const response=await fetch(window.MX_API+path,{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!response.ok)throw Error('Network');return response.json()}
function text(tag,value,parent,cls){const el=document.createElement(tag);el.textContent=value;if(cls)el.className=cls;parent.append(el);return el}
async function load(){if(busy||document.hidden)return;busy=true;select.disabled=true;message.textContent='Checking official server records…';let loading=false;
try{const data=await read('/records');if(data.state==='loading'){loading=true;message.textContent='Official records are loading…';return}if(data.state==='unavailable'||!Array.isArray(data.tracks))throw Error('Unavailable');
select.replaceChildren(new Option('All recorded tracks',''));data.tracks.forEach(t=>select.add(new Option(t.name,t.id)));if(!data.tracks.some(t=>t.id===selected))selected='';select.value=selected;
const chosen=selected?data.tracks.filter(t=>t.id===selected):wanted?data.tracks.filter(t=>norm(t.name).includes(norm(wanted))):data.tracks;
const fragment=document.createDocumentFragment();
if(!chosen.length)text('p','No official records found for '+wanted+' yet. Records appear after race results are uploaded.',fragment,'empty');
for(const t of chosen){const section=document.createElement('section');section.className='record-group';text('h2',t.name,section);const a=text('a','OFFICIAL LEADERBOARD ↗',section,'source-link');a.href=t.url;a.target='_blank';a.rel='noopener noreferrer';fragment.append(section);
try{const result=await read('/records?track='+encodeURIComponent(t.id));if(result.state==='loading'){loading=true;text('p','Leaderboard is loading…',section);continue}if(result.state==='unavailable'||!Array.isArray(result.rows))throw Error();
if(!result.rows.length){text('p','No uploaded lap records for this layout yet.',section,'empty');continue}
const wrap=document.createElement('div');wrap.className='table-scroll';const table=document.createElement('table'),head=document.createElement('thead'),tr=document.createElement('tr');['Pos','Name','Number','UID','Laptime','Bike'].forEach(s=>text('th',s,tr));head.append(tr);table.append(head);const body=document.createElement('tbody');result.rows.forEach(row=>{const tr=document.createElement('tr');['position','name','number','uid','time','bike'].forEach(k=>text('td',row[k]||'—',tr));body.append(tr)});table.append(body);wrap.append(table);section.append(wrap);text('p',(result.state==='stale'?'Saved copy — refresh failed. ':'Checked ')+new Date(result.fetchedAt).toLocaleString(),section,'small');
}catch{text('p','This leaderboard is temporarily unavailable. Open the official link above.',section,'empty')}}
out.replaceChildren(fragment);message.textContent=(data.state==='stale'?'Saved catalog — source refresh failed. ':'')+'Official uploaded race records · checked '+new Date(data.fetchedAt).toLocaleString();
}catch{message.textContent=out.children.length?'Records refresh failed. Previously displayed records remain below with their original check times.':'Records feed unavailable. Open the official server results link below.'}
finally{busy=false;select.disabled=false;clearTimeout(refreshTimer);refreshTimer=setTimeout(load,loading?5000:300000)}}
select.onchange=()=>{selected=select.value;wanted='';history.replaceState(null,'','records.html'+(selected?'?id='+encodeURIComponent(selected):''));load()};document.addEventListener('visibilitychange',()=>{if(!document.hidden)load()});load();
})();
