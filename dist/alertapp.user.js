// ==UserScript==
// @name         alertapp
// @namespace    https://github.com/junsu0505-art/alertapp
// @version      0.1.0
// @description  TradingView 추세선 cross 시 Telegram 알림
// @author       junsu0505-art
// @match        https://*.tradingview.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      api.telegram.org
// @connect      stream.binance.com
// @run-at       document-end
// @license      MIT
// ==/UserScript==


"use strict";(()=>{var E={telegram:null,alerts:[]};var L="alertapp:settings";function R(){return typeof GM_getValue=="function"&&typeof GM_setValue=="function"}function q(n){if(typeof window<"u")return window.__alertapp_storage__??={},window.__alertapp_storage__[n]}function Y(n,e){typeof window<"u"&&(window.__alertapp_storage__??={},window.__alertapp_storage__[n]=e)}async function Z(n){if(R()){let e=await GM_getValue(n,void 0);return typeof e=="string"?e:void 0}return q(n)}async function Q(n,e){R()?await GM_setValue(n,e):Y(n,e)}async function g(){try{let n=await Z(L);return n?JSON.parse(n):{...E,alerts:[]}}catch{return{...E,alerts:[]}}}async function y(n){await Q(L,JSON.stringify(n))}async function O(n){let e=await g();e.alerts.push(n),await y(e)}async function N(n,e){let t=await g(),r=t.alerts.findIndex(a=>a.id===n);r!==-1&&(t.alerts[r]={...t.alerts[r],...e},await y(t))}async function W(n){let e=await g();e.alerts=e.alerts.filter(t=>t.id!==n),await y(e)}async function D(n){let e=await g();e.telegram=n,await y(e)}async function v(){return(await g()).telegram}var ee="wss://stream.binance.com:9443/stream";var C=class{_url;_maxBackoffMs;_ws=null;_subscriptions=new Map;_reconnectAttempts=0;_reconnectTimer=null;_closed=!1;_msgIdCounter=1;constructor(e={}){this._url=e.url??ee,this._maxBackoffMs=e.maxBackoffMs??3e4}get isConnected(){return this._ws?.readyState===WebSocket.OPEN}subscribe(e,t){let r=e.toLowerCase();this._subscriptions.has(r)||this._subscriptions.set(r,new Set),this._subscriptions.get(r).add(t),this._ws===null?this._connect():this._ws.readyState===WebSocket.OPEN&&this._sendSubscribe([r])}unsubscribe(e,t){let r=e.toLowerCase(),a=this._subscriptions.get(r);a&&(t!==void 0?a.delete(t):a.clear(),a.size===0&&(this._subscriptions.delete(r),this._sendUnsubscribe([r])))}close(){this._closed=!0,this._reconnectTimer!==null&&(clearTimeout(this._reconnectTimer),this._reconnectTimer=null),this._ws!==null&&(this._ws.onclose=null,this._ws.onerror=null,this._ws.close(),this._ws=null)}_connect(){if(this._closed)return;let e=new WebSocket(this._url);this._ws=e,e.onopen=()=>{this._reconnectAttempts=0;let t=Array.from(this._subscriptions.keys());t.length>0&&this._sendSubscribe(t)},e.onmessage=t=>{this._handleMessage(t.data)},e.onerror=()=>{},e.onclose=()=>{this._closed||(this._ws=null,this._scheduleReconnect())}}_scheduleReconnect(){if(this._closed)return;let e=Math.min(1e3*Math.pow(2,this._reconnectAttempts),this._maxBackoffMs);this._reconnectAttempts++,this._reconnectTimer=setTimeout(()=>{this._reconnectTimer=null,this._closed||this._connect()},e)}_handleMessage(e){let t;try{t=JSON.parse(e)}catch{return}if(!te(t))return;let a=t.stream.split("@")[0];if(!a)return;let i=this._subscriptions.get(a);if(!i||i.size===0)return;let s=parseFloat(t.data.p);if(!isFinite(s))return;let c={symbol:a.toUpperCase(),price:s,ts:Math.floor(t.data.T/1e3)};for(let p of i)p(c)}_sendSubscribe(e){this._sendJson({method:"SUBSCRIBE",params:e.map(t=>`${t}@trade`),id:this._msgIdCounter++})}_sendUnsubscribe(e){this._sendJson({method:"UNSUBSCRIBE",params:e.map(t=>`${t}@trade`),id:this._msgIdCounter++})}_sendJson(e){this._ws?.readyState===WebSocket.OPEN&&this._ws.send(JSON.stringify(e))}};function te(n){if(typeof n!="object"||n===null)return!1;let e=n;if(typeof e.stream!="string"||typeof e.data!="object"||e.data===null)return!1;let t=e.data;return!(typeof t.p!="string"||typeof t.T!="number")}function G(n){return new C(n)}var H=new Set(["LineToolTrendLine"]);function w(){try{return window._exposed_chartWidgetCollection?.activeChartWidget?.value?.()??null}catch{return null}}function T(n){let e=n.time??0;e>1e12&&(e=Math.floor(e/1e3));let t=n.price??n.value??0;return{time:e,price:t}}function z(n=3e4){return new Promise((e,t)=>{let a=Date.now()+n,i=setInterval(()=>{try{let s=w();if(s&&typeof s.lineToolsAndGroupsDTO=="function"){clearInterval(i),e(s);return}}catch{}Date.now()>=a&&(clearInterval(i),t(new Error(`alertapp: waitForTvChart timed out after ${n}ms`)))},250)})}function _(){let n=f().raw;try{let e=w();if(e&&typeof e.lineToolsAndGroupsDTO=="function"){let t=e.lineToolsAndGroupsDTO(),r=[];return t.forEach(a=>{a.sources.forEach((i,s)=>{if(!H.has(i.type))return;let c=i.points;!c||c.length<2||r.push({id:s,p1:T(c[0]),p2:T(c[1]),symbol:n})})}),r}}catch(e){console.warn("alertapp: lineToolsAndGroupsDTO \uC2E4\uD328 \u2014 \uD6C4\uBCF4 2 \uC2DC\uB3C4",e)}try{let t=w()?.model?.();if(!t)return[];let r=[];return t.panes().forEach(a=>{a.dataSources().forEach(i=>{let s=i.constructor?.name??"",c=i.toolname??s;if(!H.has(c))return;let p=typeof i.points=="function"?i.points():i.points??i._points??[];!p||p.length<2||r.push({id:i.id??`fb-${Math.random()}`,p1:T(p[0]),p2:T(p[1]),symbol:n})})}),r}catch(e){return console.warn("alertapp: \uD6C4\uBCF4 2 dataSources fallback \uB3C4 \uC2E4\uD328. TV API \uBCC0\uACBD \uAC00\uB2A5\uC131.",e),[]}}function f(){try{let e=window._exposed_chartWidgetCollection?.activeChartWidget?.value?.(),t;return typeof e?.symbol=="function"?t=e.symbol():typeof e?.activeChartSymbolInfo=="function"&&(t=e.activeChartSymbolInfo()?.name),t?{raw:t,binanceSymbol:ne(t)}:{raw:"",binanceSymbol:null}}catch(n){return console.warn("alertapp: readCurrentSymbol \uC2E4\uD328",n),{raw:"",binanceSymbol:null}}}function ne(n){let e=/^BINANCE:([A-Z0-9]+)(\.P)?$/.exec(n);return!e||e[2]===".P"?null:e[1]}function $(n){let e=f().raw,t=!1,r=[];try{let s=w()?.model?.();s&&s.panes().forEach(c=>{c.dataSourcesCollectionChanged&&c.dataSourcesCollectionChanged.subscribe(null,()=>{let p=f();p.raw!==e&&(e=p.raw,n(p))})})}catch{}let a=setInterval(()=>{if(!t)try{let i=f();i.raw!==e&&(e=i.raw,n(i))}catch{}},300);return()=>{t=!0,clearInterval(a),r.forEach(i=>i())}}var re=`
.aa-btn {
  position: fixed;
  right: 16px;
  top: 80px;
  z-index: 99999;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #2a2e39;
  border: 1px solid #363a45;
  color: #d1d4dc;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 8px rgba(0,0,0,.4);
  user-select: none;
  transition: background .15s;
}
.aa-btn:hover { background: #363a45; }
.aa-count {
  position: absolute;
  top: -4px;
  right: -4px;
  background: #f23645;
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  border-radius: 8px;
  padding: 1px 4px;
  line-height: 14px;
  min-width: 14px;
  text-align: center;
}
.aa-panel {
  position: fixed;
  right: 64px;
  top: 80px;
  z-index: 99999;
  width: 320px;
  background: #1e222d;
  border: 1px solid #363a45;
  border-radius: 8px;
  color: #d1d4dc;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  box-shadow: 0 4px 24px rgba(0,0,0,.5);
  display: none;
}
.aa-panel.aa-open { display: block; }
.aa-panel-header {
  padding: 10px 14px;
  border-bottom: 1px solid #363a45;
  font-weight: 600;
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.aa-section {
  padding: 10px 14px;
  border-bottom: 1px solid #2a2e39;
}
.aa-section-title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: #787b86;
  margin-bottom: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  user-select: none;
}
.aa-section-title:hover { color: #d1d4dc; }
.aa-tg-body { display: none; }
.aa-tg-body.aa-open { display: block; }
.aa-input {
  width: 100%;
  box-sizing: border-box;
  background: #2a2e39;
  border: 1px solid #363a45;
  border-radius: 4px;
  color: #d1d4dc;
  padding: 5px 8px;
  font-size: 12px;
  margin-bottom: 6px;
  outline: none;
}
.aa-input:focus { border-color: #2196f3; }
.aa-btn-sm {
  background: #2196f3;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 5px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: background .15s;
}
.aa-btn-sm:hover { background: #1976d2; }
.aa-tg-warn {
  color: #f23645;
  font-size: 11px;
  margin-top: 4px;
}
.aa-alert-list { max-height: 200px; overflow-y: auto; }
.aa-alert-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 0;
  border-bottom: 1px solid #2a2e39;
}
.aa-alert-item:last-child { border-bottom: none; }
.aa-alert-info { flex: 1; font-size: 12px; min-width: 0; }
.aa-alert-sym { font-weight: 600; color: #d1d4dc; }
.aa-alert-dir {
  font-size: 11px;
  color: #787b86;
}
.aa-badge {
  font-size: 10px;
  border-radius: 3px;
  padding: 1px 5px;
  font-weight: 600;
}
.aa-badge-armed { background: #1a3a4a; color: #26a69a; }
.aa-badge-triggered { background: #3a1a1a; color: #f23645; }
.aa-badge-paused { background: #2a2e39; color: #787b86; }
.aa-del-btn {
  background: none;
  border: none;
  color: #787b86;
  cursor: pointer;
  font-size: 15px;
  padding: 0 4px;
  line-height: 1;
  transition: color .15s;
}
.aa-del-btn:hover { color: #f23645; }
.aa-empty { color: #787b86; font-size: 12px; padding: 4px 0; }
.aa-add-section { padding: 10px 14px; }
.aa-add-btn {
  width: 100%;
  background: #26a69a;
  color: #fff;
  border: none;
  border-radius: 4px;
  padding: 7px 0;
  font-size: 13px;
  cursor: pointer;
  transition: background .15s;
}
.aa-add-btn:hover { background: #1d8a7f; }
.aa-dir-dialog {
  position: fixed;
  z-index: 100000;
  background: #1e222d;
  border: 1px solid #363a45;
  border-radius: 8px;
  padding: 14px;
  color: #d1d4dc;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 13px;
  box-shadow: 0 4px 24px rgba(0,0,0,.6);
  display: none;
  min-width: 200px;
}
.aa-dir-dialog.aa-open { display: block; }
.aa-dir-title { font-weight: 600; margin-bottom: 10px; }
.aa-dir-btns { display: flex; gap: 8px; }
.aa-dir-btn {
  flex: 1;
  background: #2a2e39;
  border: 1px solid #363a45;
  border-radius: 4px;
  color: #d1d4dc;
  padding: 7px 0;
  font-size: 12px;
  cursor: pointer;
  transition: background .15s;
  text-align: center;
}
.aa-dir-btn:hover { background: #363a45; }
.aa-dir-cancel {
  margin-top: 8px;
  width: 100%;
  background: none;
  border: none;
  color: #787b86;
  font-size: 12px;
  cursor: pointer;
  padding: 4px 0;
}
.aa-dir-cancel:hover { color: #d1d4dc; }
`,x=!1;function F(n){x&&(document.getElementById("aa-root")?.remove(),document.getElementById("aa-style")?.remove(),x=!1),x=!0;let e=document.createElement("style");e.id="aa-style",e.textContent=re,document.head.appendChild(e);let t=document.createElement("div");t.id="aa-root",document.body.appendChild(t);let r=document.createElement("button");r.className="aa-btn",r.setAttribute("aria-label","\uC54C\uB78C \uC704\uC82F \uC5F4\uAE30"),r.innerHTML='<span style="position:relative;display:inline-flex;align-items:center;justify-content:center">\u{1F514}<span class="aa-count" id="aa-count" style="display:none">0</span></span>',t.appendChild(r);let a=document.createElement("div");a.className="aa-panel",a.id="aa-panel",a.innerHTML=`
    <div class="aa-panel-header">\u{1F514} alertapp</div>

    <div class="aa-section">
      <div class="aa-section-title" id="aa-tg-toggle">
        <span id="aa-tg-arrow">\u25B6</span> Telegram \uC124\uC815
        <span id="aa-tg-warn-icon"></span>
      </div>
      <div class="aa-tg-body" id="aa-tg-body">
        <input class="aa-input" id="aa-tg-token" type="password" placeholder="Bot Token" autocomplete="new-password" />
        <input class="aa-input" id="aa-tg-chat" type="text" placeholder="Chat ID" autocomplete="off" />
        <button class="aa-btn-sm" id="aa-tg-save">\uC800\uC7A5</button>
      </div>
    </div>

    <div class="aa-section">
      <div class="aa-section-title">\uC54C\uB78C \uBAA9\uB85D</div>
      <div class="aa-alert-list" id="aa-alert-list">
        <div class="aa-empty">\uC54C\uB78C \uC5C6\uC74C</div>
      </div>
    </div>

    <div class="aa-add-section">
      <button class="aa-add-btn" id="aa-add-btn">+ Alert \uCD94\uAC00</button>
    </div>
  `,t.appendChild(a);let i=document.createElement("div");i.className="aa-dir-dialog",i.id="aa-dir-dialog",i.innerHTML=`
    <div class="aa-dir-title">\uBC29\uD5A5 \uC120\uD0DD</div>
    <div class="aa-dir-btns">
      <button class="aa-dir-btn" id="aa-dir-above">\uC704\uB85C cross</button>
      <button class="aa-dir-btn" id="aa-dir-below">\uC544\uB798\uB85C cross</button>
    </div>
    <button class="aa-dir-cancel" id="aa-dir-cancel">\uCDE8\uC18C</button>
  `,t.appendChild(i);let s=null,c=!0;function p(o){let l=document.getElementById("aa-count");l&&(o>0?(l.textContent=String(o),l.style.display="block"):l.style.display="none")}function J(o){let l=document.getElementById("aa-alert-list");if(l){if(l.innerHTML="",o.length===0){l.innerHTML='<div class="aa-empty">\uC54C\uB78C \uC5C6\uC74C</div>';return}o.forEach(d=>{let u=document.createElement("div");u.className="aa-alert-item";let S=d.direction==="cross_above"?"\u2191 \uC704\uB85C cross":"\u2193 \uC544\uB798\uB85C cross",K=d.status==="armed"?"aa-badge-armed":d.status==="triggered"?"aa-badge-triggered":"aa-badge-paused",X=d.status==="armed"?"\uB300\uAE30":d.status==="triggered"?"\uBC1C\uD654":"\uC815\uC9C0";u.innerHTML=`
        <div class="aa-alert-info">
          <div class="aa-alert-sym">${P(d.symbol)}</div>
          <div class="aa-alert-dir">${S} | ${P(d.tfLabel)}</div>
        </div>
        <span class="aa-badge ${K}">${X}</span>
        <button class="aa-del-btn" data-id="${P(d.id)}" aria-label="\uC54C\uB78C \uC0AD\uC81C">\u2715</button>
      `,u.querySelector(".aa-del-btn")?.addEventListener("click",()=>{n.onRemoveAlert(d.id).then(()=>m()).catch(console.warn)}),l.appendChild(u)})}}async function B(){try{let o=await n.getTelegramConfig(),l=document.getElementById("aa-tg-warn-icon");if(!o)l&&(l.textContent=" \u26A0\uFE0F");else{l&&(l.textContent="");let d=document.getElementById("aa-tg-token"),u=document.getElementById("aa-tg-chat");d&&(d.placeholder="\uC800\uC7A5\uB428 (\uBCC0\uACBD \uC2DC \uC785\uB825)"),u&&(u.value=o.chatId)}}catch(o){console.warn("alertapp: Telegram \uC124\uC815 \uB85C\uB4DC \uC2E4\uD328",o)}}async function m(){try{let o=await n.getAlerts();J(o),p(o.filter(l=>l.status==="armed").length),await B()}catch(o){console.warn("alertapp: refresh \uC2E4\uD328",o)}}r.addEventListener("click",()=>{a.classList.toggle("aa-open"),a.classList.contains("aa-open")&&m().catch(console.warn)}),document.getElementById("aa-tg-toggle")?.addEventListener("click",()=>{c=!c;let o=document.getElementById("aa-tg-body"),l=document.getElementById("aa-tg-arrow");o&&o.classList.toggle("aa-open",!c),l&&(l.textContent=c?"\u25B6":"\u25BC")}),document.getElementById("aa-tg-save")?.addEventListener("click",()=>{let o=document.getElementById("aa-tg-token"),l=document.getElementById("aa-tg-chat"),d=o?.value?.trim()??"",u=l?.value?.trim()??"";if(!d||!u){alert("Bot Token \uACFC Chat ID \uB97C \uBAA8\uB450 \uC785\uB825\uD574\uC8FC\uC138\uC694.");return}n.onSetTelegramConfig(d,u).then(()=>{o&&(o.value="",o.placeholder="\uC800\uC7A5\uB428 (\uBCC0\uACBD \uC2DC \uC785\uB825)"),B().catch(console.warn)}).catch(S=>{console.warn("alertapp: Telegram \uC800\uC7A5 \uC2E4\uD328",S),alert("\uC800\uC7A5 \uC2E4\uD328. \uCF58\uC194\uC744 \uD655\uC778\uD574\uC8FC\uC138\uC694.")})}),document.getElementById("aa-add-btn")?.addEventListener("click",()=>{try{let o=_();if(o.length===0){alert("\uBA3C\uC800 \uCD94\uC138\uC120\uC744 \uADF8\uB824\uC8FC\uC138\uC694.");return}let l=o[o.length-1];o.length>1&&alert(`\uCD94\uC138\uC120\uC774 ${o.length}\uAC1C \uAC10\uC9C0\uB410\uC2B5\uB2C8\uB2E4. \uAC00\uC7A5 \uCD5C\uADFC \uADF8\uB9B0 \uCD94\uC138\uC120\uC744 \uC0AC\uC6A9\uD569\uB2C8\uB2E4.`),s=l.id;let d=document.getElementById("aa-dir-dialog");if(d){d.classList.add("aa-open");let u=a.getBoundingClientRect();d.style.top=`${u.bottom+8}px`,d.style.right="16px"}}catch(o){console.warn("alertapp: Alert \uCD94\uAC00 \uC2E4\uD328",o)}});function A(){document.getElementById("aa-dir-dialog")?.classList.remove("aa-open"),s=null}return document.getElementById("aa-dir-above")?.addEventListener("click",()=>{A(),n.onAddAlert().then(()=>m()).catch(console.warn)}),document.getElementById("aa-dir-below")?.addEventListener("click",()=>{A(),n.onAddAlert().then(()=>m()).catch(console.warn)}),document.getElementById("aa-dir-cancel")?.addEventListener("click",A),m().catch(console.warn),{destroy(){t.remove(),e.remove(),x=!1},async refresh(){await m()}}}function P(n){return n.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function M(n,e,t){let r=e.time-n.time;if(r===0)return NaN;let a=(e.price-n.price)/r;return n.price+a*(t-n.time)}function U(n,e,t){if(n.symbol!==t.symbol)return{triggered:!1,linePrice:NaN,reason:"wrong_symbol"};if(n.status!=="armed")return{triggered:!1,linePrice:M(n.p1,n.p2,t.ts),reason:"paused"};if(e===null)return{triggered:!1,linePrice:M(n.p1,n.p2,t.ts),reason:"no_change"};let r=M(n.p1,n.p2,t.ts);if(isNaN(r))return{triggered:!1,linePrice:NaN,reason:"no_change"};let a=e.price,i=t.price;if(n.direction==="cross_above"){if(a<r&&i>=r)return{triggered:!0,linePrice:r,reason:"cross_above"}}else if(a>r&&i<=r)return{triggered:!0,linePrice:r,reason:"cross_below"};return{triggered:!1,linePrice:r,reason:"no_change"}}var ae="https://api.telegram.org";var j="...";function ie(n){return n.length<=4096?n:n.slice(0,4096-j.length)+j}function oe(n,e,t){let r={chat_id:n.chatId,text:ie(e)};return t?.parseMode&&t.parseMode!=="plain"&&(r.parse_mode=t.parseMode),r}function se(n,e){return new Promise(t=>{GM_xmlhttpRequest({method:"POST",url:n,headers:{"Content-Type":"application/json"},data:e,onload(r){try{let a=r.status;a>=200&&a<300?t({ok:!0,status:a}):t({ok:!1,status:a,error:`http_${a}`})}catch{t({ok:!1,error:"gm_parse_error"})}},onerror(r){t({ok:!1,status:r.status,error:"gm_network_error"})}})})}async function le(n,e){let r=(await globalThis.fetch(n,{method:"POST",headers:{"Content-Type":"application/json"},body:e})).status;return r>=200&&r<300?{ok:!0,status:r}:{ok:!1,status:r,error:`http_${r}`}}async function V(n,e,t){if(!n.botToken)return{ok:!1,error:"missing_token"};if(!n.chatId)return{ok:!1,error:"missing_chat_id"};let r=`${ae}/bot${n.botToken}/sendMessage`,a=JSON.stringify(oe(n,e,t));try{return typeof GM_xmlhttpRequest<"u"?await se(r,a):await le(r,a)}catch(i){return{ok:!1,error:`network_error: ${i instanceof Error?i.message:String(i)}`}}}var k=class{_ws;_onTrigger;_prevTick=new Map;_handlers=new Map;constructor(e){this._ws=e.ws,this._onTrigger=e.onTrigger}async start(){let e=await g();for(let t of e.alerts)t.status==="armed"&&this.subscribe(t)}subscribe(e){if(this._handlers.has(e.id))return;let t=r=>{this._onTick(e,r)};this._handlers.set(e.id,t),this._ws.subscribe(e.symbol,t)}unsubscribe(e){let t=this._handlers.get(e.id);t&&(this._handlers.delete(e.id),this._ws.unsubscribe(e.symbol,t))}stop(){for(let[e]of this._handlers){let t=this._handlers.get(e)}this._handlers.clear(),this._prevTick.clear(),this._ws.close()}_onTick(e,t){let r=this._prevTick.get(t.symbol)??null,a=U(e,r,t);this._prevTick.set(t.symbol,t),a.triggered&&this._handleTrigger(e,t).catch(()=>{})}async _handleTrigger(e,t){let r=Date.now();await N(e.id,{status:"triggered",triggeredAt:r}),this.unsubscribe(e);let a=await v();if(a){let s=e.direction==="cross_above"?"\uC704\uB85C cross":"\uC544\uB798\uB85C cross",c=t.price.toLocaleString(),p=`[alertapp] ${e.symbol} \uC54C\uB78C \uBC1C\uD654
\uBC29\uD5A5: ${s}
\uBC1C\uD654 \uAC00\uACA9: ${c}
\uC2DC\uAC01: ${new Date(r).toLocaleString("ko-KR")}`;await V(a,p)}let i={...e,status:"triggered",triggeredAt:r};this._onTrigger?.(i,t)}};function de(){return typeof GM_setValue=="function"&&typeof GM_getValue=="function"&&typeof GM_xmlhttpRequest=="function"}var b=null,h=null,I=null;function ce(){b?.stop(),h?.destroy(),I?.(),b=null,h=null,I=null}async function pe(){if(!de()){console.warn("alertapp: Tampermonkey GM API \uBBF8\uC874\uC7AC. \uC2A4\uD06C\uB9BD\uD2B8\uB97C \uC885\uB8CC\uD569\uB2C8\uB2E4.");return}try{await z()}catch{alert("alertapp: TradingView \uCC28\uD2B8 \uB85C\uB4DC\uB97C \uAE30\uB2E4\uB9AC\uB2E4 \uC2DC\uAC04 \uCD08\uACFC\uB410\uC2B5\uB2C8\uB2E4. \uD398\uC774\uC9C0\uB97C \uC0C8\uB85C\uACE0\uCE68\uD574 \uC8FC\uC138\uC694.");return}let n=G();b=new k({ws:n,onTrigger:(e,t)=>{h?.refresh().catch(console.warn)}}),await b.start(),h=F({async onAddAlert(){let e=_();if(e.length===0){alert("\uBA3C\uC800 \uCD94\uC138\uC120\uC744 \uADF8\uB824\uC8FC\uC138\uC694.");return}let t=e[e.length-1],r=f();if(!r.binanceSymbol){alert(`alertapp: Binance Spot \uC2EC\uBCFC\uC744 \uC778\uC2DD\uD558\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.
BINANCE:BTCUSDT \uD615\uC2DD\uC758 \uCC28\uD2B8\uC5D0\uC11C \uC0AC\uC6A9\uD574\uC8FC\uC138\uC694.`);return}let i=window.confirm(`\uC704\uB85C cross \uC54C\uB78C\uC744 \uBC1B\uC73C\uC2DC\uACA0\uC5B4\uC694?
(\uD655\uC778 = \uC704\uB85C cross, \uCDE8\uC18C = \uC544\uB798\uB85C cross)`)?"cross_above":"cross_below",s={id:crypto.randomUUID(),symbol:r.binanceSymbol,exchange:"binance",tfLabel:"\u2013",p1:t.p1,p2:t.p2,direction:i,status:"armed",createdAt:Date.now(),triggeredAt:null};await O(s),b?.subscribe(s)},async onRemoveAlert(e){let r=(await g()).alerts.find(a=>a.id===e);r&&b?.unsubscribe(r),await W(e)},async onSetTelegramConfig(e,t){await D({botToken:e,chatId:t}),console.info("alertapp: Telegram \uC124\uC815\uC774 \uC800\uC7A5\uB410\uC2B5\uB2C8\uB2E4.")},async getAlerts(){return(await g()).alerts},async getTelegramConfig(){return v()}}),I=$(e=>{h?.refresh().catch(console.warn)}),window.addEventListener("beforeunload",ce)}pe().catch(n=>{console.error("alertapp: main() \uC624\uB958",n)});})();
