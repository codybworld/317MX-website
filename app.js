const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
if(!reduced)document.body.classList.add('js-motion');
const motion=document.querySelector('#motion');
motion.addEventListener('click',()=>{const paused=document.body.classList.toggle('paused');motion.textContent=paused?'MOTION: OFF':'MOTION: ON';motion.setAttribute('aria-pressed',String(paused));});
if(reduced){document.body.classList.add('paused');motion.textContent='MOTION: OFF';motion.setAttribute('aria-pressed','true');}
document.querySelectorAll('[data-letters]').forEach(el=>{const text=el.textContent;el.setAttribute('aria-label',text);el.textContent='';[...text].forEach((ch,i)=>{const s=document.createElement('span');s.className='letter';s.setAttribute('aria-hidden','true');s.textContent=ch===' '?'\u00a0':ch;s.style.setProperty('--speed',`${4+i%7*.7}s`);s.style.setProperty('--delay',`${-i*.27}s`);s.style.setProperty('--dy',`${i%2?-2:3}px`);s.style.setProperty('--dr',`${i%2?1:-1}deg`);el.append(s);});});
const observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){e.target.classList.add('visible');observer.unobserve(e.target)}},{threshold:.08});
document.querySelectorAll('.reveal').forEach((el,i)=>{el.style.setProperty('--rx',`${i%2?22:-22}px`);observer.observe(el)});
document.querySelectorAll('[data-copy]').forEach(button=>button.addEventListener('click',async()=>{const status=document.querySelector('#copy-status');try{await navigator.clipboard.writeText('317mx.duckdns.org:19800');status.textContent='SERVER ADDRESS COPIED'}catch{status.textContent='317mx.duckdns.org:19800 — select and copy'}}));
const dialog=document.querySelector('dialog'),big=dialog.querySelector('img'),caption=dialog.querySelector('strong'),download=dialog.querySelector('a');
document.querySelectorAll('[data-preview]').forEach(button=>button.addEventListener('click',()=>{big.src=button.querySelector('img').src;big.alt=button.dataset.title;caption.textContent=button.dataset.title;download.href=button.dataset.url;dialog.showModal()}));
dialog.querySelector('button').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
