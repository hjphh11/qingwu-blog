import puppeteer from 'puppeteer-core';
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-proxy-server','--no-sandbox','--ignore-certificate-errors','--disable-gpu'],defaultViewport:{width:1280,height:900}});
const p=await b.newPage();
await p.setUserAgent('Mozilla/5.0 ChatTest');
await p.setCookie({name:'q_sess',value:'cbeeb63b874b075c6652666e83e7dab576c532950c5abc393bcf160b28c6bf7f',domain:'127.0.0.1',path:'/',httpOnly:true});
await p.goto('http://127.0.0.1:4321/chat/',{waitUntil:'networkidle2',timeout:60000});
await new Promise(r=>setTimeout(r,1500));
await p.evaluate(()=>{const b=[...document.querySelectorAll('button')].find(x=>(x.getAttribute('title')||'').includes('不合适')); if(b) b.click();});
await new Promise(r=>setTimeout(r,500));
const d0=await p.evaluate(()=>{const d=document.querySelector('.q-report[role=dialog]'); if(!d) return {exists:false}; return {exists:true, activeIn:d.contains(document.activeElement), active:(document.activeElement.getAttribute('aria-label')||document.activeElement.textContent||'').trim().slice(0,10)};});
const seq=[];
for(let i=0;i<10;i++){await p.keyboard.press('Tab');await new Promise(r=>setTimeout(r,80));
  seq.push(await p.evaluate(()=>{const d=document.querySelector('.q-report[role=dialog]');const el=document.activeElement;return {inD:d?d.contains(el):false,n:(el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,8)};}));}
await p.keyboard.press('Escape');await new Promise(r=>setTimeout(r,400));
const esc=!(await p.evaluate(()=>!!document.querySelector('.q-report[role=dialog]')));
console.log(JSON.stringify({...d0, escapeAllInside:seq.every(s=>s.inD), seq, esc},null,0));
// 图片灯箱
await p.evaluate(()=>{const i=document.querySelector('.q-chat__media img,.q-chat__media'); if(i) i.click();});
await new Promise(r=>setTimeout(r,600));
const zoom=await p.evaluate(()=>{const d=document.querySelector('[role=dialog]'); return d?{label:d.getAttribute('aria-label'),activeIn:d.contains(document.activeElement)}:null;});
await p.keyboard.press('Escape'); await new Promise(r=>setTimeout(r,400));
const zoomEsc=!(await p.evaluate(()=>!!document.querySelector('[role=dialog]')));
console.log('zoom',JSON.stringify({zoom,zoomEsc}));
await b.close();
