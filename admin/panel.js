'use strict';
const $ = id => document.getElementById(id);
const statusNames = {new:'Шинэ',working:'Холбогдож байна',done:'Дууссан',closed:'Хаасан'};
const when = new Intl.DateTimeFormat('mn-MN',{timeZone:'Asia/Ulaanbaatar',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
let posts=[], archived=false, editing=null, pending=null, cursor=null, inboxVersion=0, previewUrl='', postsVersion=0;
function el(tag, text, cls) {
  const node=document.createElement(tag);
  if(text!=null)node.textContent=text;
  if(cls)node.className=cls;
  return node;
}
function button(text,fn) {
  const b=el('button',text);b.type='button';b.onclick=fn;return b;
}
function showLogin() {
  inboxVersion++;postsVersion++;
  for(const d of document.querySelectorAll('dialog[open]'))d.close();
  $('studio').hidden=true;$('logout').hidden=true;$('entry').hidden=false;
  $('posts').replaceChildren();$('inbox').replaceChildren();posts=[];editing=null;
  $('loginForm').elements.password.value='';$('loginForm').elements.user.focus();
}
function notice(message) { $('feedback').textContent=message; }
async function api(action, body, query={}) {
  const params=new URLSearchParams({action,...query});
  let response,data;
  try {
    response=await fetch('/api/cms'+(body?'':'?'+params),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,action})}:{cache:'no-store'});
    data=await response.json();
  }catch{throw Error('Сервертэй холбогдож чадсангүй. Дахин оролдоно уу.');}
  if(!response.ok){
    if(response.status===401 && action!=='login')showLogin();
    throw Object.assign(Error(data.error||'Үйлдэл амжилтгүй боллоо.'),{status:response.status});
  }
  return data;
}
function enter(data) {
  posts=data.posts;$('entry').hidden=true;$('studio').hidden=false;$('logout').hidden=false;tab(false);
}
async function loadPosts() {
  const version=++postsVersion;
  const data=await api('posts');
  if(version===postsVersion){posts=data.posts;showPosts();}
}
$('loginForm').onsubmit=async e=>{
  e.preventDefault();const f=e.currentTarget,b=f.querySelector('button');b.disabled=true;$('loginError').textContent='';
  try{await api('login',{user:f.elements.user.value.trim(),password:f.elements.password.value});f.elements.password.value='';enter(await api('posts'));}
  catch(err){$('loginError').textContent=err.message;}finally{b.disabled=false;}
};
$('logout').onclick=async()=>{try{await api('logout',{});showLogin();$('loginError').textContent='Системээс гарлаа.';}catch(e){notice(e.message);}};
function tab(inbox) {
  $('postSection').hidden=inbox;$('inboxSection').hidden=!inbox;$('newPost').hidden=inbox;
  $('postTab').toggleAttribute('aria-current',!inbox);$('inboxTab').toggleAttribute('aria-current',inbox);
  (inbox?$('inboxTab'):$('postTab')).setAttribute('aria-current','page');notice('');
  if(inbox)loadInbox();else showPosts();
}
$('postTab').onclick=()=>{tab(false);loadPosts().catch(e=>notice(e.message));};$('inboxTab').onclick=()=>tab(true);
function showPosts(){
  const list=$('posts');list.replaceChildren();
  $('live').textContent='Нийтэлсэн · '+posts.filter(p=>!p.archived).length;
  $('archive').textContent='Архив · '+posts.filter(p=>p.archived).length;
  $('live').setAttribute('aria-pressed',String(!archived));$('archive').setAttribute('aria-pressed',String(archived));
  const q=$('search').value.trim().toLocaleLowerCase('mn');
  const filtered=posts.filter(p=>p.archived===archived&&p.title.toLocaleLowerCase('mn').includes(q));
  $('postCount').textContent=filtered.length+' нийтлэл';
  if(!filtered.length)list.append(el('div',q?'Хайлтад тохирох нийтлэл алга.':archived?'Архивласан нийтлэл алга.':'Нийтэлсэн материал алга.','empty'));
  for(const p of filtered){
    const row=el('article',null,'row'),img=el('img'),copy=el('div'),controls=el('div',null,'row-controls');
    img.src=p.img;img.alt='';img.loading='lazy';copy.append(el('span',p.group,'meta'),el('h3',p.title));
    controls.append(button('Засах',()=>openEditor(p)),button(archived?'Сэргээх':'Архивлах',async e=>{
      if(archived){await setArchive(p,false,e.currentTarget);return;}
      pending=p;$('confirmText').textContent='«'+p.title+'» нүүр хуудаснаас хасагдана. Архиваас сэргээх боломжтой.';
      $('confirm').showModal();$('keep').focus();
    }));
    row.append(img,copy,el('div',p.price==null?'Үнэ лавлах':p.price.toLocaleString('mn-MN')+' ₮','money'),controls);list.append(row);
  }
}
async function setArchive(p,value,b){
  b.disabled=true;
  try{const r=await api('archive',{id:p.id,rev:p.rev,archived:value});posts=posts.map(x=>x.id===p.id?r.post:x);showPosts();notice(value?'Нийтлэлийг архивлалаа.':'Нийтлэлийг нүүр хуудсанд сэргээж нийтэллээ.');}
  catch(err){notice(err.message);if(err.status===409)await loadPosts().catch(e=>notice(e.message));}
  finally{b.disabled=false;if($('confirm').open)$('confirm').close();}
}
$('confirmArchive').onclick=e=>setArchive(pending,true,e.currentTarget);$('keep').onclick=()=>$('confirm').close();
$('live').onclick=()=>{archived=false;showPosts();};$('archive').onclick=()=>{archived=true;showPosts();};$('search').oninput=showPosts;
function releasePreview(){if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';}
function closeEditor(){if(!$('save').disabled)$('editor').close();}
$('editor').onclose=releasePreview;$('editor').oncancel=e=>{if($('save').disabled)e.preventDefault();};
$('cancel').onclick=closeEditor;$('back').onclick=closeEditor;
function openEditor(p) {
  editing=p||{id:crypto.randomUUID(),rev:0};const f=$('postForm');f.reset();releasePreview();
  $('editorTitle').textContent=p?'Нийтлэл засах':'Шинэ нийтлэл';$('save').textContent=p?'Хадгалах':'Нийтлэх';$('file').required=!p;
  for(const k of ['title','description','body','price','cat'])if(p)f.elements[k].value=p[k]??'';
  $('preview').hidden=!p;if(p)$('preview').src=p.img;else $('preview').removeAttribute('src');
  $('editError').textContent='';$('editor').showModal();f.elements.title.focus();
}
$('newPost').onclick=()=>openEditor(null);
$('file').onchange=()=>{
  releasePreview();const file=$('file').files[0];$('editError').textContent='';
  if(file&&(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>12*1024*1024)) {
    $('file').value='';$('editError').textContent='JPG, PNG эсвэл WebP зураг сонгоно уу. Дээд хэмжээ 12 МБ.';
  }else if(file)previewUrl=URL.createObjectURL(file);
  const src=previewUrl||editing?.img;$('preview').hidden=!src;if(src)$('preview').src=src;
};
async function compress(file){
  const bitmap=await createImageBitmap(file);
  try{
    const ratio=Math.min(1,1800/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    const data=canvas.toDataURL('image/webp',.85);
    if(data.length>3700000)throw Error('Зураг хэт том байна. Жижиг зураг сонгоно уу.');
    return data;
  }finally{bitmap.close();}
}
$('postForm').onsubmit=async e=>{
  e.preventDefault();const f=e.currentTarget,b=$('save');if(b.disabled)return;
  b.disabled=true;$('editError').textContent='Хадгалж байна…';
  try{
    const file=$('file').files[0];
    const values=Object.fromEntries(new FormData(f));
    const {post}=await api('save',{...values,price:values.price===''?null:Number(values.price),image:file?await compress(file):null,id:editing.id,rev:editing.rev});
    posts=editing.rev?posts.map(x=>x.id===post.id?post:x):[post,...posts];archived=post.archived;$('search').value='';
    $('editor').close();showPosts();notice(post.archived?'Архивласан нийтлэлийн өөрчлөлтийг хадгаллаа.':'Нийтлэлийг нүүр хуудсанд хадгаллаа.');
  }catch(err){$('editError').textContent=err.message;if(err.status===409)await loadPosts().catch(e=>notice(e.message));}
  finally{b.disabled=false;}
};
function inquiry(r){
  const item=el('details',null,'inquiry'),summary=el('summary'),label=el('div'),badge=el('span',statusNames[r.status],'badge '+r.status);
  label.append(el('h3',r.name),el('span',when.format(new Date(r.created))+' · '+r.service,'meta'));summary.append(label,badge);item.append(summary);
  const dl=el('dl');
  for(const [k,v] of [['Утас',r.phone],['Хэрэгтэй хугацаа',r.timing],['Сонгосон бараа',r.items],['Тайлбар',r.details]])if(v){
    const dd=el('dd',v);if(k==='Утас'){const a=el('a',v);a.href='tel:'+v.replace(/[^+0-9]/g,'');dd.replaceChildren(a);}
    dl.append(el('dt',k),dd);
  }
  const field=el('label','Хүсэлтийн төлөв'),select=el('select');
  for(const [value,text] of Object.entries(statusNames)){const o=el('option',text);o.value=value;select.append(o);}
  select.value=r.status;select.onchange=async()=>{
    select.disabled=true;
    try{const {row}=await api('status',{id:r.id,status:select.value,rev:r.rev});r=row;badge.textContent=statusNames[r.status];badge.className='badge '+r.status;notice('Хүсэлтийн төлөв хадгалагдлаа.');}
    catch(err){select.value=r.status;if(err.status===409)await loadInbox();notice(err.message);}
    finally{select.disabled=false;}
  };
  field.append(select);item.append(dl,field);return item;
}
async function loadInbox(append=false){
  const version=++inboxVersion,box=$('inbox');$('more').disabled=true;
  if(!append){cursor=null;box.replaceChildren(el('p','Уншиж байна…','meta'));$('more').hidden=true;}
  try{
    const data=await api('inquiries',null,{date:$('date').value,...(append&&cursor?{cursor}:{})});
    if(version!==inboxVersion)return;
    if(!append)box.replaceChildren();
    if(!data.rows.length && !box.children.length)box.append(el('div',$('date').value?'Энэ өдөр хүсэлт ирээгүй байна.':'Одоогоор хүсэлт ирээгүй байна.','empty'));
    data.rows.forEach(r=>box.append(inquiry(r)));cursor=data.cursor;$('more').hidden=!cursor;
  }catch(err){if(version===inboxVersion){if(!append)box.replaceChildren();notice(err.message);}}
  finally{if(version===inboxVersion)$('more').disabled=false;}
}
$('date').onchange=()=>loadInbox();$('allDates').onclick=()=>{$('date').value='';loadInbox();};$('refresh').onclick=()=>loadInbox();$('more').onclick=()=>loadInbox(true);
api('posts').then(enter).catch(e=>{if(e.status!==401)$('loginError').textContent=e.message;});
