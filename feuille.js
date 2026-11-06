(function(){
let IX=null;const SH={},OPEN={};
const st=document.createElement("style");
st.textContent=".res.ck{flex-wrap:wrap;cursor:pointer}.res .hint{width:100%;font-size:12px;color:var(--mu)}.res .sh{width:100%;margin-top:8px;cursor:default;font-weight:400}.fh{text-align:center;margin-bottom:8px}.fh .sc2{display:inline-block;margin:0 8px;font-size:20px;font-weight:800;color:var(--gold)}.fg{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}.fp{background:var(--alt);border-radius:8px;padding:8px;font-size:13px}.fp .fr{display:flex;justify-content:space-between;gap:6px;padding:3px 0}.fl{background:var(--alt);border-radius:8px;overflow:hidden}.fd{padding:7px 8px;border-top:1px solid var(--bg);font-size:13px}.fd:first-child{border-top:0}.fd .l1{display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center}.fd .l1 span:last-child{text-align:right}.fd .l1 b{min-width:46px;text-align:center;color:var(--gold)}.fd .l1 b.w{color:var(--ok)}.fd .l1 b.d{color:var(--ko)}@media(max-width:560px){.fg{grid-template-columns:1fr}}";
document.head.appendChild(st);
function loadIX(){if(IX)return;IX={loading:1};fetch("data/feuilles/index.json",{cache:"no-cache"}).then(r=>r.json()).then(j=>IX=j).catch(()=>IX={error:1}).finally(()=>draw())}
function loadSH(id){if(SH[id])return;SH[id]={loading:1};fetch("data/feuilles/"+id+".json",{cache:"no-cache"}).then(r=>r.json()).then(j=>SH[id]=j).catch(()=>SH[id]={error:1}).finally(()=>draw())}
function find(x){
const E=Object.values(IX),o=nrm(x.opp),dt=(x.date||"").split("-").reverse().join("/");
const c=E.filter(e=>{const me=isMe(e.home)?e.home:e.away;return tkey({title:e.division},me)==team&&isMe(e.home)==x.isHome});
const opp=e=>nrm(isMe(e.home)?e.away:e.home);
return c.find(e=>{const p=opp(e);return p.startsWith(o)||o.startsWith(p)})||c.find(e=>e.date==dt)||null}
function html(x){
loadIX();
if(IX.loading)return'<p class="sub">Chargement…</p>';
if(IX.error)return'<p class="sub">Feuilles indisponibles pour le moment.</p>';
const e=find(x);
if(!e)return'<p class="sub">Pas encore de feuille pour cette rencontre.</p>';
loadSH(e.id);const s=SH[e.id];
if(s.loading)return'<p class="sub">Chargement de la feuille…</p>';
if(s.error)return'<p class="sub">Feuille indisponible pour le moment.</p>';
const mh=isMe(s.home);
const tb=(t,p)=>`<div class="fp"><b>${esc(t)}</b>${p.map(j=>`<div class="fr"><span>${esc(j.n)}. ${esc(j.name)} <span class="sub">${esc(j.cat)}</span></span><b>${esc(j.wins)}</b></div>`).join("")}</div>`;
const rw=r=>{const n=r.s.match(/(\d+)\s*-\s*(\d+)/);if(!n)return"";const d=mh?n[1]-n[2]:n[2]-n[1];return d>0?"w":d<0?"d":""};
return`<div class="fh"><b>${esc(s.home)}</b><span class="sc2">${esc(s.score)}</span><b>${esc(s.away)}</b><br><span class="sub">${esc(s.date)} ${esc(s.time)}</span></div>`+
`<div class="fg">${tb(s.home,s.hp)}${tb(s.away,s.ap)}</div>`+
`<div class="fl">${s.rows.map(r=>`<div class="fd"><div class="l1"><span>${esc(r.h)} <span class="sub">${esc(r.hc)}</span></span><b class="${rw(r)}">${esc(r.s)}</b><span>${esc(r.a)} <span class="sub">${esc(r.ac)}</span></span></div><div class="sub">${esc(r.sets)}${r.sets?" · ":""}cumul ${esc(r.c)}</div></div>`).join("")}</div>`}
function decorate(){
if(tab!=2||!MT||!MT.matches)return;
const h=[...document.querySelectorAll("#m h3")].find(e=>e.textContent.trim()=="Déjà joués");
if(!h)return;
const pl=(teams()[team]||[]).filter(x=>mres(x));
let el=h.nextElementSibling;
pl.forEach(x=>{
if(!el||!el.classList.contains("res"))return;
const k=team+"|"+x.week,r=el;el=el.nextElementSibling;
r.classList.add("ck");
const hint=document.createElement("div");hint.className="hint";r.appendChild(hint);
const box=document.createElement("div");box.className="sh";box.onclick=e=>e.stopPropagation();r.appendChild(box);
const show=()=>{const o=!!OPEN[k];hint.textContent=o?"Masquer la feuille de match ▴":"Voir la feuille de match ▾";box.style.display=o?"":"none";if(o)box.innerHTML=html(x)};
r.onclick=()=>{OPEN[k]=!OPEN[k];show()};
show()})}
const od=draw;draw=function(){od();try{decorate()}catch(e){console.error(e)}};
draw();
})();
