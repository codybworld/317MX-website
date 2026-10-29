(() => {
 const body=document.body, motion=document.querySelector('#motion'),reduce=matchMedia('(prefers-reduced-motion: reduce)');
 const stored=()=>{try{return localStorage.getItem('317mx-motion')}catch{return null}};
 function setMotion(paused){body.classList.toggle('paused',paused);motion.textContent=paused?'MOTION: OFF':'MOTION: ON';motion.setAttribute('aria-pressed',String(paused))}
 setMotion(reduce.matches||stored()==='off');
 motion.addEventListener('click',()=>{const off=!body.classList.contains('paused');setMotion(off);try{localStorage.setItem('317mx-motion',off?'off':'on')}catch{}});
 reduce.addEventListener('change',e=>setMotion(e.matches||stored()==='off'));
 const menu=document.querySelector('.menu-toggle'),nav=document.querySelector('nav');menu.onclick=()=>{const open=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(open));nav.classList.toggle('open',open)};
 const closeMenu=()=>{nav.classList.remove('open');menu.setAttribute('aria-expanded','false')};
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&nav.classList.contains('open')){closeMenu();menu.focus()}});
 document.addEventListener('click',e=>{if(!e.target.closest('header'))closeMenu()});
 matchMedia('(max-width:1100px)').addEventListener('change',closeMenu);
 nav.querySelectorAll('a').forEach(a=>{if(a.pathname===location.pathname&&!a.hash)a.setAttribute('aria-current','page');a.onclick=()=>{nav.classList.remove('open');menu.setAttribute('aria-expanded','false')}});
 document.querySelectorAll('[data-letters]').forEach(el=>{const text=el.textContent;el.setAttribute('aria-label',text);el.replaceChildren();[...text].forEach((ch,i)=>{const span=document.createElement('span');span.textContent=ch===' '?'\u00a0':ch;span.className='letter';span.setAttribute('aria-hidden','true');span.style.setProperty('--speed',(5+i%6)+'s');span.style.setProperty('--delay',(-i*.24)+'s');span.style.setProperty('--dy',(i%2?-3:3)+'px');el.append(span)})});
 const targets=document.querySelectorAll('.reveal,.page-heading,.wood-panel,.about-portrait,.main-logo,.identity>.actions,.identity>.address');
 if('IntersectionObserver'in window){body.classList.add('scroll-ready');const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('arrived');observer.unobserve(e.target)}}),{threshold:.07});targets.forEach((el,i)=>{el.classList.add('arrival');el.style.setProperty('--entry-x',((i%3-1)*55)+'px');el.style.setProperty('--entry-y',(i%2?-30:45)+'px');el.style.setProperty('--entry-r',(i%2?3:-3)+'deg');el.style.setProperty('--entry-delay',((i%3)*90)+'ms');observer.observe(el)})}
 const progress=document.querySelector('.scroll-progress');let scheduled=false;function scroll(){if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{const height=document.documentElement.scrollHeight-innerHeight;progress.style.transform='scaleX('+(height>0?scrollY/height:0)+')';scheduled=false})}addEventListener('scroll',scroll,{passive:true});scroll();
 document.querySelectorAll('[data-copy]').forEach(button=>button.onclick=async()=>{let status=document.querySelector('#copy-status');try{await navigator.clipboard.writeText('317mx.duckdns.org:19800');if(status)status.textContent='SERVER ADDRESS COPIED'}catch{if(status)status.textContent='317mx.duckdns.org:19800 — select and copy'}});
 const dialog=document.querySelector('.lightbox'),image=dialog.querySelector('img'),caption=dialog.querySelector('p');
 const photos=[...document.querySelectorAll('[data-photo],[data-preview]')];let current=0,opener=null;
 function display(i){current=(i+photos.length)%photos.length;const item=photos[current];image.src=item.dataset.photo||item.querySelector('img').src;image.alt=item.dataset.caption||item.dataset.title||item.querySelector('img').alt;caption.textContent=image.alt+' · '+(current+1)+' / '+photos.length}
 photos.forEach((item,i)=>item.addEventListener('click',()=>{opener=item;display(i);dialog.showModal()}));
 const close=()=>dialog.close();dialog.querySelector('.lightbox-close').onclick=close;dialog.querySelector('[data-prev]').onclick=()=>display(current-1);dialog.querySelector('[data-next]').onclick=()=>display(current+1);
 dialog.addEventListener('click',e=>{if(e.target===dialog)close()});dialog.addEventListener('close',()=>opener?.focus());dialog.addEventListener('keydown',e=>{if(e.key==='ArrowLeft'){e.preventDefault();display(current-1)}if(e.key==='ArrowRight'){e.preventDefault();display(current+1)}});
})();
