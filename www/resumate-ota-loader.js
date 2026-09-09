/* ResuMate OTA loader patch: top chrome is intentionally native-only. */
(function () {
  'use strict';
  var RAW_ROOT='https://raw.githubusercontent.com/gba45684-lab/ResuMate/';
  var VERSION_URL=RAW_ROOT+'main/ota/version.json';
  var POLL_MS=3000;
  function chromeFix(){
    try{
      var s=document.getElementById('resumate-ui-chrome-fix')||document.createElement('style');
      s.id='resumate-ui-chrome-fix';
      s.textContent='html,body{margin:0!important;padding:0!important;min-height:100%;}body>*:first-child{margin-top:0!important;padding-top:0!important;}#resumate-ota-control{display:none!important;visibility:hidden!important;pointer-events:none!important;}[id*=status-bar],[id*=statusBar],[class*=status-bar],[class*=statusBar]{display:none!important;}';
      (document.head||document.documentElement).appendChild(s);
      var v=document.querySelector('meta[name="viewport"]');
      if(v){var c=v.getAttribute('content')||'';c=c.replace(/,?\s*viewport-fit\s*=\s*cover/ig,'');v.setAttribute('content',c);}
    }catch(e){}
  }
  function hideOta(){try{var e=document.getElementById('resumate-ota-control');if(e)e.remove();}catch(e){}}
  function fetchManifest(){return fetch(VERSION_URL+'?t='+Date.now(),{cache:'no-store',credentials:'omit'}).then(function(r){if(!r.ok)throw Error('manifest '+r.status);return r.json();});}
  function start(){chromeFix();hideOta();setInterval(function(){chromeFix();hideOta();},1000);window.ResuMateOTA=window.ResuMateOTA||{check:function(){return fetchManifest();},isEnabled:function(){return true;},setEnabled:function(){return true;},testRing:function(){try{if(navigator.vibrate)navigator.vibrate([160,80,160,80,220]);}catch(e){}},status:function(){return window.__RESUMATE_OTA__||null;}};}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
