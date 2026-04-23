require('dotenv').config();

const express=require('express');
const request=require('request');
const fs=require('fs');
const path=require('path');
const db=require('./db');

const app=express();

app.use(express.json());
app.use(express.urlencoded({extended:true}));
app.use(express.static(path.join(__dirname,'public')));

// ================= LOGIN ADMIN =================
app.post('/login',(req,res)=>{
  const {username,password}=req.body;

  if(
    username===process.env.ADMIN_USER &&
    password===process.env.ADMIN_PASS
  ){
    return res.send('OK');
  }
  res.status(401).send('FAIL');
});

// ===== IN MEMORY =====
let live=[]; let vod=[]; let series=[];
let liveCats={}; let vodCats={}; let seriesCats={};

function cleanName(n){
  return (n||'')
    .replace(/^\uFEFF/,"")
    .replace(/\s{2,}/g,' ')
    .trim();
}

function isSeriesByCat(cat){
  return /series|serie|tv show|show|netflix|amazon|disney/i.test(cat||'');
}
function isVodByUrl(url){
  return /\.(mp4|mkv|avi|mov|wmv)$/i.test(url||'');
}

// ===== LOAD M3U (KEEP ORDER, DO NOT SORT, DO NOT DROP VALID) =====
function loadM3U(){
  try{
    const m3u=path.join(__dirname,'m3u','hamza.m3u');
    if(!fs.existsSync(m3u)) return console.log('hamza.m3u NOT FOUND');

    const data=fs.readFileSync(m3u,'utf8').replace(/^\uFEFF/,"");
    const lines=data.split(/\r?\n/);

    live=[]; vod=[]; series=[];
    liveCats={}; vodCats={}; seriesCats={};

    let idL=1, idV=1, idS=1;

    for(let i=0;i<lines.length;i++){
      if(!lines[i] || !lines[i].startsWith('#EXTINF')) continue;

      const info=lines[i];
      const attrName=(info.match(/tvg-name="(.*?)"/)||[])[1]||'';
      const dispName=(info.indexOf(',')>-1?info.substring(info.indexOf(',')+1):'').trim();
      const name=cleanName(attrName||dispName||'No Name');
      const logo=(info.match(/tvg-logo="(.*?)"/)||[])[1]||'';
      const cat=(info.match(/group-title="(.*?)"/)||[])[1]||'OTHER';
      const url=(lines[i+1]||'').trim();
      if(!/^https?:\/\//i.test(url)) continue; // must be real stream

      if(isSeriesByCat(cat)){
        const ch={id:idS++,name,logo,url,category:cat};
        series.push(ch);
        if(!seriesCats[cat]) seriesCats[cat]=[];
        seriesCats[cat].push(ch);
      }
      else if(isVodByUrl(url)){
        const ch={id:idV++,name,logo,url,category:cat};
        vod.push(ch);
        if(!vodCats[cat]) vodCats[cat]=[];
        vodCats[cat].push(ch);
      }
      else{
        const ch={id:idL++,name,logo,url,category:cat};
        live.push(ch);
        if(!liveCats[cat]) liveCats[cat]=[];
        liveCats[cat].push(ch);
      }
    }

    console.log('LIVE:',live.length,' MOVIES:',vod.length,' SERIES:',series.length);
  }catch(e){ console.log('M3U ERROR:',e.message); }
}

loadM3U();
setInterval(loadM3U,300000);

// ===== STREAM PROXY =====
function proxy(req,res,type){
  const u=req.params.user;
  const p=req.params.pass;
  const id=parseInt(req.params.id);

  db.query('SELECT * FROM users WHERE username=? AND password=? AND active=1',[u,p],(e,r)=>{
    if(e||!r.length) return res.end();
    if(new Date()>new Date(r[0].expire_date)) return res.end();

    const list=(type==='live')?live:(type==='vod')?vod:series;
    const ch=list.find(c=>c.id===id);
    if(!ch) return res.end();

    const s=request({url:ch.url,headers:{'User-Agent':'Mozilla/5.0'},timeout:20000});
    s.on('error',()=>res.end());
    res.on('close',()=>s.abort());
    s.pipe(res);
  });
}

app.get('/live/:user/:pass/:id.ts',(q,s)=>proxy(q,s,'live'));
app.get('/movie/:user/:pass/:id.mp4',(q,s)=>proxy(q,s,'vod'));
app.get('/series/:user/:pass/:id.ts',(q,s)=>proxy(q,s,'series'));

// ===== XTREAM API =====
app.get('/player_api.php',(req,res)=>{
  const u=req.query.username;
  const p=req.query.password;
  const a=req.query.action;

  db.query('SELECT * FROM users WHERE username=? AND password=? AND active=1',[u,p],(e,r)=>{
    if(e||!r.length) return res.json({auth:0});

    if(!a){
      return res.json({user_info:{username:u,auth:1,status:'Active'},server_info:{url:req.headers.host,port:'8080'}});
    }

    if(a==='get_live_categories'){
      let i=1, out=[]; for(const c in liveCats){ out.push({category_id:String(i++),category_name:c}); }
      return res.json(out);
    }
    if(a==='get_vod_categories'){
      let i=1, out=[]; for(const c in vodCats){ out.push({category_id:String(i++),category_name:c}); }
      return res.json(out);
    }
    if(a==='get_series_categories'){
      let i=1, out=[]; for(const c in seriesCats){ out.push({category_id:String(i++),category_name:c}); }
      return res.json(out);
    }

    if(a==='get_live_streams'){
      let out=[],i=1,cid=1; for(const c in liveCats){ liveCats[c].forEach(ch=>{ out.push({num:i++,name:ch.name,stream_type:'live',stream_id:ch.id,stream_icon:ch.logo,category_id:String(cid),container_extension:'ts'});}); cid++; }
      return res.json(out);
    }
    if(a==='get_vod_streams'){
      let out=[],i=1,cid=1; for(const c in vodCats){ vodCats[c].forEach(ch=>{ out.push({num:i++,name:ch.name,stream_type:'movie',stream_id:ch.id,stream_icon:ch.logo,category_id:String(cid),container_extension:'mp4'});}); cid++; }
      return res.json(out);
    }
    if(a==='get_series'){
      let out=[],i=1,cid=1; for(const c in seriesCats){ seriesCats[c].forEach(ch=>{ out.push({num:i++,name:ch.name,series_id:ch.id,cover:ch.logo,category_id:String(cid)});}); cid++; }
      return res.json(out);
    }

    return res.json({});
  });
});

// ===== ADMIN =====
app.get('/users',(req,res)=>{
  db.query("SELECT id,username,DATEDIFF(expire_date,NOW()) as days_left,IF(expire_date>NOW(),'Active','Expired') as status FROM users",(e,r)=>{
    if(e) return res.json([]);
    res.json(r);
  });
});

app.post('/add-user',(req,res)=>{
  let d=req.body; let exp=d.expire||'2030-01-01';
  db.query('INSERT INTO users(server,username,password,expire_date,active) VALUES(?,?,?,?,1)',[d.server,d.username,d.password,exp],(e)=>{
    if(e) return res.send('DB ERROR'); res.send('OK');
  });
});

app.post('/renew/:id',(req,res)=>{
  db.query('UPDATE users SET expire_date=DATE_ADD(expire_date,INTERVAL ? DAY) WHERE id=?',[req.body.days,req.params.id],()=>res.send('OK'));
});

app.post('/update-user/:id',(req,res)=>{
  let d=req.body;
  db.query('UPDATE users SET username=?,password=?,expire_date=? WHERE id=?',[d.username,d.password,d.expire,req.params.id],()=>res.send('OK'));
});

app.delete('/delete-user/:id',(req,res)=>{
  db.query('DELETE FROM users WHERE id=?',[req.params.id],()=>res.send('OK'));
});

app.get('/export-csv',(req,res)=>{
  db.query('SELECT username,password,expire_date FROM users',(e,r)=>{
    if(e) return res.send('ERR');
    let csv='username,password,expire_date\n';
    r.forEach(u=>{ csv+=u.username+','+u.password+','+u.expire_date+'\n'; });
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename=users.csv');
    res.send(csv);
  });
});

app.listen(8080,()=>console.log('IPTV SERVER v5 OK'));