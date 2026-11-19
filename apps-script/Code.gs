/**
 * Name the Mascot! — backend
 * Clutch L&D workshop game. Paste this into Apps Script, deploy as a web app.
 *
 * Deploy: Deploy > New deployment > Web app
 *   Execute as:      Me
 *   Who has access:  Anyone        <-- must be "Anyone", not "Anyone with a Google account"
 *
 * The Sheet this is bound to is the database. Four tabs are created automatically.
 */

// Fixed so you always know them and never have to look them up.
// Anyone who gets hold of the web app URL could guess these and drive the game,
// which is fine for a room of colleagues but don't reuse them for anything else.
var FIXED_PIN      = '1234';
var FIXED_HOST_KEY = 'Clutch123';

var SUBMIT_GRACE_MS = 2500;   // accept submits this long after the deadline (round-trip slack)
var CACHE_SECONDS   = 2;      // shared state snapshot cache
var LOCK_MS         = 15000;
var MAX_NAME_LEN    = 60;
var MAX_NICK_LEN    = 24;
var CHUNK_LEN       = 45000;  // mascot image chunk size (cell limit is 50k)

/* ---------------------------------------------------------------- plumbing */

function doGet(e)  { return handle(e && e.parameter ? e.parameter : {}); }
function doPost(e) {
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { body = (e && e.parameter) || {}; }
  return handle(body);
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function handle(p) {
  var action = String(p.action || 'state');
  try {
    switch (action) {
      // players
      case 'state':   return json(apiState(p));
      case 'join':    return json(apiJoin(p));
      case 'submit':  return json(apiSubmit(p));
      case 'vote':    return json(apiVote(p));
      case 'image':   return json(apiImage(p));
      // presenter
      case 'start':       return json(hostAction(p, hostStart));
      case 'endSubmit':   return json(hostAction(p, hostEndSubmit));
      case 'closeVoting': return json(hostAction(p, hostCloseVoting));
      case 'reveal':      return json(hostAction(p, hostReveal));
      case 'restart':     return json(hostAction(p, hostRestart));
      case 'setImage':    return json(hostAction(p, hostSetImage));
      case 'resetAll':    return json(hostAction(p, hostResetAll));
      default: return json({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return json({ ok: false, error: String((err && err.message) || err) });
  }
}

/* ------------------------------------------------------------------ sheets */

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

var TABS = {
  Game:    ['pin', 'round', 'stage', 'deadline', 'submitSeconds', 'hostKey', 'imageVersion', 'runoff', 'updatedAt'],
  Players: ['round', 'token', 'nickname', 'nickKey', 'joinedAt'],
  Entries: ['round', 'entryId', 'token', 'text', 'updatedAt'],
  Votes:   ['round', 'phase', 'token', 'entryId', 'votedAt'],
  Image:   ['version', 'idx', 'data']
};

function tab(name) {
  var book = ss();
  var sh = book.getSheetByName(name);
  if (!sh) {
    sh = book.insertSheet(name);
    sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/** All data rows of a tab as objects. */
function rows(name) {
  var sh = tab(name);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var head = TABS[name];
  var vals = sh.getRange(2, 1, last - 1, head.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var o = { _row: i + 2 };
    for (var c = 0; c < head.length; c++) o[head[c]] = vals[i][c];
    if (String(o[head[0]]) !== '') out.push(o);
  }
  return out;
}

function appendRow(name, obj) {
  var head = TABS[name];
  var line = [];
  for (var i = 0; i < head.length; i++) line.push(obj[head[i]] === undefined ? '' : obj[head[i]]);
  tab(name).appendRow(line);
}

/* -------------------------------------------------------------- game state */

function game() {
  var sh = tab('Game');
  if (sh.getLastRow() < 2) {
    var fresh = {
      pin: FIXED_PIN, round: 1, stage: 'lobby', deadline: 0, submitSeconds: 60,
      hostKey: FIXED_HOST_KEY, imageVersion: 0, runoff: '', updatedAt: Date.now()
    };
    appendRow('Game', fresh);
    return fresh;
  }
  var head = TABS.Game;
  var vals = sh.getRange(2, 1, 1, head.length).getValues()[0];
  var g = {};
  for (var i = 0; i < head.length; i++) g[head[i]] = vals[i];
  g.round = Number(g.round) || 1;
  g.deadline = Number(g.deadline) || 0;
  g.submitSeconds = Number(g.submitSeconds) || 60;
  g.imageVersion = Number(g.imageVersion) || 0;
  g.runoff = String(g.runoff || '');
  // Always the fixed values, even if the Sheet still holds older random ones.
  if (String(g.pin) !== FIXED_PIN || String(g.hostKey) !== FIXED_HOST_KEY) {
    g.pin = FIXED_PIN;
    g.hostKey = FIXED_HOST_KEY;
    saveGame(g);
  }
  return g;
}

function saveGame(g) {
  var head = TABS.Game;
  g.updatedAt = Date.now();
  var line = [];
  for (var i = 0; i < head.length; i++) line.push(g[head[i]] === undefined ? '' : g[head[i]]);
  tab('Game').getRange(2, 1, 1, head.length).setValues([line]);
  bust();
}

function bust() { try { CacheService.getScriptCache().remove('shared'); } catch (e) {} }

function makeToken(len) {
  var abc = 'abcdefghijkmnpqrstuvwxyz23456789', s = '';
  for (var i = 0; i < (len || 16); i++) s += abc.charAt(Math.floor(Math.random() * abc.length));
  return s;
}
function nickKey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(LOCK_MS);
  try { return fn(); } finally { try { lock.releaseLock(); } catch (e) {} }
}

/* --------------------------------------------------- auto stage transitions */

/**
 * If the submission clock has run out, move everyone to voting.
 * Idempotent: re-checks the stage inside the lock.
 */
function maybeAdvance(g) {
  if (g.stage !== 'submitting') return g;
  if (!g.deadline || Date.now() <= g.deadline + SUBMIT_GRACE_MS) return g;
  return withLock(function () {
    var cur = game();
    if (cur.stage !== 'submitting') return cur;
    if (Date.now() <= cur.deadline + SUBMIT_GRACE_MS) return cur;
    cur.stage = 'voting';
    cur.deadline = 0;
    saveGame(cur);
    return cur;
  });
}

/* ------------------------------------------------------------- shared state */

/** The part of the state that is the same for everybody (cached). */
function sharedState() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('shared');
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }

  var g = maybeAdvance(game());
  var round = g.round;
  var players = rows('Players').filter(function (r) { return Number(r.round) === round; });
  var entries = rows('Entries').filter(function (r) { return Number(r.round) === round; });
  var votes   = rows('Votes').filter(function (r) { return Number(r.round) === round; });

  var phase = (g.stage === 'runoff') ? 'runoff' : 'main';
  var phaseVotes = votes.filter(function (v) { return String(v.phase) === phase; });

  var runoffIds = g.runoff ? g.runoff.split(',') : [];

  var visible = entries;
  if (g.stage === 'runoff') {
    visible = entries.filter(function (e) { return runoffIds.indexOf(String(e.entryId)) >= 0; });
  }

  var s = {
    ok: true,
    round: round,
    stage: g.stage,
    deadline: g.deadline,
    submitSeconds: g.submitSeconds,
    imageVersion: g.imageVersion,
    playerCount: players.length,
    submissionCount: entries.length,
    voteCount: phaseVotes.length,
    entries: [],
    results: null,
    winner: null,
    tiedCount: 0
  };

  // Entry list: text only, no author, no counts. Shuffled stably by entryId.
  if (g.stage === 'voting' || g.stage === 'runoff' || g.stage === 'results') {
    s.entries = visible.map(function (e) {
      return { id: String(e.entryId), text: String(e.text) };
    }).sort(function (a, b) { return a.id < b.id ? -1 : 1; });
  }

  if (g.stage === 'results') {
    var byToken = {};
    players.forEach(function (p) { byToken[String(p.token)] = String(p.nickname); });

    // Count main-phase votes, then runoff votes decide among the tied.
    var mainCount = {}, runCount = {};
    entries.forEach(function (e) { mainCount[String(e.entryId)] = 0; runCount[String(e.entryId)] = 0; });
    votes.forEach(function (v) {
      var id = String(v.entryId);
      if (String(v.phase) === 'runoff') { if (id in runCount) runCount[id]++; }
      else { if (id in mainCount) mainCount[id]++; }
    });

    var table = entries.map(function (e) {
      var id = String(e.entryId);
      return {
        id: id,
        text: String(e.text),
        votes: mainCount[id] || 0,
        runoffVotes: runCount[id] || 0,
        nickname: byToken[String(e.token)] || 'Unknown'
      };
    });

    var pool = table;
    var usedRunoff = runoffIds.length > 0;
    if (usedRunoff) {
      pool = table.filter(function (t) { return runoffIds.indexOf(t.id) >= 0; });
    }
    var key = usedRunoff ? 'runoffVotes' : 'votes';
    var best = -1;
    pool.forEach(function (t) { if (t[key] > best) best = t[key]; });
    var top = pool.filter(function (t) { return t[key] === best; });

    table.sort(function (a, b) { return (b[key] || 0) - (a[key] || 0) || (b.votes - a.votes); });
    s.results = table;
    s.tiedCount = top.length;
    if (top.length === 1) {
      s.winner = top[0];
      s.winner.decidedBy = usedRunoff ? 'runoff' : 'vote';
    } else if (top.length > 1) {
      // Still tied after a runoff: pick at random, and say so.
      var pick = top[Math.floor(Math.random() * top.length)];
      s.winner = pick;
      s.winner.decidedBy = 'coin-toss';
    }
    s.winner = s.winner || null;
  }

  try { cache.put('shared', JSON.stringify(s), CACHE_SECONDS); } catch (e) {}
  return s;
}

/* --------------------------------------------------------------- player API */

function apiState(p) {
  var s = sharedState();
  s.serverNow = Date.now();

  var token = String(p.token || '');
  s.me = null;
  if (token) {
    var round = s.round;
    var me = rows('Players').filter(function (r) {
      return Number(r.round) === round && String(r.token) === token;
    })[0];
    if (me) {
      var myEntry = rows('Entries').filter(function (e) {
        return Number(e.round) === round && String(e.token) === token;
      })[0];
      var phase = (s.stage === 'runoff') ? 'runoff' : 'main';
      var myVote = rows('Votes').filter(function (v) {
        return Number(v.round) === round && String(v.token) === token && String(v.phase) === phase;
      })[0];
      s.me = {
        nickname: String(me.nickname),
        hasSubmitted: !!myEntry,
        myText: myEntry ? String(myEntry.text) : '',
        myEntryId: myEntry ? String(myEntry.entryId) : '',
        hasVoted: !!myVote,
        votedFor: myVote ? String(myVote.entryId) : ''
      };
      // Flag the player's own entry so the page can disable it.
      for (var i = 0; i < s.entries.length; i++) {
        s.entries[i].mine = (s.entries[i].id === s.me.myEntryId);
      }
    }
  }

  // The presenter sees who is in the room; players never do.
  if (isHost(p)) {
    s.host = true;
    s.pin = String(game().pin);
    var r2 = s.round;
    s.players = rows('Players')
      .filter(function (r) { return Number(r.round) === r2; })
      .map(function (r) { return String(r.nickname); });
    s.hostKey = undefined;
  }
  return s;
}

function apiJoin(p) {
  var nickname = String(p.nickname || '').trim().slice(0, MAX_NICK_LEN);
  if (!nickname) return { ok: false, error: 'Enter a name first' };
  var key = nickKey(nickname);
  if (!key) return { ok: false, error: 'Use at least one letter or number' };

  return withLock(function () {
    var g = game();
    if (String(p.pin || '').trim() !== String(g.pin)) {
      return { ok: false, error: 'bad_pin' };
    }
    if (g.stage === 'voting' || g.stage === 'runoff' || g.stage === 'results') {
      // Returning players may still resume; brand new ones cannot sneak in to vote.
      var existing = rows('Players').filter(function (r) {
        return Number(r.round) === g.round && nickKey(r.nickname) === key;
      })[0];
      if (!existing) return { ok: false, error: 'Voting has started — joining is closed' };
      return { ok: true, token: String(existing.token), nickname: String(existing.nickname), resumed: true };
    }
    var mine = rows('Players').filter(function (r) {
      return Number(r.round) === g.round && nickKey(r.nickname) === key;
    })[0];
    if (mine) {
      // Same name = same player. Lets a refreshed or reopened phone come back.
      return { ok: true, token: String(mine.token), nickname: String(mine.nickname), resumed: true };
    }
    var token = makeToken(16);
    appendRow('Players', {
      round: g.round, token: token, nickname: nickname,
      nickKey: key, joinedAt: new Date()
    });
    bust();
    return { ok: true, token: token, nickname: nickname, resumed: false };
  });
}

function apiSubmit(p) {
  var token = String(p.token || '');
  var text = String(p.text || '').trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LEN);
  if (!token) return { ok: false, error: 'not_joined' };
  if (!text) return { ok: false, error: 'Type a name first' };

  return withLock(function () {
    var g = maybeAdvance(game());
    if (g.stage !== 'submitting') return { ok: false, error: 'Submissions are closed' };
    if (g.deadline && Date.now() > g.deadline + SUBMIT_GRACE_MS) {
      return { ok: false, error: 'Time is up' };
    }
    var player = rows('Players').filter(function (r) {
      return Number(r.round) === g.round && String(r.token) === token;
    })[0];
    if (!player) return { ok: false, error: 'not_joined' };

    var sh = tab('Entries');
    var existing = rows('Entries').filter(function (e) {
      return Number(e.round) === g.round && String(e.token) === token;
    })[0];

    if (existing) {
      // One entry per player; editing overwrites it in place.
      sh.getRange(existing._row, 4).setValue(text);
      sh.getRange(existing._row, 5).setValue(new Date());
    } else {
      appendRow('Entries', {
        round: g.round, entryId: makeToken(8), token: token,
        text: text, updatedAt: new Date()
      });
    }
    bust();
    return { ok: true, text: text };
  });
}

function apiVote(p) {
  var token = String(p.token || '');
  var entryId = String(p.entryId || '');
  if (!token || !entryId) return { ok: false, error: 'bad_request' };

  return withLock(function () {
    var g = game();
    if (g.stage !== 'voting' && g.stage !== 'runoff') return { ok: false, error: 'Voting is not open' };
    var phase = (g.stage === 'runoff') ? 'runoff' : 'main';

    var player = rows('Players').filter(function (r) {
      return Number(r.round) === g.round && String(r.token) === token;
    })[0];
    if (!player) return { ok: false, error: 'not_joined' };

    var already = rows('Votes').filter(function (v) {
      return Number(v.round) === g.round && String(v.token) === token && String(v.phase) === phase;
    })[0];
    if (already) return { ok: false, error: 'You have already voted' };

    var entry = rows('Entries').filter(function (e) {
      return Number(e.round) === g.round && String(e.entryId) === entryId;
    })[0];
    if (!entry) return { ok: false, error: 'That name is no longer in the running' };
    if (String(entry.token) === token) return { ok: false, error: 'You cannot vote for your own name' };
    if (g.stage === 'runoff') {
      var ids = g.runoff ? g.runoff.split(',') : [];
      if (ids.indexOf(entryId) < 0) return { ok: false, error: 'That name is not in the runoff' };
    }

    appendRow('Votes', {
      round: g.round, phase: phase, token: token,
      entryId: entryId, votedAt: new Date()
    });
    bust();
    return { ok: true };
  });
}

/** Mascot image, fetched once per version — never inside the state poll. */
function apiImage(p) {
  var g = game();
  if (!g.imageVersion) return { ok: true, version: 0, dataUrl: '' };
  var want = Number(p.version || g.imageVersion);
  var parts = rows('Image').filter(function (r) { return Number(r.version) === want; });
  parts.sort(function (a, b) { return Number(a.idx) - Number(b.idx); });
  return {
    ok: true,
    version: want,
    dataUrl: parts.map(function (r) { return String(r.data); }).join('')
  };
}

/* ----------------------------------------------------------- presenter API */

function isHost(p) {
  var g = game();
  return !!p.hostKey && String(p.hostKey) === String(g.hostKey);
}

function hostAction(p, fn) {
  if (!isHost(p)) return { ok: false, error: 'not_host' };
  return withLock(function () { return fn(p, game()); });
}

function hostStart(p, g) {
  var secs = Number(p.seconds || g.submitSeconds || 60);
  if (!(secs > 4 && secs < 601)) secs = 60;
  g.stage = 'submitting';
  g.submitSeconds = secs;
  g.deadline = Date.now() + secs * 1000;
  g.runoff = '';
  saveGame(g);
  return { ok: true };
}

function hostEndSubmit(p, g) {
  if (g.stage !== 'submitting') return { ok: false, error: 'Not taking submissions' };
  g.stage = 'voting';
  g.deadline = 0;
  saveGame(g);
  return { ok: true };
}

/** Close voting. A tie sends the tied names to a runoff instead of results. */
function hostCloseVoting(p, g) {
  if (g.stage !== 'voting' && g.stage !== 'runoff') return { ok: false, error: 'Voting is not open' };

  var entries = rows('Entries').filter(function (e) { return Number(e.round) === g.round; });
  var phase = (g.stage === 'runoff') ? 'runoff' : 'main';
  var votes = rows('Votes').filter(function (v) {
    return Number(v.round) === g.round && String(v.phase) === phase;
  });

  var pool = entries;
  if (g.stage === 'runoff') {
    var ids = g.runoff ? g.runoff.split(',') : [];
    pool = entries.filter(function (e) { return ids.indexOf(String(e.entryId)) >= 0; });
  }

  var count = {};
  pool.forEach(function (e) { count[String(e.entryId)] = 0; });
  votes.forEach(function (v) { var id = String(v.entryId); if (id in count) count[id]++; });

  var best = -1;
  pool.forEach(function (e) { var c = count[String(e.entryId)]; if (c > best) best = c; });
  var tied = pool.filter(function (e) { return count[String(e.entryId)] === best; });

  // Already in a runoff, or fewer than two names tied: settle it.
  if (g.stage === 'runoff' || tied.length < 2 || tied.length === pool.length && pool.length < 2) {
    g.stage = 'results';
    g.deadline = 0;
    saveGame(g);
    return { ok: true, tie: false };
  }
  if (tied.length >= 2) {
    g.stage = 'runoff';
    g.runoff = tied.map(function (e) { return String(e.entryId); }).join(',');
    g.deadline = 0;
    saveGame(g);
    return { ok: true, tie: true, tiedCount: tied.length };
  }
  g.stage = 'results';
  saveGame(g);
  return { ok: true, tie: false };
}

function hostReveal(p, g) {
  g.stage = 'results';
  g.deadline = 0;
  saveGame(g);
  return { ok: true };
}

/** New round: same PIN, same QR, same players have to rejoin. */
function hostRestart(p, g) {
  g.round = Number(g.round) + 1;
  g.stage = 'lobby';
  g.deadline = 0;
  g.runoff = '';
  saveGame(g);
  return { ok: true, round: g.round };
}

function hostSetImage(p, g) {
  var dataUrl = String(p.dataUrl || '');
  var version = Number(g.imageVersion || 0) + 1;
  var sh = tab('Image');
  if (dataUrl) {
    for (var i = 0; i < dataUrl.length; i += CHUNK_LEN) {
      appendRow('Image', { version: version, idx: i / CHUNK_LEN, data: dataUrl.substr(i, CHUNK_LEN) });
    }
  }
  g.imageVersion = dataUrl ? version : 0;
  saveGame(g);
  return { ok: true, version: g.imageVersion };
}

/** Wipe every round and start over. The PIN stays 1234. */
function hostResetAll(p, g) {
  ['Players', 'Entries', 'Votes'].forEach(function (name) {
    var sh = tab(name);
    if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  });
  g.round = 1;
  g.stage = 'lobby';
  g.deadline = 0;
  g.runoff = '';
  g.pin = FIXED_PIN;
  saveGame(g);
  return { ok: true, pin: g.pin };
}

/* ------------------------------------------------------------------- setup */

/** Run this once from the editor: creates the tabs and prints the PIN and key. */
function setup() {
  Object.keys(TABS).forEach(function (n) { tab(n); });
  var g = game();
  Logger.log('PIN: %s', g.pin);
  Logger.log('Presenter key: %s', g.hostKey);
  return g;
}

/** Shows the presenter key again if you lose it. */
function showHostKey() {
  var g = game();
  Logger.log('PIN: %s   Presenter key: %s', g.pin, g.hostKey);
  return g.hostKey;
}
