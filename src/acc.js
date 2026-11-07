'use strict';
// ============================================================================
// kgacc v10-portable — 全民K歌 TV 伴唱/原唱实时切换
// 可移植改造（相对 v9）：
//   1) 包名不写死 —— 自动取当前进程包名
//   2) 目录可覆盖 —— $KGACC_DIR > /data/local/tmp/kg > /data/local/tmp/kgacc > app私有目录
//   3) 类名走候选表 —— 混淆名变了只需在 CLASSES 里加一行
//   4) 触发键可配 —— acc_key 文件写 keyCode；连按次数/时间窗可调
//   5) 槽位语义可反转 —— CFG.SLOT_ACC / SLOT_ORI
// 所有探测都在 Java 可用后进行，不在顶层碰 Java。
// ============================================================================
var CFG = {
  PKG: '',
  DIR: '/data/local/tmp/kg',
  TRIG_KEYS: [82, 176, 111],
  TRIG_N: 3,
  TRIG_WINDOW: 2500,
  SLOT_ACC: 0,
  SLOT_ORI: 1
};

var CLASSES = {
  speaker:  ['ksong.support.audio.AudioSpeaker'],
  songInfo: ['com.tencent.qqmusicsdk.protocol.SongInformation'],
  songModel:['ksong.support.models.song.SongInfoModel'],
  player:   ['com.tencent.qqmusicsdk.player.a'],
  ktvEntry: ['com.tencent.karaoketv.common.e.j'],
  fragment: ['com.tencent.karaoketv.module.karaoke.ui.KaraokePlayerFragment']
};
var _RC = {};
function J(k){
  if (_RC[k] !== undefined) return _RC[k];
  var list = CLASSES[k] || [k];
  for (var i=0;i<list.length;i++){
    try{ var c = Java.use(list[i]); _RC[k] = c; return c; }catch(e){}
  }
  _RC[k] = null; return null;
}
function JN(k){
  var list = CLASSES[k] || [k];
  for (var i=0;i<list.length;i++){
    try{ Java.use(list[i]); return list[i]; }catch(e){}
  }
  return null;
}

// kgacc v9 - portable accompany + FireEye kill interception
// core fix: hook libc kill/tgkill to block FireEye self-kill (SI_USER)
// 目录解析：惰性，第一次用时才碰 Java
var D = '/data/local/tmp/kg';
var _dirReady = false;
function ensureDir(){
  if (_dirReady) return D;
  _dirReady = true;
  var cands = [];
  try{ var e = Java.use('java.lang.System').getenv('KGACC_DIR'); if (e) cands.push(String(e)); }catch(err){}
  // 集成模式：读引导脚本留下的目录标记（getenv 在 nohup 子进程里不可靠）
  try{
    var RF = Java.use('java.io.File');
    var mk = RF.$new('/data/local/tmp/kgacc_dir');
    if (mk.exists()){
      var fis0 = Java.use('java.io.FileInputStream').$new(mk);
      var b0 = Java.array('byte', new Array(256).fill(0));
      var n0 = fis0.read(b0); fis0.close();
      var t0 = '';
      for (var q0=0;q0<n0;q0++){ if (b0[q0]===0||b0[q0]===10||b0[q0]===13) break; t0 += String.fromCharCode(b0[q0]); }
      if (t0) cands.push(t0);
    }
  }catch(err){}
  // 集成模式优先：应用私有目录（无 root 也能写）
  try{
    var ctx0 = Java.use('android.app.ActivityThread').currentApplication();
    if (ctx0){
      var fd = ctx0.getFilesDir();
      if (fd) cands.push(String(fd.getAbsolutePath()) + '/kgacc');
      var cd0 = ctx0.getCacheDir();
      if (cd0) cands.push(String(cd0.getAbsolutePath()) + '/kgacc');
    }
  }catch(err){}
  cands.push('/data/local/tmp/kg');
  cands.push('/data/local/tmp/kgacc');
  if (CFG.DIR) cands.unshift(CFG.DIR);
  for (var i=0;i<cands.length;i++){
    try{
      var F0 = Java.use('java.io.File');
      var d0 = F0.$new(cands[i]);
      if (!d0.exists()) d0.mkdirs();
      var pr = F0.$new(cands[i]+'/.w');
      var fo = Java.use('java.io.FileOutputStream').$new(pr);
      fo.write(Java.array('byte',[65])); fo.close(); pr.delete();
      D = cands[i]; MODE_FILE = D+'/acc_mode'; LOG_FILE = D+'/acc_v9.log'; STATE_FILE = D+'/acc_state';
      return D;
    }catch(err){}
  }
  return D;
}
function detectPkg(){
  try{ var c = Java.use('android.app.ActivityThread').currentPackageName(); if (c) CFG.PKG = String(c); }catch(e){}
  return CFG.PKG;
}
var MODE_FILE=D+'/acc_mode', LOG_FILE=D+'/acc_v9.log', STATE_FILE=D+'/acc_state';
var gMode=null, gModeTs=0, gHits=0, gVid=0, gLastLog=0, gPlaying=false, gBlocked=0;
function now(){return Date.now();}
function curSrcInfo(){
  try{
    var SP = null;
    try{ SP = J('speaker'); }catch(e){ return 'nospk'; }
    var sp = null;
    try{ sp = SP.getCurrentWorkingSpeaker.overload().call(SP); }catch(e){ return 'getfail'; }
    if (!sp || sp.isNull()) return 'none';
    var cs = fld(sp, 'currentSource');
    if (!cs) return 'nocursrc';
    var idx = '?';
    try{
      var list = fld(sp, 'sources');
      if (list){
        var n = parseInt(String(list.size()));
        for (var i=0;i<n;i++){
          try{ if (list.get(i).equals(cs)){ idx = String(i); break; } }catch(e){}
        }
      }
    }catch(e){}
    return 'idx'+idx;
  }catch(e){ return 'E'; }
}
function pickOriFile(){
  var found = null;
  try{
    Java.choose(JN('songInfo') || 'com.tencent.qqmusicsdk.protocol.SongInformation', {
      onMatch: function(si){
        if (found) return;
        try{
          var p = si.getOriginalAudioFilePath();
          if (p){
            var ss = String(p);
            if (ss && ss!=='null' && ss.length>5){
              var FF = Java.use('java.io.File');
              var ff = FF.$new(ss);
              if (ff.exists()) found = ff;
            }
          }
        }catch(e){}
      },
      onComplete: function(){}
    });
  }catch(e){}
  return found;
}
function pickAccFile(){
  var found = null;
  try{
    Java.choose(JN('songInfo') || 'com.tencent.qqmusicsdk.protocol.SongInformation', {
      onMatch: function(si){
        if (found) return;
        try{
          var p = si.getAccompanyAudioFilePath();
          if (p){
            var ss = String(p);
            if (ss && ss!=='null' && ss.length>5){
              var FF = Java.use('java.io.File');
              var ff = FF.$new(ss);
              if (ff.exists()) found = ff;
            }
          }
        }catch(e){}
      },
      onComplete: function(){}
    });
  }catch(e){}
  return found;
}
function srcLenOf(o){
  try{ return String(o.getLength()); }catch(e){ return 'e'; }
}
function srcFileOf(o){
  if (!o) return 'null';
  // 优先用 getSourceFile（公开方法），失败则退到 getAudioInfo（返回 String，一定可调）
  try{
    var ff = o.getSourceFile();
    if (ff){
      var p = String(ff.getAbsolutePath());
      var i = p.lastIndexOf('/');
      return (i>=0? p.substring(i+1) : p);
    }
  }catch(e1){}
  try{
    var info = String(o.getAudioInfo());
    if (info && info !== 'null'){
      // getAudioInfo 里通常含文件名，截取 Audio_ 开头的片段
      var m = info.match(/Audio_[A-Z]{3}_id@[A-Za-z0-9]+/);
      if (m) return m[0];
      return info.substring(0, 40);
    }
  }catch(e2){ return 'e2:'+e2; }
  return 'unk';
}
function minimalMode(){
  try{ var F=Java.use('java.io.File'); return F.$new(D+'/acc_minimal').exists(); }catch(e){ return false; }
}
function nopatch(){
  try{ var F=Java.use('java.io.File'); return F.$new(D+'/acc_nopatch').exists(); }catch(e){ return false; }
}
function refetching(){
  try{ var F=Java.use('java.io.File'); return F.$new(D+'/acc_refetch').exists(); }catch(e){ return false; }
}
function shortName(p){
  try{
    if(!p) return 'null';
    var s=String(p);
    if(s==='null'||s.length<5) return 'null';
    var i=s.lastIndexOf('/');
    return i>=0 ? s.substring(i+1) : s;
  }catch(e){ return '?'; }
}
function klog(m){try{var F=Java.use('java.io.File');var fos=Java.use('java.io.FileOutputStream').$new(F.$new(LOG_FILE),true);var s=(new Date().toISOString())+' '+m+'\n';var b=Java.array('byte',s.split('').map(function(c){return c.charCodeAt(0)&0xff;}));fos.write(b);fos.close();}catch(e){}}

// ============ PART 1: native kill interception (run immediately) ============
(function(){
  function sym(mod, name){ try { return Process.getModuleByName(mod).getExportByName(name); } catch(e){ return null; } }
  var SIGBLOCK = [9, 6, 11, 15, 3, 4, 5, 7, 8];  // KILL ABRT SEGV TERM QUIT ILL TRAP BUS FPE
  function shouldBlockSelf(tgid, sig){
    return (tgid === Process.id) && (SIGBLOCK.indexOf(sig) >= 0);
  }
  // --- kill(pid, sig) ---
  var kp = sym('libc.so','kill');
  if (kp) {
    Interceptor.attach(kp, {
      onEnter: function(a){
        var pid = a[0].toInt32(), sig = a[1].toInt32();
        if (shouldBlockSelf(pid, sig)) {
          this.blk = true;
          gBlocked++;
          var bt = '';
          try { bt = Thread.backtrace(this.context, Backtracer.ACCURATE).slice(0,4).map(function(x){ return DebugSymbol.fromAddress(x).toString(); }).join(' <- '); } catch(e){}
          klog('[BLOCK] kill(self,'+sig+') n='+gBlocked+' bt='+bt);
        }
      },
      onLeave: function(r){ if (this.blk) { try { r.replace(0); } catch(e){} } }
    });
    klog('kill hooked');
  } else { klog('kill NOT FOUND'); }
  // --- tgkill(tgid, tid, sig) ---
  var tk = sym('libc.so','tgkill');
  if (tk) {
    Interceptor.attach(tk, {
      onEnter: function(a){
        var tg = a[0].toInt32(), sig = a[2].toInt32();
        if (shouldBlockSelf(tg, sig)) { this.blk = true; gBlocked++; klog('[BLOCK] tgkill(self,'+sig+') n='+gBlocked); }
      },
      onLeave: function(r){ if (this.blk) { try { r.replace(0); } catch(e){} } }
    });
    klog('tgkill hooked');
  }
  // raise / pthread_kill 同样必须带来源判定，否则会吞掉框架自身的信号
  function fromFireEye(ctx){
    try{
      var bt = Thread.backtrace(ctx, Backtracer.FUZZY);
      for (var i=0;i<bt.length && i<8;i++){
        var s = '';
        try{ s = DebugSymbol.fromAddress(bt[i]).toString(); }catch(e){}
        if (s.indexOf('FireEye') >= 0 || s.indexOf('jiagu') >= 0) return true;
      }
    }catch(e){}
    return false;
  }
  var rp = sym('libc.so','raise');
  if (rp) {
    Interceptor.attach(rp, {
      onEnter: function(a){
        var sig=a[0].toInt32();
        if (SIGBLOCK.indexOf(sig)>=0 && fromFireEye(this.context)) { this.blk=true; gBlocked++; klog('[BLOCK] raise('+sig+')FE'); }
      },
      onLeave: function(r){ if (this.blk) { try { r.replace(0); } catch(e){} } }
    });
    klog('raise hooked (FireEye-only)');
  }
  var pk = sym('libc.so','pthread_kill');
  if (pk) {
    Interceptor.attach(pk, {
      onEnter: function(a){
        var sig=a[1].toInt32();
        if (SIGBLOCK.indexOf(sig)>=0 && fromFireEye(this.context)) { this.blk=true; gBlocked++; klog('[BLOCK] pthread_kill('+sig+')FE'); }
      },
      onLeave: function(r){ if (this.blk) { try { r.replace(0); } catch(e){} } }
    });
    klog('pthread_kill hooked (FireEye-only)');
  }
  // --- abort() / _exit() / exit() ---
  // abort/_exit/exit 必须带来源判定！
  // 事故：之前无条件拦截导致 Frida agent 自己的 abort() 也被吞，
  //      agent 卡在"已结束但不退出"状态 -> 心跳 setInterval 与所有定时器停摆。
  //      日志铁证：[BLOCK] abort() call 之后 acc_state 再没更新过。
  // 现在只在调用栈里出现 libFireEye / jiagu 时才拦。
  ['abort','_exit','exit'].forEach(function(n){
    var p = sym('libc.so', n);
    if (p) {
      Interceptor.attach(p, {
        onEnter: function(a){
          var fromFE = false;
          try{
            var bt = Thread.backtrace(this.context, Backtracer.FUZZY);
            for (var i=0;i<bt.length && i<8;i++){
              var s = '';
              try{ s = DebugSymbol.fromAddress(bt[i]).toString(); }catch(e){}
              if (s.indexOf('FireEye') >= 0 || s.indexOf('jiagu') >= 0 || s.indexOf('jiagui') >= 0){ fromFE = true; break; }
            }
          }catch(e){}
          if (fromFE){ this.blk = true; gBlocked++; klog('[BLOCK] '+n+'(FireEye)'); }
        },
        onLeave: function(r){ if (this.blk) { try { r.replace(0); } catch(e){} } }
      });
      klog(n+' hooked (FireEye-only)');
    }
  });
  klog('=== native interception armed ===');
})();

function readMode(){var t=now();if(gMode!==null&&t-gModeTs<1500)return gMode;gModeTs=t;try{var F=Java.use('java.io.File');var f=F.$new(MODE_FILE);if(!f.exists()){gMode='acc';return gMode;}var fis=Java.use('java.io.FileInputStream').$new(f);var buf=Java.array('byte',[0,0,0,0,0,0,0,0]);var n=fis.read(buf);fis.close();var s='';for(var i=0;i<n;i++)s+=String.fromCharCode(buf[i]);gMode=(s.indexOf('ori')>=0)?'ori':'acc';}catch(e){gMode='acc';}return gMode;}
function writeMode(m){try{var F=Java.use('java.io.File');var fos=Java.use('java.io.FileOutputStream').$new(F.$new(MODE_FILE));var b=Java.array('byte',m.split('').map(function(c){return c.charCodeAt(0);}));fos.write(b);fos.close();gMode=m;gModeTs=now();klog('mode -> '+m);}catch(e){}}

function markPlaying(src){ if(!gPlaying){ gPlaying=true; klog('PLAYBACK started ('+src+')'); } }

Java.perform(function(){
  try{
    var AS=J('speaker');
    var ds=AS.setDataSources.overload('[Ljava.io.File;');
    ds.implementation=function(arr){ markPlaying('setDataSources'); return ds.call(this,arr); };
    klog('detector: AudioSpeaker');
  }catch(e){klog('detector AS fail');}
  // playback detector: correct player class (obfuscated as qqmusicsdk.player.a)
  try{
    var PL=J('player');
    var ctors=PL.$init.overloads;
    klog('player.a ctors='+ctors.length);
    for(var ci=0;ci<ctors.length;ci++){
      (function(idx){
        var o=ctors[idx];
        o.implementation=function(){
          try{ markPlaying('player.a.ctor#'+idx); }catch(e){}
          return o.apply(this, arguments);
        };
      })(ci);
    }
    klog('detector: player.a ctor hooked x'+ctors.length);
  }catch(e){ klog('detector player.a fail: '+e.message); }
  // fallback: KaraokePlayerFragment onResume (weaker signal)
  try{
    var KF=J('fragment');
    try{ var onR=KF.onResume.overload(); onR.implementation=function(){ klog('KF.onResume (page opened)'); return onR.call(this); }; }catch(e){}
    try{ var onP=KF.onPause.overload(); onP.implementation=function(){ if(gPlaying){gPlaying=false;klog('KF.onPause -> play=false');} return onP.call(this); }; }catch(e){}
    klog('detector: KaraokePlayerFragment (page-level only)');
  }catch(e){klog('detector KF fail');}

  // 视频轨屏蔽：v14 起关闭（曾导致启动页卡死 + 播放异常），只保留计数
  var vHooked=0;
  // v17：重新启用视频轨屏蔽，但严格门控 —— 只在"正在播放 且 acc 模式 且 非 refetch"时返回 null。
  // 依据：AudioVideoPlayer 日志 A_PTS/V_PTS 同步推进，证明 MV 模式下声音来自视频内嵌音轨。
  //       app 启动/点歌台阶段 gPlaying=false，不受影响（之前卡死就是因为没门控）。
  function vqBlock(){ return readMode()==='acc' && gPlaying && !refetching(); }
  try{
    var SIv = J('songInfo');
    var gv = SIv.getVideoFilePath.overload();
    var ov = gv;
    gv.implementation = function(){
      if (vqBlock()){
        var r0 = null;
        try{ r0 = ov.call(this); }catch(e){}
        if (r0 && String(r0).length > 5){
          gVid++;
          if (now()-gLastLog > 2500){ gLastLog=now(); klog('VIDEO->null vid='+gVid); }
          return null;
        }
      }
      return gv.call(this);
    };
    vHooked++;
  }catch(e){ klog('vid hook fail '+e); }
  try{
    var SMv = J('songModel');
    var gv2 = SMv.getVideoFilePath.overload();
    var ov2 = gv2;
    gv2.implementation = function(){
      if (vqBlock()){
        var r1 = null;
        try{ r1 = ov2.call(this); }catch(e){}
        if (r1 && String(r1).length > 5) return null;
      }
      return gv2.call(this);
    };
    vHooked++;
  }catch(e){}

  klog('video hooks='+vHooked);

  function accPathOf(o){try{var p=o.getAccompanyAudioFilePath();if(!p)return null;var s=String(p);if(!s||s==='null'||s.length<5)return null;var F=Java.use('java.io.File');return F.$new(s).exists()?s:null;}catch(e){return null;}}
  function accUrlOf(o){try{var u=o.getAccompanyAudioUrl();if(!u)return null;var s=String(u);return (s&&s!=='null'&&s.length>10)?s:null;}catch(e){return null;}}

  // ===== v13.4 关键整改：只在「播放器装配音轨」调用栈里替换 =====
  // 事故记录：早期无条件替换导致 ORI 存档被写坏。
  //   getOriginalAudioFilePath() 不只用于播放装配，还被
  //   com.tencent.karaoketv.module.karaoke.business.g.getSwitchKSongModeCapabilities
  //   用来判断"原唱文件是否存在"（FileUtils.isValidFile）。
  //   我的 hook 让它返回伴奏且 exists()=true → K歌认为原唱已就绪 → 不下载真原唱
  //   → 下载器把伴奏内容写进 Audio_ORI_* 存档位置
  //   → 实测 md5 完全相同的铁证：
  //       ACC@003JlGr 935f168f... = ORI@002ZvYO 935f168f...
  //       ACC@001fWY0 a893df40... = ORI@0046QAj a893df40...
  // 现在改为调用栈白名单：只有栈里出现播放器装配类才替换，其余一律返回真原唱。
  // 用 Java 栈判定（Thread.backtrace 只能看到 native 栈，拿不到 Java 帧）
  // 只在栈里出现"播放器装配"类时才替换；下载/能力判定路径一律返回真原唱。
  var ASSEMBLY_STACK = [
    'support.audio',          // AudioSpeaker / M4AAudioSource / AudioSource
    'qqmusicsdk.player',      // 播放器
    'common.media.m',         // 音轨装配入口 e()/g()
    'AudioVideoPlayer',
    'AimAudioPlayer'
  ];
  // 明确排除：这些类的调用一律不替换（下载器 / 能力判定 / 练习页 / 缓存管理）
  var EXCLUDE_STACK = [
    'getSwitchKSongModeCapabilities',
    'getSwitchModeCapabilities',
    'LocalMusicInfoCacheData',
    'download',
    'Download',
    'practice',                // 练习页
    'Practice'
  ];
  var gStackSeen = {};
  function javaStack(){
    try{
      var T = Java.use('java.lang.Throwable');
      var t = T.$new();
      var arr = t.getStackTrace();
      var out = [];
      for (var i=0;i<arr.length;i++){ try{ out.push(String(arr[i].toString())); }catch(e){} }
      return out;
    }catch(e){ return []; }
  }
  function inAssembly(){
    var st = javaStack();
    if (!st.length) return false;
    var joined = st.join('\n');
    // 先看排除项：命中就绝不替换
    for (var k=0;k<EXCLUDE_STACK.length;k++){
      if (joined.indexOf(EXCLUDE_STACK[k]) >= 0){
        if (!gStackSeen['EX:'+EXCLUDE_STACK[k]]){ gStackSeen['EX:'+EXCLUDE_STACK[k]]=1; klog('SKIP(exclude) '+EXCLUDE_STACK[k]); }
        return false;
      }
    }
    for (var j=0;j<ASSEMBLY_STACK.length;j++){
      if (joined.indexOf(ASSEMBLY_STACK[j]) >= 0) return true;
    }
    return false;
  }

  // ===== 修复工具：acc_refetch 开关 =====
  // 存在该文件时，getOriginalAudioFilePath() 一律返回真原唱（不替换），
  // 用于让 K歌 重新下载真正的原唱音轨，修复被污染成 ACC 的 ORI 存档。

  // ===== v14：getOriginalAudioFilePath / Url 只观测，绝不替换 =====
  // 事故总结：任何"改写 getter 返回值"的方案都会污染 ORI 存档
  //   （business.g.getSwitchKSongModeCapabilities 拿它判原唱是否存在，
  //    返回伴奏 -> isValidFile(伴奏)=true -> 不下载真原唱 -> 伴奏被写进 ORI 位）
  // 而且它在运行时切轨场景根本不生效（[DS] 不再重建）。
  // 正解是 player.a.c(ZZ)Z -> switchToSource(IZ)，见 nativeSwitch()。
  // 这里保留 hook 仅用于观测当前装配到的是哪条轨。
  var aHooked=0;
  function obsAcc(cls,tag){
    try{
      var C=Java.use(cls);
      var p=C.getOriginalAudioFilePath.overload();
      p.implementation=function(){
        var r = p.call(this);
        try{
          // 绝不改写 getter：改写会让 K歌 以为原唱就是伴奏，
          // 结果不再下载真原唱，ORI 槽被伴奏覆盖 -> 永远切不出原唱。
          if(now()-gLastLog>4000){
            gLastLog=now();
            var a=null; try{ a=accPathOf(this); }catch(e){}
            klog('OBS['+tag+'] ori='+shortName(r)+' acc='+shortName(a)+' mode='+readMode());
          }
        }catch(e){}
        return r;
      };
      aHooked++;
    }catch(e){klog('obs hook '+tag+' fail');}
  }
  obsAcc('ksong.support.models.song.SongInfoModel','SIM');
  obsAcc('com.tencent.qqmusicsdk.protocol.SongInformation','SI');
  klog('acc hooks='+aHooked);

  // ===== 观测 setDataSources：判断装配是否真的发生 =====
  try{
    var ASP9 = J('speaker');
    var ovs9 = ASP9.setDataSources.overloads;
    for (var oi9=0; oi9<ovs9.length; oi9++){
      (function(o){
        o.implementation = function(){
          try{
            var a0 = arguments[0];
            var n9 = a0 ? parseInt(String(a0.length)) : -1;
            if (n9 > 0){
              var pp = [];
              for (var q9=0;q9<n9;q9++){
                var it9 = a0[q9];
                var s9 = 'null';
                try{ var ap9 = String(it9.getAbsolutePath()); s9 = ap9.substring(ap9.lastIndexOf('/')+1).replace('Audio_','').replace('_id@',':'); }catch(e){}
                pp.push(s9);
              }
              klog('DS-IN n='+n9+' :: '+pp.join(' , ')+' mode='+readMode());
            }
          }catch(e){}

          // ===== 强制装配 [ACC, ORI] =====
          // 两槽必须是不同文件，switchToSource(0/1) 才能切出伴唱/原唱。
          // K歌 有时会装 [ORI,ORI] 或 [ACC,ACC]，那种情况切槽无效。
          var patched9 = null;
          try{
            var n09 = arguments[0] ? parseInt(String(arguments[0].length)) : 0;
            if (n09 >= 2){
              var accF9 = pickAccFile(), oriF9 = pickOriFile();
              if (accF9 && oriF9){
                patched9 = Java.array('java.io.File', [accF9, oriF9]);
                klog('DS-FORCE [ACC,ORI]');
              }
            }
          }catch(e){ klog('DS force fail '+e); }

          if (patched9){
            var args9 = Array.prototype.slice.call(arguments);
            args9[0] = patched9;
            return o.apply(this, args9);
          }
          return o.apply(this, arguments);
        };
      })(ovs9[oi9]);
    }
    klog('DS hooked x'+ovs9.length);
  }catch(e){ klog('DS hook fail '+e); }
});

// ===== 按键触发 v12: 音量键不走 dispatchKeyEvent，改走 VOLUME_CHANGED_ACTION 广播 =====
var gVolN=0, gVolLast=-1, gVolBurst=0, gVolTs=0, gVolN_raw=0;
var gDown=0, gWinT=0, gWinBase=-1, gCool=0, gAtWrites=0, gAtLastStack='', gSpkWrites=0, gAtSeen=0, gSrcMade=0, gPcmFp=0, gPwWrites=0, gGsfLog=0;
// ===== 切轨：只调 K歌 原生入口 j.a(playOriginal,false,cause) =====
// 依据：第三轮实测「连按3下成功切换原声」，当时走的就是这条路径。
// 后续加的 sources.clear() 重装配会破坏 SetDataSource 状态机，已移除。
// getter 侧由 acc_minimal 开关控制：acc 时返回伴奏路径，ori 时透传原唱。
// 取当前播放位置(ms)：遍历活动播放器找 getCurrentPosition
// 恢复播放：start() + 必要时 seek 回原位置
function resumePlay(ms){
  try{
    var P = J('player');
    var n = 0;
    Java.choose(JN('player') || 'com.tencent.qqmusicsdk.player.a', {
      onMatch: function(o){
        n++;
        // 枚举可用的播放控制方法
        if (n === 1){
          var cands = ['start','play','resume','c','d','b','e','a'];
          var ok = [];
          for (var i=0;i<cands.length;i++){
            try{
              var m = o[cands[i]];
              if (m) ok.push(cands[i]+'/'+(m.overloads?m.overloads.length:1));
            }catch(e){}
          }
          klog('RB methods: '+ok.join(' '));
        }
        // 尝试无参 start / play
        try{ o.start(); klog('RB start() ok'); }
        catch(e1){
          try{ o.play(); klog('RB play() ok'); }
          catch(e2){
            try{ o.c(); klog('RB c() ok'); }
            catch(e3){ klog('RB no-play-method'); }
          }
        }
        try{ if (ms > 0) o.seekTo(parseInt(String(ms))); }catch(e){}
      },
      onComplete: function(){ klog('RB resumePlay objs='+n+' pos='+ms); }
    });
  }catch(e){ klog('RB resume fail '+e); }
}

function getPlayerPosMs(){
  var out = -1;
  try{
    var P = J('player');
    Java.choose(JN('player') || 'com.tencent.qqmusicsdk.player.a', {
      onMatch: function(o){
        if (out > 0) return;
        var names = ['getCurrentPosition','getPosition','l','m','n','k'];
        for (var i=0;i<names.length;i++){
          try{
            var v = o[names[i]]();
            var x = parseInt(String(v));
            if (x > 0){ out = x; klog('RB pos via '+names[i]+'='+x); return; }
          }catch(e){}
        }
      },
      onComplete: function(){}
    });
  }catch(e){}
  return out;
}
function seekTo(ms){
  try{
    var P = J('player');
    Java.choose(JN('player') || 'com.tencent.qqmusicsdk.player.a', {
      onMatch: function(o){
        try{ o.seekTo(parseInt(String(ms))); }catch(e){}
      },
      onComplete: function(){}
    });
    klog('RB seekTo '+ms);
  }catch(e){ klog('RB seek fail '+e); }
}

function rebuildPlayer(){
  Java.perform(function(){
    try{
      var toOrig = (readMode()==='ori');
      var idx = toOrig ? 1 : 0;

      var SP = J('speaker');
      var wf = SP.class.getDeclaredField('sCurrentWorkingSpeaker');
      wf.setAccessible(true);
      var wr = wf.get(null);
      var wm = wr.getClass().getMethod('get', null);
      wm.setAccessible(true);
      var sp = Java.cast(wm.invoke(wr, null), SP);

      // ===== 核心：只切槽，不清 sources、不重装配 =====
      // clear sources 会让播放器停播（已实测 start() 不存在，无法恢复）。
      // 装配必须是 [ACC,ORI] 且两槽内容不同，switchToSource 才有意义。
      // 装配时机由点歌时的 DS hook 负责（见 setDataSources 钩子，永远装 [ACC,ORI]）。

      // 先看当前槽位里到底是什么
      try{
        var lf = SP.class.getDeclaredField('sources');
        lf.setAccessible(true);
        var lst = Java.cast(lf.get(sp), Java.use('java.util.List'));
        var n = parseInt(String(lst.size()));
        var nm2 = [];
        for (var q=0;q<n;q++){
          var it = lst.get(q);
          var f2 = srcFileOf(it);   // 已有工具：getSourceFile 失败时退到 getAudioInfo
          nm2.push(q+':'+f2);
        }
        klog('RB slots n='+n+' ['+nm2.join(' | ')+']');
      }catch(e){ klog('RB read slots fail '+e); }

      // 直接切槽，true 避免 switchSourceInternal 短路
      Java.scheduleOnMainThread(function(){
        try{
          SP.switchToSource.overload('int','boolean').call(sp, idx, true);
          klog('RB switchToSource('+idx+',true) -> '+(toOrig?'ORI':'ACC'));
        }catch(e){ klog('RB switch fail '+e); }
      });
    }catch(e){ klog('RB fail '+e); }
  });
}

function toggleMode(){
  var nm=(readMode()==='acc')?'ori':'acc';
  writeMode(nm);
  klog('TOGGLE -> '+nm);
  rebuildPlayer();
  klog('TOGGLE done -> '+nm);
  try{
    Java.scheduleOnMainThread(function(){
      try{
        var ctx=Java.use('android.app.ActivityThread').currentApplication();
        var lbl=(nm==='acc')?'KG: ACCOMPANY':'KG: ORIGINAL';
        Java.use('android.widget.Toast').makeText(ctx,lbl,1).show();
      }catch(e){}
    });
  }catch(e){}
}

// ===== 按键触发 v13：ViewRootImpl 层拦截 =====
// 音量键在 PhoneWindowManager 就被 system_server 吃掉，应用层永远看不到；
// 但方向键 / OK / 菜单 / 返回 这些"应用键"一定会经过 ViewRootImpl.dispatchKeyEvent。
// 这里同时挂 Activity / DecorView 多个入口，任一命中即可（同一次按键只计一次）。
var TRIG_KEYS = CFG.TRIG_KEYS;
var gKeyCnt = 0, gKeyLastT = 0, gKeyLastCode = -1, gKeyWinT = 0, gKeyCool = 0;
var gKeyHits = {}, gKeyCh = '';

function readTrigKeys(){
  try{
    var F = Java.use('java.io.File');
    var f = F.$new(D+'/acc_key');
    if (!f.exists()) return TRIG_KEYS;
    var fis = Java.use('java.io.FileInputStream').$new(f);
    var buf = Java.array('byte',[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]);
    var n = fis.read(buf); fis.close();
    var s2 = '';
    for (var i=0;i<n;i++) s2 += String.fromCharCode(buf[i]);
    var out = [];
    s2.split(/[,\s]+/).forEach(function(x){ var v = parseInt(x); if (v > 0) out.push(v); });
    return out.length ? out : TRIG_KEYS;
  }catch(e){ return TRIG_KEYS; }
}

function onTrigKey(code, tag){
  try{
    var t = now();
    if (t - gKeyCool < 1200) return;
    var keys = readTrigKeys();
    var hit = false;
    for (var i=0;i<keys.length;i++){ if (keys[i] === code){ hit = true; break; } }
    if (!hit) return;
    // 严格去重：物理按键一次会同时进 DOWN 沿 + 多通道，同码 450ms 内只算一次
    if (code === gKeyLastCode && (t - gKeyLastT) < 450) return;
    if (t - gKeyLastT < 450) return;   // 不同码也不允许过快连发
    gKeyLastCode = code; gKeyLastT = t;

    if (t - gKeyWinT > 2500) gKeyCnt = 0;
    gKeyWinT = t;
    gKeyCnt++;

    if (!gKeyHits[tag]){ gKeyHits[tag] = 1; klog('KEYCH ['+tag+'] 通道命中'); }
    klog('KEY cnt='+gKeyCnt+' code='+code+' via='+tag);

    if (gKeyCnt >= 3){
      gKeyCnt = 0; gKeyCool = t;
      klog('KEY 三连 -> toggle');
      toggleMode();
    }
  }catch(e){}
}

(function(){
  var tags = [];
  // 只挂最外层 Activity.dispatchKeyEvent —— 已验证在 art 下安全。
  // ViewRootImpl / DecorView 是 @hide 类，overload 解析在部分 ROM 上会崩，不用。
  try{
    var AC = Java.use('android.app.Activity');
    var ovs = AC.dispatchKeyEvent.overloads;
    for (var i2=0;i2<ovs.length;i2++){
      (function(o){
        o.implementation = function(){
          try{
            var ev = arguments[0];
            if (ev && parseInt(String(ev.getAction())) === 0 && parseInt(String(ev.getRepeatCount())) === 0){
              onTrigKey(parseInt(String(ev.getKeyCode())), 'Activity');
            }
          }catch(e){}
          return o.apply(this, arguments);
        };
      })(ovs[i2]);
    }
    tags.push('Activity x'+ovs.length);
  }catch(e){ klog('KEY hook Activity fail '+e); }

  gKeyCh = tags.join(',');
  klog('KEY hooks armed: '+(tags.length? tags.join(','): 'NONE')+' 触发键='+readTrigKeys().join(','));
})();

// ===== RPC 通道：acc_cmd 文件内容当作 JS 执行（调试用）=====
(function(){
  var lastM = 0;
  setInterval(function(){
    try{
      var F = Java.use('java.io.File');
      var cf = F.$new(D+'/acc_cmd');
      if (!cf.exists()) return;
      var m = cf.lastModified();
      if (m === lastM) return;
      lastM = m;
      var fis = Java.use('java.io.FileInputStream').$new(cf);
      var buf = Java.array('byte', new Array(2048).fill(0));
      var n = fis.read(buf); fis.close();
      cf.delete();
      var src = '';
      for (var i=0;i<n;i++){ if (buf[i]===0) break; src += String.fromCharCode(buf[i]); }
      klog('CMD exec: '+src.substring(0,80));
      try{ (new Function(src))(); klog('CMD ok'); }
      catch(e){ klog('CMD fail '+e); }
    }catch(e){}
  }, 500);
})();

// ===== 触发通道：文件 acc_toggle（遥控器监听由设备端 shell 负责）=====
(function(){
  var lastM = 0;
  setInterval(function(){
    try{
      var F = Java.use('java.io.File');
      var tf = F.$new(D+'/acc_toggle');
      if (!tf.exists()) return;
      var m = tf.lastModified();
      if (m === lastM) return;
      lastM = m;
      tf.delete();
      toggleMode();
    }catch(e){}
  }, 600);
})();

// 心跳
Java.perform(function(){
  setInterval(function(){
    try{
      var F = Java.use('java.io.File');
      var fos = Java.use('java.io.FileOutputStream').$new(F.$new(STATE_FILE));
      var s = 'alive '+(new Date().toISOString())+' mode='+readMode()+' play='+gPlaying
            +' acc='+gHits+' vid='+gVid+' blk='+gBlocked;
      var b = Java.array('byte', s.split('').map(function(c){return c.charCodeAt(0);}));
      fos.write(b); fos.close();
    }catch(e){}
  }, 5000);
});

// ===== 点歌器：touch acc_play -> ViewTree 找歌曲卡片并 performClick =====
// K歌 界面是自定义渲染，input tap 打不中；必须拿到真实 View 调 performClick。
(function(){
  var lastM = 0;
  setInterval(function(){
    try{
      var F = Java.use('java.io.File');
      var pf = F.$new(D+'/acc_play');
      if (!pf.exists()) return;
      var m = pf.lastModified();
      if (m === lastM) return;
      lastM = m;
      pf.delete();
      Java.perform(function(){
        try{
          var VG = Java.use('android.view.ViewGroup');
          var AT = Java.use('android.app.ActivityThread');
          var act = null;
          var it = AT.currentActivityThread().mActivities.value.values().iterator();
          while (it.hasNext()){
            var rec = it.next();
            var fd = rec.getClass().getDeclaredField('activity');
            fd.setAccessible(true);
            var a2 = fd.get(rec);
            var _pk = (CFG.PKG || 'com.tencent.karaoketv').split('.').pop();
            if (a2 && String(a2.getClass().getName()).indexOf(_pk) >= 0) act = a2;
          }
          if (!act){ klog('PLAY no activity'); return; }
          var wm = act.getClass().getMethod('getWindow', null); wm.setAccessible(true);
          var win = wm.invoke(act, null);
          var dm2 = win.getClass().getMethod('getDecorView', null); dm2.setAccessible(true);
          var dv = dm2.invoke(win, null);
          var tiles = [];
          function walk(v, d){
            if (!v || d > 22) return;
            var cn = '';
            try{ cn = v.getClass().getName(); }catch(e){ return; }
            if (cn.indexOf('SongTileFocusLayout') >= 0) tiles.push(v);
            var nc = -1;
            try{ nc = parseInt(String(Java.cast(v, VG).getChildCount())); }catch(e){ return; }
            for (var i=0;i<nc;i++){
              try{ var ch = Java.cast(v, VG).getChildAt(i); if (ch) walk(ch, d+1); }catch(e){}
            }
          }
          walk(dv, 0);
          klog('PLAY tiles='+tiles.length);
          if (!tiles.length) return;
          var target = tiles[0];
          Java.scheduleOnMainThread(function(){
            try{
              var pm = target.getClass().getMethod('performClick', null);
              pm.setAccessible(true);
              klog('PLAY click ret='+pm.invoke(target, null));
            }catch(e){ klog('PLAY click fail '+e); }
          });
        }catch(e){ klog('PLAY fail '+e); }
      });
    }catch(e){}
  }, 900);
})();