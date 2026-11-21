(() => {
  'use strict';
  const endpoint=(window.MX_API || 'https://317mx.duckdns.org/api').replace(/\/$/,'')+'/events';
  const tabs=[...document.querySelectorAll('[data-tab]')];
  const form=document.getElementById('event-signup');
  const submit=document.getElementById('signup-submit');
  let state=null, loading=false, sending=false;
  function showTab(value, update=true) {
    if(!['info','entries','results'].includes(value)) value='info';
    for(const tab of tabs){const selected=tab.dataset.tab===value;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;document.getElementById('panel-'+tab.dataset.tab).hidden=!selected;}
    if(update) history.replaceState(null,'',value==='info'?'events.html':'#'+value);
  }
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>showTab(tab.dataset.tab));
    tab.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
      showTab(tabs[next].dataset.tab);tabs[next].focus();
    });
  });
  document.querySelectorAll('[data-open-tab]').forEach(link=>link.addEventListener('click',()=>showTab(link.dataset.openTab)));
  window.addEventListener('hashchange',()=>showTab(location.hash.slice(1),false));
  showTab(location.hash.slice(1),false);
  function clock(seconds){if(!Number.isFinite(seconds))return 'No time yet';const ms=Math.floor(seconds*1000);return Math.floor(ms/60000)+':'+String(Math.floor(ms/1000)%60).padStart(2,'0')+'.'+String(ms%1000).padStart(3,'0');}
  function cell(row,value){const td=document.createElement('td');td.textContent=String(value);row.append(td);}
  function empty(body,message,columns){const row=document.createElement('tr'),td=document.createElement('td');td.colSpan=columns;td.className='empty';td.textContent=message;row.append(td);body.replaceChildren(row);}
  function render(data){
    state=data;
    const labels={qualifying:'QUALIFYING OPEN',starting:'SESSION LOADING',warmup:'LINEUP CHECK / WARMUP',moto1:'MOTO 1 LIVE',moto2:'MOTO 2 LIVE',intermission:'NEXT SESSION COUNTDOWN',paused:'OWNER PAUSED',releasing:'SAVING / RESTORING SERVER',complete:'EVENT COMPLETE',cancelled:'EVENT ENDED'};
    document.getElementById('event-status').textContent=labels[data.phase]||data.phase;
    submit.disabled=!data.entriesOpen||sending;
    submit.textContent=data.entriesOpen?'SIGN UP FOR TEST FUN RACE':'SIGNUPS CLOSED';
    document.getElementById('event-notice').textContent=data.error || (!data.live?'Live game feed is reconnecting. Saved signups and results remain available.':'');
    const rows=document.getElementById('event-entries');rows.replaceChildren();
    for(const entry of data.entries){const tr=document.createElement('tr');cell(tr,entry.qualifyingPosition||'—');cell(tr,entry.name);cell(tr,entry.number);cell(tr,entry.uid);cell(tr,clock(entry.bestLapSeconds));cell(tr,entry.qualified?'QUALIFIED':entry.present?'IN SERVER':'SIGNED UP');rows.append(tr);}
    if(!data.entries.length)empty(rows,'Be the first to sign up. Qualifying times appear after a clean Mintop flying lap.',6);
    document.getElementById('entry-summary').textContent=data.entries.length+' signed up · '+data.roster.length+' selected · fastest 40 eligible riders qualify';
    document.getElementById('entry-updated').textContent='Updated '+new Date(data.updatedAt*1000).toLocaleTimeString()+' · Times collected since '+new Date(data.qualifyingOpenedAt*1000).toLocaleTimeString()+'. Updates every 5 seconds while this page is visible.';
    const overall=document.getElementById('event-overall');overall.replaceChildren();
    for(const p of data.overall){const tr=document.createElement('tr');cell(tr,p.position);cell(tr,p.name);cell(tr,(data.motos['1']?p.moto1:'—')+(data.motos['1']&&p.statuses[0]!=='FIN'?' '+p.statuses[0]:''));cell(tr,(data.motos['2']?p.moto2:'—')+(data.motos['2']&&p.statuses[1]!=='FIN'?' '+p.statuses[1]:''));cell(tr,data.overallFinal?p.total:'Provisional');overall.append(tr);}
    if(!data.overall.length)empty(overall,'Results will appear after Moto 1 is saved.',5);
    document.getElementById('results-note').textContent=data.overallFinal?'Both moto scores are saved. Lowest total wins; Moto 2 breaks ties. Owner corrections may update results.':'Provisional until both motos are saved. Missing moto scores are not a final overall.';
    for(const n of ['1','2']){const list=document.getElementById('moto-'+n);list.replaceChildren();const results=[...(data.motos[n]||[])].sort((a,b)=>a.position-b.position);for(const p of results){const li=document.createElement('li');li.value=p.position;li.textContent=p.name+' · '+p.status+(p.adjusted?' · owner adjustment':'');list.append(li);}if(!results.length){const li=document.createElement('li');li.textContent='Not scored yet';list.append(li);}}
    countdown();
  }
  function countdown(){if(!state)return;let target=Date.parse(state.event.startsAt),prefix='UID grab in ';if(state.phase==='intermission'){target=state.nextAt*1000;prefix='Next session in ';}else if(state.phase!=='qualifying'){document.getElementById('event-countdown').textContent=state.phase==='complete'?'RACING COMPLETE · RESULTS POSTED':'EVENT IN PROGRESS · SEE LIVE TIMING';return;}const seconds=Math.max(0,Math.ceil((target-Date.now())/1000));document.getElementById('event-countdown').textContent=seconds?prefix+Math.floor(seconds/3600)+'h '+Math.floor(seconds/60)%60+'m '+seconds%60+'s':'UID grab scheduled now';}
  async function refresh(){if(loading)return;loading=true;try{const response=await fetch(endpoint,{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error();const data=await response.json();if(!data.event||!Array.isArray(data.entries))throw Error();render(data);}catch{document.getElementById('event-notice').textContent='Event updates are temporarily unavailable. Please refresh shortly.';if(!state)submit.disabled=true;}finally{loading=false;}}
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(sending||!state?.entriesOpen||!form.reportValidity())return;
    sending=true;submit.disabled=true;const message=document.getElementById('signup-message');message.className='';message.textContent='Saving your entry…';
    const fields=new FormData(form);try{const response=await fetch(endpoint+'/'+state.event.id+'/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:fields.get('name').trim(),number:fields.get('number').trim(),uid:fields.get('uid').trim()}),signal:AbortSignal.timeout(10000)});const result=await response.json();if(!response.ok)throw Error(result.error||'Entry could not be saved.');message.textContent=result.message;form.reset();await refresh();}catch(error){message.className='error';message.textContent=error.message==='Failed to fetch'?'Connection interrupted. Refresh the entry list before trying again.':error.message;}finally{sending=false;submit.disabled=!state?.entriesOpen;}
  });
  document.querySelectorAll('[data-refresh]').forEach(button=>button.addEventListener('click',refresh));
  setInterval(()=>{if(!document.hidden)refresh();},5000);setInterval(countdown,1000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});refresh();
})();
