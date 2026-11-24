import puppeteer from 'puppeteer-core';
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:'new',args:['--no-proxy-server','--no-sandbox','--ignore-certificate-errors','--disable-gpu'],defaultViewport:{width:1280,height:900}});
const p=await b.newPage();
await p.setUserAgent('Mozilla/5.0 ChatTest');
await p.setCookie({name:'q_sess',value:'cbeeb63b874b075c6652666e83e7dab576c532950c5abc393bcf160b28c6bf7f',domain:'127.0.0.1',path:'/',httpOnly:true});
await p.goto('http://127.0.0.1:4321/chat/',{waitUntil:'networkidle2',timeout:60000});
await new Promise(r=>setTimeout(r,1500));
await p.evaluate(()=>{const i=document.querySelector('.q-chat__media img'); if(i) i.click();});
await new Promise(r=>setTimeout(r,700));
const probe=await p.evaluate(()=>{const d=document.querySelector('[role=dialog]');return {exists:!!d,label:d?d.getAttribute('aria-label'):null,active:document.activeElement.tagName+'.'+(document.activeElement.className||''),inD:d?d.contains(document.activeElement):false,btns:d?[...d.querySelectorAll('button')].map(x=>(x.getAttribute('aria-label')||x.textContent||'').trim().slice(0,8)):[]};});
const seq=[];
for(let i=0;i<5;i++){await p.keyboard.press('Tab');await new Promise(r=>setTimeout(r,80));
  seq.push(await p.evaluate(()=>{const d=document.querySelector('[role=dialog]');const el=document.activeElement;return {inD:d?d.contains(el):false,n:(el.getAttribute('aria-label')||el.textContent||'').trim().slice(0,8)};}));}
await p.keyboard.press('Escape');await new Promise(r=>setTimeout(r,400));
const esc=!(await p.evaluate(()=>!!document.querySelector('[role=dialog]')));
console.log(JSON.stringify({probe,seq,esc}));
await b.close();
