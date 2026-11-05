// flpmerge.js - parse and merge FL Studio project files (.flp)
// Works in the browser (window.FLP) and in Node (module.exports).
(function (root) {
  'use strict';

  // Event ids (FL's classic numbering: <64 byte, <128 word, <192 dword, else data)
  const EV = {
    CH_NEW: 64, PAT_NEW: 65, ARR_NEW: 99, MIX_START: 100, MIX_COUNT: 103,
    // Mixer routing of a channel: byte 22 up to FL 24, word 104 from FL 2025.
    // 132 is a unique per-channel number (not the insert).
    VERSION: 199, TEMPO: 156, CH_SERIAL: 132, CH_ROUTE_OLD: 22, CH_ROUTE: 104, CH_GROUP: 145,
    CH_NAME: 203, CH_PLUGIN_NAME: 201, CH_TYPE: 21, CH_SAMPLE: 196,
    PAT_NAME: 193, PAT_NOTES: 224, PAT_CTRL: 223,
    PLAYLIST: 233, TRACK_DATA: 238, TRACK_NAME: 239, MARKER_POS: 148,
    INS_FLAGS: 236, INS_ROUTE: 235, INS_OUT: 147, INS_NAME: 204, INS_COLOR: 149, INS_HAS_COLOR: 42,
    MIX_PARAMS: 225, REMOTE_LINK: 227, GROUP_NAME: 231, PLUGIN_WRAPPER: 212,
    EXT_PREFIX: 172,
  };
  // Events that belong to a pattern block (after 65 until something else shows up)
  const PATTERN_SET = new Set([193, 150, 157, 158, 164, 223, 224, 160, 161, 148, 33, 34, 46, 45, 168, 205, 101]);
  // Events that belong to an arrangement time marker
  const MARKER_SET = new Set([205, 33, 34, 46, 45, 168, 101]);
  const MIXHDR_SET = new Set([29, 31, 38, 39, 40, 103]);
  const PATTERN_BASE = 0x5000;
  const INS_CD_BASE = 0x1c0;     // mixer param "channel data" >> 6 for insert 0
  const INS_CD_CURRENT = 0x3b5;  // the "current" insert always uses this id
  const MAX_TRACKS = 500;
  // Tempo automation clip taken from an FL 2026 project (channel events without 64, the 227 link, a playlist item)
  const TEMPO_TMPL = {"chan":[[21,5],[201,"0000"],[212,"0000000000000000ffffffff0000000050000000000000000000000000000000000000008a000000c20000000000000000000000"],[203,"540065006d0070006f000000"],[155,0],[128,6321038],[41,1],[0,1],[209,"0000000000190000000000000400000090000000"],[138,8388736],[139,65536],[89,0],[97,128],[48,0],[69,128],[86,256],[71,1024],[83,0],[74,0],[75,0],[76,0],[85,2048],[131,8388608],[70,0],[104,0],[50,1],[219,"e20400009a10000000000000000100000000000000000000"],[229,"0000000000320000000000000000000000000000"],[221,"01000000f401000000"],[215,"ffffffff0000000001000000ffffffff3c0000000000803f0000803f0000803f0000803f0000803f0000000001000000ffffffff000400003000000000000100a7050000000000000001000000000000000000000000000000000000010000000000000000000000000000000000000002000000feffffffffffffff000000000000000000000000000000000000f03f0000000000000000ffffffff01010000000000000000e03f"],[132,0],[144,0],[145,0],[234,"0100000040000000000400000003000000060000000000000000000000000000202222e23f00000000000000000000000000006a40000000802ebae43f00000000000000020000000000000000000000000000e03f00000000000000020000004000004c40000000000000e03f0000000000000002000000000000903e0000006074d1e93f000000000000000200000000000040400000006074d1e93f000000000000000201000000ffffffffffffffffffffffffffffffff800000008000000000000000800000000500000003000000010000000000000000000000000000000000f03f00000000000000000100000000000000fffffffffffffffffffffffffbb2000000000000000000000000000000000000"],[32,0],[228,"64000000000000000000000000000000"],[228,"3c000000000000000000000000000000"],[218,"000000000000000064000000204e0000204e00003075000032000000204e00000000000064000000204e000000000000b680000000000000000000000000000000000000"],[218,"040000000000000064000000204e0000204e00003075000032000000204e00000000000064000000204e000000000000b68000000000000000000000000000009bffffff"],[218,"000000000000000064000000204e0000204e00003075000032000000204e00000000000064000000204e000000000000b680000000000000000000000000000000000000"],[218,"000000000000000064000000204e0000204e00003075000032000000204e00000000000064000000204e000000000000b680000000000000000000000000000000000000"],[218,"000000000000000064000000204e0000204e00003075000032000000204e00000000000064000000204e000000000000b680000000000000000000000000000000000000"],[143,3],[20,0],[170,4294967295],[51,0]],"link":"00001000000000000500004008000000d5010000","item":"0000000000501000006f0000e501000078004000406480800000000000009443ae00000000000000000000000000000000000000000000000000000000000000000000000000f03f00000000ffffffff0000000000000000"};

  // ---------- low level ----------
  function readVarint(b, p) {
    let n = 0, sh = 0, c;
    do { c = b[p++]; n += (c & 0x7f) * Math.pow(2, sh); sh += 7; } while (c & 0x80);
    return [n, p];
  }
  function writeVarint(out, n) {
    do { let c = n & 0x7f; n = Math.floor(n / 128); if (n) c |= 0x80; out.push(c); } while (n);
  }
  function kindOf(id) { return id < 64 ? 1 : id < 128 ? 2 : id < 192 ? 4 : 0; }

  function parseEvents(b, p, end) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const evs = [];
    while (p < end) {
      let id = b[p++];
      let ext = null;
      if (id === EV.EXT_PREFIX && evs.length && isExtFile(evs)) {
        const x = dv.getUint32(p, true); p += 4;
        ext = x >>> 0;
        const t = x >>> 24;
        id = 1000 + (x & 0xffffff);
        const k = t === 0 ? 1 : t === 0x40 ? 2 : t === 0x80 ? 4 : 0;
        p = readBody(b, dv, p, k, evs, id, ext);
        continue;
      }
      p = readBody(b, dv, p, kindOf(id), evs, id, null);
    }
    return evs;
  }
  function readBody(b, dv, p, k, evs, id, ext) {
    if (k === 1) { evs.push({ id, v: b[p], ext }); return p + 1; }
    if (k === 2) { evs.push({ id, v: dv.getUint16(p, true), ext }); return p + 2; }
    if (k === 4) { evs.push({ id, v: dv.getUint32(p, true), ext }); return p + 4; }
    let n; [n, p] = readVarint(b, p);
    evs.push({ id, d: b.slice(p, p + n), ext });
    return p + n;
  }
  // FL 2026 introduced an extended-id prefix event (172). Older files never use 172.
  function isExtFile(evs) {
    const v = evs.find(e => e.id === EV.VERSION);
    return v ? parseInt(decodeAscii(v.d), 10) >= 26 : false;
  }

  function kindOfEvent(e) {
    if (e.ext !== null && e.ext !== undefined) { const t = e.ext >>> 24; return t === 0 ? 1 : t === 0x40 ? 2 : t === 0x80 ? 4 : 0; }
    return kindOf(e.id);
  }
  function serialize(proj, events) {
    // size first, then write into one buffer (projects can be 100+ MB)
    let size = 22;
    for (const e of events) {
      const k = kindOfEvent(e);
      size += (e.ext !== null && e.ext !== undefined ? 5 : 1);
      if (k) size += k;
      else { let n = e.d.length; do { size++; n = Math.floor(n / 128); } while (n); size += e.d.length; }
    }
    const res = new Uint8Array(size);
    const dv = new DataView(res.buffer);
    res.set([0x46, 0x4c, 0x68, 0x64], 0); dv.setUint32(4, 6, true);
    dv.setInt16(8, proj.fmt, true); dv.setUint16(10, proj.nchOut, true); dv.setUint16(12, proj.ppq, true);
    res.set([0x46, 0x4c, 0x64, 0x74], 14); dv.setUint32(18, size - 22, true);
    let p = 22;
    for (const e of events) {
      const k = kindOfEvent(e);
      if (e.ext !== null && e.ext !== undefined) { res[p++] = EV.EXT_PREFIX; dv.setUint32(p, e.ext >>> 0, true); p += 4; }
      else res[p++] = e.id;
      if (k === 1) res[p++] = e.v & 255;
      else if (k === 2) { dv.setUint16(p, e.v & 0xffff, true); p += 2; }
      else if (k === 4) { dv.setUint32(p, e.v >>> 0, true); p += 4; }
      else {
        let n = e.d.length;
        do { let c = n & 0x7f; n = Math.floor(n / 128); if (n) c |= 0x80; res[p++] = c; } while (n);
        res.set(e.d, p); p += e.d.length;
      }
    }
    return res;
  }

  function decodeAscii(d) { let s = ''; for (const c of d) { if (!c) break; s += String.fromCharCode(c); } return s; }
  function decodeText(d) {
    if (!d || !d.length) return '';
    // FL stores most strings as UTF-16LE; very old files use ANSI
    if (d.length >= 2 && d.length % 2 === 0 && d[1] === 0) {
      let s = ''; for (let i = 0; i + 1 < d.length; i += 2) { const c = d[i] | (d[i + 1] << 8); if (!c) break; s += String.fromCharCode(c); }
      return s;
    }
    return decodeAscii(d);
  }
  const u16 = (d, o) => d[o] | (d[o + 1] << 8);
  const u32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
  const w16 = (d, o, v) => { d[o] = v & 255; d[o + 1] = (v >>> 8) & 255; };
  const w32 = (d, o, v) => { d[o] = v & 255; d[o + 1] = (v >>> 8) & 255; d[o + 2] = (v >>> 16) & 255; d[o + 3] = (v >>> 24) & 255; };
  const clone = e => ({ id: e.id, v: e.v, d: e.d ? e.d.slice() : undefined, ext: e.ext });

  // ---------- structure analysis ----------
  function parseFLP(input, fileName) {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input);
    const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
    if (tag !== 'FLhd') throw new Error('Not an FL Studio project file (no FLhd header)');
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const hl = dv.getUint32(4, true);
    const fmt = dv.getInt16(8, true), nch = dv.getUint16(10, true), ppq = dv.getUint16(12, true);
    let p = 8 + hl;
    if (String.fromCharCode(b[p], b[p + 1], b[p + 2], b[p + 3]) !== 'FLdt') throw new Error('Missing FLdt block');
    const dl = dv.getUint32(p + 4, true);
    p += 8;
    const events = parseEvents(b, p, Math.min(p + dl, b.length));
    const proj = { fileName: fileName || 'project.flp', fmt, nch, ppq, events };
    analyze(proj);
    return proj;
  }

  function analyze(proj) {
    const ev = proj.events;
    const ver = ev.find(e => e.id === EV.VERSION);
    proj.version = ver ? decodeAscii(ver.d) : '?';
    proj.major = parseInt(proj.version, 10) || 0;
    const tempo = ev.find(e => e.id === EV.TEMPO);
    proj.tempo = tempo ? tempo.v / 1000 : null;

    // Section/owner tagging
    const firstArr = ev.findIndex(e => e.id === EV.ARR_NEW);
    let mixStart = -1;
    for (let i = Math.max(firstArr, 0); i < ev.length; i++) if (ev[i].id === EV.MIX_START) { mixStart = i; break; }
    // Mixer header: 100 followed by a few global mixer events (FL 2025+ also stores the insert count, 103)
    let mixCountIdx = -1;
    if (mixStart >= 0) {
      mixCountIdx = mixStart;
      while (mixCountIdx + 1 < ev.length && MIXHDR_SET.has(ev[mixCountIdx + 1].id)) mixCountIdx++;
    }
    const paramsIdx = ev.findIndex(e => e.id === EV.MIX_PARAMS);

    const tag = new Array(ev.length); // {sec, owner}
    const channels = [], patterns = new Map(), inserts = [];
    let sec = 'pre', ch = null, pat = null;
    const chanEnd = firstArr >= 0 ? firstArr : (mixStart >= 0 ? mixStart : ev.length);
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      if (i < chanEnd) {
        if (e.id === EV.PAT_NEW) {
          pat = patterns.get(e.v) || { id: e.v, idx: [], name: '' };
          patterns.set(e.v, pat);
          pat.idx.push(i); tag[i] = { sec: 'pat', owner: e.v }; continue;
        }
        if (pat && PATTERN_SET.has(e.id)) { pat.idx.push(i); tag[i] = { sec: 'pat', owner: pat.id }; if (e.id === EV.PAT_NAME) pat.name = decodeText(e.d); continue; }
        pat = null;
        if (e.id === EV.CH_NEW) { ch = { id: e.v, idx: [] }; channels.push(ch); }
        if (ch) { ch.idx.push(i); tag[i] = { sec: 'chan', owner: ch.id }; }
        else tag[i] = { sec: 'pre' };
        continue;
      }
      if (mixStart < 0 || i < mixStart) { tag[i] = { sec: 'arr' }; continue; }
      tag[i] = { sec: 'mix' };
    }
    // Insert blocks: after the insert-count event, each one ends with event 147
    if (mixCountIdx >= 0) {
      let cur = { idx: [] };
      const stop = paramsIdx > mixCountIdx ? paramsIdx : ev.length;
      for (let i = mixCountIdx + 1; i < stop; i++) {
        cur.idx.push(i);
        if (ev[i].id === EV.INS_OUT) { inserts.push(cur); cur = { idx: [] }; }
      }
    }
    proj.tag = tag; proj.firstArr = firstArr; proj.mixStart = mixStart; proj.mixCountIdx = mixCountIdx; proj.paramsIdx = paramsIdx;

    // Channels
    const groups = ev.filter((e, i) => e.id === EV.GROUP_NAME && tag[i] && tag[i].sec === 'pre').map(e => decodeText(e.d));
    proj.groups = groups;
    for (const c of channels) {
      c.name = ''; c.type = 0; c.insert = 0; c.group = 0; c.sample = '';
      for (const i of c.idx) {
        const e = ev[i];
        if (e.id === EV.CH_NAME && !c.name) c.name = decodeText(e.d);
        else if (e.id === EV.CH_PLUGIN_NAME && !c.pluginName) c.pluginName = decodeText(e.d);
        else if (e.id === EV.CH_TYPE) c.type = e.v;
        else if (e.id === EV.CH_ROUTE_OLD) c.insert = e.v === 255 ? -1 : e.v;
        else if (e.id === EV.CH_ROUTE) c.insert = e.v === 0xffff ? -1 : e.v;
        else if (e.id === EV.CH_GROUP) c.group = e.v;
        else if (e.id === EV.CH_SAMPLE) c.sample = decodeText(e.d);
      }
      if (!c.name) c.name = c.pluginName || c.sample.split(/[\\/]/).pop() || ('Channel ' + (c.id + 1));
    }
    proj.channels = channels;
    proj.patterns = [...patterns.values()].sort((a, b) => a.id - b.id);

    // Mixer
    proj.fixedMixer = inserts.length === 127 && proj.major < 25;
    const nIns = inserts.length;
    inserts.forEach((ins, n) => {
      ins.n = n; ins.name = ''; ins.plugins = []; ins.routes = []; ins.special = n === 0 ? 'master' : n === nIns - 1 ? 'current' : null;
      let slotPlugin = null;
      for (const i of ins.idx) {
        const e = ev[i];
        if (e.id === EV.INS_NAME) ins.name = decodeText(e.d);
        else if (e.id === EV.INS_COLOR) ins.color = e.v;
        else if (e.id === EV.CH_PLUGIN_NAME) { slotPlugin = decodeText(e.d); ins.fxCount = (ins.fxCount || 0) + 1; }
        else if (e.id === EV.CH_NAME) { ins.plugins.push(decodeText(e.d) || slotPlugin); slotPlugin = null; }
        else if (e.id === EV.INS_ROUTE) ins.routes = [...e.d].map((x, k) => x ? k : -1).filter(k => k >= 0);
      }
    });
    proj.inserts = inserts;
    proj.params = paramsIdx >= 0 ? decodeParams(ev[paramsIdx].d) : [];

    // Which inserts are in use (referenced, has content, or differs from the default insert)
    const sigOf = n => proj.params.filter(r => r.ins === n && (r.u1 === 0x1f || r.u1 === 0x20))
      .map(r => r.u1 + ':' + r.slot + ':' + r.pid + ':' + r.val).join('|');
    const sigCount = new Map();
    for (let n = 1; n < nIns - 1; n++) { const s = sigOf(n); sigCount.set(s, (sigCount.get(s) || 0) + 1); }
    let defSig = null, best = 0;
    for (const [s, c] of sigCount) if (c > best) { best = c; defSig = s; }
    const used = new Set();
    for (const c of channels) if (c.insert > 0 && c.insert < nIns - 1) used.add(c.insert);
    for (let n = 1; n < nIns - 1; n++) {
      const ins = inserts[n];
      if (ins.name || ins.color !== undefined || ins.plugins.length || ins.routes.some(r => r !== 0) || sigOf(n) !== defSig) used.add(n);
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (const n of [...used]) for (const r of inserts[n].routes) if (r > 0 && r < nIns - 1 && !used.has(r)) { used.add(r); grew = true; }
      for (const r of proj.params) if (r.u1 === 0x20 && used.has(r.ins) && r.pid > 0 && r.pid < nIns - 1 && !used.has(r.pid)) { used.add(r.pid); grew = true; }
    }
    proj.usedInserts = [...used].sort((a, b) => a - b);
    proj.defaultInsertSig = defSig;
    inserts.forEach(ins => { ins.used = used.has(ins.n); });

    // Arrangement / playlist
    const plIdx = ev.findIndex((e, i) => e.id === EV.PLAYLIST && i > firstArr);
    proj.playlistIdx = plIdx;
    proj.items = plIdx >= 0 ? decodeItems(ev[plIdx].d, proj.major) : [];
    proj.itemSize = proj.items.size || itemSizeFor(new Uint8Array(0), proj.major);
    let len = 0, maxTrack = -1;
    for (const it of proj.items) {
      len = Math.max(len, it.pos + it.len);
      maxTrack = Math.max(maxTrack, it.track);
    }
    proj.lengthTicks = len;
    proj.tracksUsed = maxTrack + 1;
    // Track names (for display)
    proj.trackNames = {};
    let curTrack = null;
    for (let i = firstArr; i >= 0 && i < (mixStart >= 0 ? mixStart : ev.length); i++) {
      const e = ev[i];
      if (e.id === EV.TRACK_DATA) curTrack = u32(e.d, 0);
      else if (e.id === EV.TRACK_NAME && curTrack !== null) proj.trackNames[curTrack - 1] = decodeText(e.d);
    }
  }

  function decodeParams(d) {
    const recs = [];
    for (let o = 0; o + 12 <= d.length; o += 12) {
      const cd = u16(d, o + 6);
      const hi = cd >> 6;
      recs.push({ raw: d.slice(o, o + 12), pid: d[o + 4], u1: d[o + 5], cd, slot: cd & 63,
        ins: hi === INS_CD_CURRENT ? -2 : hi - INS_CD_BASE, val: u32(d, o + 8) | 0 });
    }
    return recs;
  }
  function encodeParams(recs) {
    const d = new Uint8Array(recs.length * 12);
    recs.forEach((r, k) => { d.set(r.raw, k * 12); });
    return d;
  }

  // Playlist item size grows with the FL version
  function itemSizeFor(d, major) {
    const guess = major >= 26 ? 88 : major >= 25 ? 80 : major >= 21 ? 60 : 32;
    const fits = s => d.length % s === 0 && (d.length === s || u16(d, s + 4) === PATTERN_BASE || u16(d, 4) !== PATTERN_BASE);
    if (!d.length || fits(guess)) return guess;
    return [88, 80, 60, 32].find(fits) || guess;
  }
  // Defaults for the bytes newer versions append to each playlist item
  const ITEM_TAIL = new Uint8Array(88);
  ITEM_TAIL.set([0, 0, 0xf0, 0x3f], 70); ITEM_TAIL.set([0xff, 0xff, 0xff, 0xff], 76);

  function decodeItems(d, major) {
    const size = itemSizeFor(d, major);
    const items = [];
    for (let o = 0; o + size <= d.length; o += size) {
      const raw = d.slice(o, o + size);
      const base = u16(raw, 4), idx = u16(raw, 6);
      items.push({ raw, pos: u32(raw, 0), len: u32(raw, 8), base, isPattern: idx >= base && base > 0,
        ref: idx >= base && base > 0 ? idx - base : idx, track: (MAX_TRACKS - 1) - u16(raw, 12), group: u16(raw, 14) });
    }
    items.size = size;
    return items;
  }

  // ---------- merge ----------
  /**
   * parts: [{ proj, offsetTicks, color }]  (offset in the base project's PPQ, color 0xRRGGBB)
   * opts:  { baseIndex, separateTracks, groupPerProject, projectMarkers, tempoSteps, mixerColors, mixerNames }
   */
  function mergeFLP(parts, opts) {
    opts = opts || {};
    const baseIndex = opts.baseIndex || 0;
    const base = parts[baseIndex].proj;
    const warn = [];
    const report = [];
    const ev = base.events.map(clone);
    const ppq = base.ppq;

    // Collect the base's current state
    let chanIds = base.channels.map(c => c.id);
    let nextChan = chanIds.length ? Math.max(...chanIds) + 1 : 0;
    // Empty patterns have no pattern events, only playlist clips, so count those too
    const patternIds = proj => [...new Set([...proj.patterns.map(p => p.id), ...proj.items.filter(i => i.isPattern).map(i => i.ref)])].sort((a, b) => a - b);
    const baseIds = patternIds(base);
    let nextPat = baseIds.length ? Math.max(...baseIds) + 1 : 1;
    const nIns = base.inserts.length;
    if (!nIns) throw new Error('The base project has no mixer');
    const sparseRoutes = !base.inserts.every(ins => { const e = ins.idx.map(i => base.events[i]).find(x => x.id === EV.INS_ROUTE); return e && e.d.length === nIns; });
    let insertBlocks = base.inserts.map(ins => ins.idx.map(i => ev[i]));   // arrays of events (cloned)
    let params = base.params.map(r => ({ ...r, raw: r.raw.slice() }));
    let nextIns = (base.usedInserts.length ? Math.max(...base.usedInserts) : 0) + 1;
    for (const c of base.channels) if (c.insert >= nextIns && c.insert < nIns - 1) nextIns = c.insert + 1;
    const groups = base.groups.slice();
    // Routing event format follows the base's FL version
    const baseHas = id => base.channels.some(c => c.idx.some(i => base.events[i].id === id));
    const baseRouteId = baseHas(EV.CH_ROUTE) ? EV.CH_ROUTE : baseHas(EV.CH_ROUTE_OLD) ? EV.CH_ROUTE_OLD
      : (base.major >= 25 ? EV.CH_ROUTE : EV.CH_ROUTE_OLD);
    let nextSerial = 1;
    for (const c of base.channels) for (const i of c.idx) if (base.events[i].id === EV.CH_SERIAL) nextSerial = Math.max(nextSerial, (base.events[i].v & 0xffff) + 1);
    // Optional: one channel filter group per project, named after the file
    const groupFor = proj => {
      let name = proj.fileName.replace(/\.flp$/i, ''), n = 2;
      while (groups.includes(name)) name = proj.fileName.replace(/\.flp$/i, '') + ' (' + n++ + ')';
      groups.push(name);
      return groups.length - 1;
    };
    if (opts.groupPerProject) {
      const g = groupFor(base);
      for (const c of base.channels) {
        const gi = c.idx.find(i => ev[i].id === EV.CH_GROUP);
        if (gi !== undefined) ev[gi].v = g;
        else ev[c.idx[0]].after = [{ id: EV.CH_GROUP, v: g, ext: null }];
      }
    }

    // Base playlist items (shifted by the base's own offset)
    const baseOff = Math.round(parts[baseIndex].offsetTicks || 0);
    const items = base.items.map(it => { const raw = it.raw.slice(); if (baseOff) w32(raw, 0, it.pos + baseOff); return raw; });
    let itemSize = base.itemSize;
    let maxGroup = Math.max(0, ...base.items.map(i => i.group));
    let trackOffset = base.tracksUsed;
    const trackCopies = []; // {fromProj, fromTrack, toTrack}
    const newMarkers = [];
    const newPatterns = [];   // arrays of events
    const newChannels = [];   // arrays of events
    const newLinks = [];
    if (baseOff) {
      // Base markers move too
      for (let i = base.firstArr; i >= 0 && i < base.mixStart; i++) if (ev[i].id === EV.MARKER_POS) ev[i].v = shiftMarker(ev[i].v, baseOff);
    }
    report.push({ file: base.fileName, index: baseIndex, base: true, channels: base.channels.length, patterns: base.patterns.length,
      inserts: base.usedInserts.map(n => ({ from: n, to: n })) });

    parts.forEach((part, pi) => {
      if (pi === baseIndex) return;
      const P = part.proj;
      const r = ppq / P.ppq;
      const scale = x => Math.round(x * r);
      const off = Math.round(part.offsetTicks || 0);
      if (!opts.tempoSteps && P.tempo && base.tempo && Math.abs(P.tempo - base.tempo) > 0.01)
        warn.push(`${P.fileName}: tempo ${P.tempo} BPM differs from the base's ${base.tempo} BPM. The base tempo is used.`);
      if (P.major > base.major)
        warn.push(`${P.fileName} was saved in a newer FL version (${P.version}) than the base (${base.version}). Open the result in the newest version.`);

      // Channel map
      const chMap = new Map();
      for (const c of P.channels) chMap.set(c.id, nextChan++);
      // Pattern map
      const patMap = new Map();
      for (const id of patternIds(P)) patMap.set(id, nextPat++);
      // Insert map (skip master and "current")
      const insMap = new Map();
      for (const n of P.usedInserts) {
        if (base.fixedMixer && nextIns > nIns - 2) { warn.push(`${P.fileName}: the mixer is full, insert ${n} was skipped`); continue; }
        insMap.set(n, nextIns++);
      }
      // Filter groups
      const grpMap = new Map();
      if (opts.groupPerProject) { const g = groupFor(P); P.groups.forEach((_, k) => grpMap.set(k, g)); grpMap.set(0, g); }
      else P.groups.forEach((g, k) => { let j = groups.indexOf(g); if (j < 0) { groups.push(g); j = groups.length - 1; } grpMap.set(k, j); });

      // Patterns
      for (const p of P.patterns) {
        const out = [];
        for (const i of p.idx) {
          const e = clone(P.events[i]);
          if (e.id === EV.PAT_NEW) e.v = patMap.get(e.v);
          else if (e.id === EV.PAT_NOTES) {
            for (let o = 0; o + 24 <= e.d.length; o += 24) {
              const c = u16(e.d, o + 6);
              if (chMap.has(c)) w16(e.d, o + 6, chMap.get(c));
              if (r !== 1) { w32(e.d, o, scale(u32(e.d, o))); w32(e.d, o + 8, scale(u32(e.d, o + 8))); }
            }
          } else if (e.id === EV.PAT_CTRL) {
            for (let o = 0; o + 12 <= e.d.length; o += 12) {
              const c = e.d[o + 6];
              if (chMap.has(c)) e.d[o + 6] = chMap.get(c) & 255;
              if (r !== 1) w32(e.d, o, scale(u32(e.d, o)));
            }
          }
          // Only keep the first 65 of a pattern (FL writes notes and metadata in two passes)
          if (e.id === EV.PAT_NEW && out.length) continue;
          out.push(e);
        }
        newPatterns.push(out);
      }

      // Channels
      for (const c of P.channels) {
        const out = [];
        const newIns = c.insert <= 0 ? c.insert : (insMap.has(c.insert) ? insMap.get(c.insert) : 0);
        const routeEv = baseRouteId === EV.CH_ROUTE
          ? { id: EV.CH_ROUTE, v: newIns < 0 ? 0xffff : newIns, ext: null }
          : { id: EV.CH_ROUTE_OLD, v: newIns < 0 ? 255 : newIns, ext: null };
        let routed = false;
        for (const i of c.idx) {
          const e = clone(P.events[i]);
          if (e.id === EV.CH_NEW) e.v = chMap.get(e.v);
          else if (e.id === EV.CH_ROUTE || e.id === EV.CH_ROUTE_OLD) {
            // written in the base's format, where the source had it
            if (!routed) { out.push(routeEv); routed = true; }
            continue;
          } else if (e.id === EV.CH_SERIAL) {
            if (e.v) { const n = nextSerial++; e.v = ((n << 16) | n) >>> 0; }
          } else if (e.id === EV.CH_GROUP) {
            e.v = grpMap.has(e.v) ? grpMap.get(e.v) : 0;
          } else if (e.id === 94) {
            if (chMap.has(e.v)) e.v = chMap.get(e.v); // layer child
          }
          out.push(e);
        }
        if (!routed && newIns !== 0) out.splice(1, 0, routeEv);
        newChannels.push(out);
      }

      // Automation links (227): source channel at +2, target at +10
      P.events.forEach((e, i) => {
        if (e.id !== EV.REMOTE_LINK || P.tag[i].sec !== 'pre') return;
        const x = clone(e);
        const src = u16(x.d, 2), tgt = u16(x.d, 10);
        if (chMap.has(src)) w16(x.d, 2, chMap.get(src));
        if (tgt < 0x1000) { if (chMap.has(tgt)) w16(x.d, 10, chMap.get(tgt)); }
        else if ((tgt & 0xe000) === 0x2000) {
          // mixer target: 0x2000 | insert << 6 | slot
          const n = (tgt - 0x2000) >> 6;
          if (n === 0) { /* master stays master */ }
          else if (insMap.has(n)) w16(x.d, 10, 0x2000 | (insMap.get(n) << 6) | (tgt & 63));
          else warn.push(`${P.fileName}: an automation clip targets mixer insert ${n}, which was not carried over`);
        } else warn.push(`${P.fileName}: an automation clip has a target that could not be moved`);
        newLinks.push(x);
      });

      // Mixer inserts
      const needed = Math.max(0, ...insMap.values()) + 2; // + current
      while (!base.fixedMixer && insertBlocks.length < needed) {
        // add an empty insert before "current", cloned from the base's default
        const tmplN = base.inserts.length - 2;
        const tmpl = base.inserts[tmplN].idx.map(i => clone(base.events[i]));
        const newN = insertBlocks.length - 1;
        for (const e of tmpl) if (e.id === EV.PLUGIN_WRAPPER && e.d.length >= 4 && u32(e.d, 0) === tmplN) w32(e.d, 0, newN);
        insertBlocks.splice(newN, 0, tmpl);
        for (const rr of base.params) if (rr.ins === tmplN && (rr.u1 === 0x1f || rr.u1 === 0x20) && rr.u1 !== 0x20) {
          const raw = rr.raw.slice(); w16(raw, 6, ((newN + INS_CD_BASE) << 6) | rr.slot);
          params.push({ ...rr, raw, ins: newN });
        }
      }
      const routeLen = sparseRoutes ? 0 : nIns;
      for (const [from, to] of insMap) {
        const blk = P.inserts[from].idx.map(i => clone(P.events[i]));
        for (const e of blk) {
          // a mixer plugin's wrapper data starts with its own insert number
          if (e.id === EV.PLUGIN_WRAPPER && e.d.length >= 4 && u32(e.d, 0) === from) w32(e.d, 0, to);
          if (e.id === EV.INS_ROUTE) {
            const dests = [...e.d].map((x, k) => x ? k : -1).filter(k => k >= 0)
              .map(k => k === 0 ? 0 : insMap.get(k)).filter(k => k !== undefined);
            const len = routeLen || Math.max(1, ...dests.map(k => k + 1));
            const d = new Uint8Array(len); for (const k of dests) if (k < len) d[k] = 1;
            e.d = d;
          }
        }
        insertBlocks[to] = blk;
        params = params.filter(x => !((x.u1 === 0x1f || x.u1 === 0x20) && x.ins === to));
      }
      for (const rr of P.params) {
        if (!(rr.u1 === 0x1f || rr.u1 === 0x20) || !insMap.has(rr.ins)) continue;
        const raw = rr.raw.slice();
        const to = insMap.get(rr.ins);
        w16(raw, 6, ((to + INS_CD_BASE) << 6) | rr.slot);
        if (rr.u1 === 0x20) {
          if (rr.pid === 0) { /* send to master */ }
          else if (insMap.has(rr.pid)) raw[4] = insMap.get(rr.pid);
          else continue;
        }
        params.push({ ...rr, raw, ins: to });
      }

      // Playlist
      const tOff = opts.separateTracks ? trackOffset : 0;
      const grpOff = maxGroup;
      let pMaxGroup = 0;
      for (const it of P.items) {
        let raw = it.raw.slice();
        if (raw.length !== itemSize) {
          const n = new Uint8Array(itemSize);
          n.set(raw.slice(0, Math.min(raw.length, itemSize)));
          if (itemSize > raw.length) n.set(ITEM_TAIL.slice(raw.length, itemSize), raw.length);
          raw = n;
        }
        w32(raw, 0, scale(it.pos) + off);
        if (r !== 1) w32(raw, 8, scale(it.len));
        if (it.isPattern) { if (patMap.has(it.ref)) w16(raw, 6, it.base + patMap.get(it.ref)); }
        else if (chMap.has(it.ref)) w16(raw, 6, chMap.get(it.ref));
        const t = it.track + tOff;
        if (t >= MAX_TRACKS) { warn.push(`${P.fileName}: a clip on track ${t + 1} was skipped (max ${MAX_TRACKS})`); continue; }
        w16(raw, 12, (MAX_TRACKS - 1) - t);
        if (it.group) { w16(raw, 14, it.group + grpOff); pMaxGroup = Math.max(pMaxGroup, it.group + grpOff); }
        items.push(raw);
      }
      maxGroup = Math.max(maxGroup, pMaxGroup);
      if (opts.separateTracks) {
        for (let t = 0; t < P.tracksUsed; t++) trackCopies.push({ P, from: t, to: t + tOff });
        trackOffset += P.tracksUsed;
      }

      // Arrangement time markers
      for (let i = P.firstArr; i >= 0 && i < (P.mixStart >= 0 ? P.mixStart : P.events.length); i++) {
        if (P.events[i].id !== EV.MARKER_POS) continue;
        const blk = [clone(P.events[i])];
        blk[0].v = shiftMarker(scaleMarker(blk[0].v, r), off);
        for (let j = i + 1; j < P.events.length && MARKER_SET.has(P.events[j].id); j++) blk.push(clone(P.events[j]));
        newMarkers.push(blk);
      }

      report.push({ file: P.fileName, index: pi, base: false, channels: P.channels.length, patterns: P.patterns.length,
        inserts: [...insMap].map(([from, to]) => ({ from, to })),
        chanFrom: Math.min(...chMap.values()), offsetTicks: off });
    });

    // Tempo automation: one clip over the whole song that steps to each project's BPM where it starts
    if (opts.tempoSteps) {
      const seq = parts.filter(p => p.proj.tempo).map(p => ({ at: Math.max(0, Math.round(p.offsetTicks || 0)), bpm: p.proj.tempo, name: p.proj.fileName }))
        .sort((a, b) => a.at - b.at);
      const hasOwnTempoClip = parts.some(p => p.proj.events.some(e => e.id === EV.REMOTE_LINK && u16(e.d, 10) === 0x4000));
      if (hasOwnTempoClip) warn.push('A project already has its own tempo automation. It may fight with the added tempo clip.');
      if (seq.length && seq.some(s => Math.abs(s.bpm - seq[0].bpm) > 0.001)) {
        let end = 0;
        for (const raw of items) end = Math.max(end, u32(raw, 0) + u32(raw, 8));
        end = Math.max(end, seq[seq.length - 1].at + ppq * 4);
        const pts = [{ at: 0, bpm: seq[0].bpm }];
        for (let k = 1; k < seq.length; k++) { pts.push({ at: seq[k].at, bpm: seq[k - 1].bpm }); pts.push({ at: seq[k].at, bpm: seq[k].bpm }); }
        pts.push({ at: end, bpm: seq[seq.length - 1].bpm });
        for (const s of seq) if (s.bpm < 60 || s.bpm > 180) warn.push(`${s.name}: ${s.bpm} BPM is outside FL's tempo automation range (60–180) and was clamped`);
        const tmplData = hex(TEMPO_TMPL.chan.find(e => e[0] === 234)[1]);
        const data = new Uint8Array(21 + pts.length * 24 + (tmplData.length - 165));
        data.set(tmplData.slice(0, 17), 0); w32(data, 17, pts.length);
        const dv = new DataView(data.buffer);
        let prev = 0;
        pts.forEach((pt, k) => {
          const o = 21 + k * 24;
          dv.setFloat64(o, (pt.at - prev) / ppq, true); prev = pt.at;
          dv.setFloat64(o + 8, Math.min(1, Math.max(0, (pt.bpm - 60) / 120)), true);
          dv.setFloat32(o + 16, 0, true);
          if (k) data[o + 23] = 2;
        });
        data.set(tmplData.slice(165), 21 + pts.length * 24);
        const id = nextChan++;
        const blk = [{ id: EV.CH_NEW, v: id, ext: null }];
        for (const [eid, val] of TEMPO_TMPL.chan) {
          if (eid === EV.CH_ROUTE || eid === EV.CH_ROUTE_OLD) { blk.push({ id: baseRouteId, v: 0, ext: null }); continue; }
          if (eid === 234) { blk.push({ id: 234, d: data, ext: null }); continue; }
          blk.push(typeof val === 'string' ? { id: eid, d: hex(val), ext: null } : { id: eid, v: val, ext: null });
        }
        newChannels.push(blk);
        const link = hex(TEMPO_TMPL.link); w16(link, 2, id);
        newLinks.push({ id: EV.REMOTE_LINK, d: link, ext: null });
        let maxTrack = -1, maxId = 0;
        for (const raw of items) { maxTrack = Math.max(maxTrack, (MAX_TRACKS - 1) - u16(raw, 12)); if (itemSize >= 36) maxId = Math.max(maxId, u32(raw, 32)); }
        const it = new Uint8Array(itemSize);
        const tr = hex(TEMPO_TMPL.item);
        it.set(tr.slice(0, Math.min(itemSize, tr.length)));
        if (itemSize > tr.length) it.set(ITEM_TAIL.slice(tr.length, itemSize), tr.length);
        w32(it, 0, 0); w32(it, 8, end); w16(it, 6, id); w16(it, 14, 0);
        w16(it, 12, (MAX_TRACKS - 1) - Math.min(MAX_TRACKS - 1, maxTrack + 1));
        if (itemSize >= 36) w32(it, 32, maxId + 1);
        items.push(it);
        // the song starts at the first project's tempo
        const t0 = ev.find(e => e.id === EV.TEMPO);
        if (t0) t0.v = Math.round(seq[0].bpm * 1000);
      }
    }

    // Time marker with the project name where each project starts
    if (opts.projectMarkers) {
      parts.forEach(part => {
        const pos = Math.max(0, Math.round(part.offsetTicks || 0)) & 0x03ffffff;
        newMarkers.push([
          { id: EV.MARKER_POS, v: pos, ext: null },
          { id: 33, v: 4, ext: null }, { id: 34, v: 4, ext: null },
          { id: 46, v: 0, ext: null }, { id: 45, v: 0, ext: null }, { id: 168, v: 0, ext: null }, { id: 101, v: 0, ext: null },
          { id: 205, d: utf16z(part.proj.fileName.replace(/\.flp$/i, '')), ext: null },
        ]);
      });
    }

    // Per project look of the mixer tracks. Master and "current" are left alone.
    for (const r of report) {
      const rgb = parts[r.index].color;
      const project = parts[r.index].proj.fileName.replace(/\.flp$/i, '');
      for (const m of r.inserts) {
        const blk = insertBlocks[m.to];
        // Color replaces the insert's own. Stored as 0x00BBGGRR, first in the block; FL ignores it unless event 42 is set.
        if (opts.mixerColors && rgb !== undefined) {
          const v = ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >>> 16) & 0xff);
          const e = blk.find(x => x.id === EV.INS_COLOR);
          if (e) e.v = v;
          else blk.unshift({ id: EV.INS_COLOR, v, ext: null });
          const flag = blk.find(x => x.id === EV.INS_HAS_COLOR);
          if (flag) flag.v = 1;
          else blk.splice(1, 0, { id: EV.INS_HAS_COLOR, v: 1, ext: null });
        }
        // Unnamed inserts become "<project> <original insert number>"; FL keeps the name right before event 236
        if (opts.mixerNames && !hasInsertName(blk)) {
          const d = utf16z(project + ' ' + m.from);
          const e = blk.find(x => x.id === EV.INS_NAME);
          if (e) e.d = d;
          else {
            const at = blk.findIndex(x => x.id === EV.INS_FLAGS);
            blk.splice(at >= 0 ? at : blk.findIndex(x => x.id === EV.INS_HAS_COLOR) + 1, 0, { id: EV.INS_NAME, d, ext: null });
          }
        }
      }
    }

    // ---------- assemble ----------
    // 1. Mixer: insert count, blocks, params
    const outMix = [];
    for (let i = base.mixStart; i <= base.mixCountIdx; i++) outMix.push(ev[i]);
    const countEv = outMix.find(e => e.id === EV.MIX_COUNT);
    if (countEv) countEv.v = insertBlocks.length;
    else if (insertBlocks.length !== nIns) warn.push('The mixer could not be extended in this FL version');
    for (const blk of insertBlocks) outMix.push(...blk);
    // every record addresses its own insert/slot, so new ones are simply appended
    if (base.paramsIdx >= 0) ev[base.paramsIdx].d = encodeParams(params);
    const lastInsIdx = base.inserts[base.inserts.length - 1].idx.slice(-1)[0];

    // 2. Playlist items

    const plBytes = new Uint8Array(items.length * itemSize);
    items.forEach((raw, k) => plBytes.set(raw, k * itemSize));
    if (base.playlistIdx >= 0) ev[base.playlistIdx].d = plBytes;
    else if (items.length) warn.push('The base project has no playlist, clips could not be added');

    // 3. Track attributes for separate tracks
    if (trackCopies.length) {
      const trackEvIdx = new Map(); // iid -> index in ev
      for (let i = base.firstArr; i >= 0 && i < base.mixStart; i++) if (ev[i].id === EV.TRACK_DATA) trackEvIdx.set(u32(ev[i].d, 0), i);
      const nameAfter = new Map();
      for (const tc of trackCopies) {
        const P = tc.P;
        let srcData = null, srcName = null;
        for (let i = P.firstArr; i >= 0 && i < P.mixStart; i++) {
          const e = P.events[i];
          if (e.id === EV.TRACK_DATA && u32(e.d, 0) === tc.from + 1) {
            srcData = e.d;
            for (let j = i + 1; j < P.mixStart && P.events[j].id !== EV.TRACK_DATA && P.events[j].id !== 242; j++)
              if (P.events[j].id === EV.TRACK_NAME) srcName = P.events[j].d;
            break;
          }
        }
        const di = trackEvIdx.get(tc.to + 1);
        if (di === undefined || !srcData) continue;
        const d = ev[di].d.slice();
        const n = Math.min(d.length, srcData.length);
        d.set(srcData.slice(4, n), 4);
        ev[di].d = d;
        if (srcName) nameAfter.set(di, srcName);
      }
      // remove existing names on retargeted tracks and add the new ones
      for (const [di, name] of nameAfter) {
        for (let j = di + 1; j < ev.length && ev[j].id !== EV.TRACK_DATA && ev[j].id !== 242; j++) if (ev[j].id === EV.TRACK_NAME) ev[j].drop = true;
        ev[di].after = [{ id: EV.TRACK_NAME, d: name.slice(), ext: null }];
      }
    }

    // 4. Build the final event list
    const out = [];
    const firstChanIdx = base.tag.findIndex(t => t && t.sec === 'chan');
    // where to insert new patterns: after the base's last pattern block before channels
    let patInsertAt = -1, linkInsertAt = -1, groupInsertAt = -1;
    for (let i = 0; i < (firstChanIdx >= 0 ? firstChanIdx : base.firstArr); i++) {
      const t = base.tag[i];
      if (t.sec === 'pat') patInsertAt = i + 1;
      if (ev[i].id === EV.REMOTE_LINK || ev[i].id === 226) linkInsertAt = i + 1;
      if (ev[i].id === EV.GROUP_NAME) groupInsertAt = i + 1;
    }
    if (patInsertAt < 0) {
      patInsertAt = ev.findIndex((e, i) => i < (firstChanIdx >= 0 ? firstChanIdx : ev.length) && (e.id === 226 || e.id === EV.REMOTE_LINK));
      if (patInsertAt < 0) patInsertAt = firstChanIdx >= 0 ? firstChanIdx : base.firstArr;
    }
    if (linkInsertAt < 0) linkInsertAt = firstChanIdx >= 0 ? firstChanIdx : base.firstArr;
    const newGroupEvs = groups.slice(base.groups.length).map(g => ({ id: EV.GROUP_NAME, d: utf16z(g), ext: null }));
    const firstTrackIdx = ev.findIndex((e, i) => i > base.firstArr && e.id === EV.TRACK_DATA);

    for (let i = 0; i < ev.length; i++) {
      if (i === base.mixStart) {
        out.push(...outMix);
        i = lastInsIdx;
        continue;
      }
      if (i === patInsertAt) for (const blk of newPatterns) out.push(...blk);
      if (i === linkInsertAt) out.push(...newLinks);
      if (i === base.firstArr) for (const blk of newChannels) out.push(...blk);
      if (i === firstTrackIdx) for (const blk of newMarkers) out.push(...blk);
      const e = ev[i];
      if (!e.drop) out.push(e);
      if (e.after) out.push(...e.after);
      if (i + 1 === groupInsertAt) out.push(...newGroupEvs);
    }
    if (groupInsertAt < 0 && newGroupEvs.length) warn.push('Channel groups could not be added');

    const totalCh = new Set(out.filter(e => e.id === EV.CH_NEW).map(e => e.v)).size;
    const bytes = serialize({ fmt: base.fmt, nchOut: totalCh, ppq }, out);
    return { bytes, warnings: warn, report, inserts: insertBlocks.length };
  }

  function hasInsertName(blk) { const e = blk.find(x => x.id === EV.INS_NAME); return !!(e && decodeText(e.d)); }
  function shiftMarker(v, off) { const pos = v & 0x03ffffff; return ((v & ~0x03ffffff) | ((pos + off) & 0x03ffffff)) >>> 0; }
  function scaleMarker(v, r) { if (r === 1) return v; const pos = v & 0x03ffffff; return ((v & ~0x03ffffff) | (Math.round(pos * r) & 0x03ffffff)) >>> 0; }
  function hex(s) { const d = new Uint8Array(s.length / 2); for (let i = 0; i < d.length; i++) d[i] = parseInt(s.substr(i * 2, 2), 16); return d; }
  function utf16z(s) { const d = new Uint8Array((s.length + 1) * 2); for (let i = 0; i < s.length; i++) w16(d, i * 2, s.charCodeAt(i)); return d; }

  const api = { parseFLP, mergeFLP, EV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FLP = api;
})(typeof window !== 'undefined' ? window : this);
