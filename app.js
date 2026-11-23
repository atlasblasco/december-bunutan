/* Bunutan participant page. All decryption happens on this device; nothing is sent anywhere. */
(function () {
  "use strict";

  /* ---------- Core crypto (also used by test-crypto.js) ---------- */
  function normalizeCode(c) { return String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

  function fromB64(s) {
    var bin = atob(s), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Returns the recipient's name, or null if the code is wrong.
  async function unlock(person, code, iterations) {
    try {
      var enc = new TextEncoder();
      var base = await crypto.subtle.importKey("raw", enc.encode(normalizeCode(code)), "PBKDF2", false, ["deriveKey"]);
      var key = await crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: fromB64(person.s), iterations: iterations, hash: "SHA-256" },
        base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
      var plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromB64(person.i), additionalData: enc.encode(person.n) }, key, fromB64(person.c));
      return JSON.parse(new TextDecoder().decode(plain)).to;
    } catch (e) {
      return null;
    }
  }

  if (typeof module !== "undefined") module.exports = { unlock: unlock, normalizeCode: normalizeCode };
  if (typeof document === "undefined") return;

  /* ---------- Page ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var DATA = window.BUNUTAN_DATA;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var wait = function (ms) { return new Promise(function (r) { setTimeout(r, reduceMotion ? 0 : ms); }); };

  if (!DATA || !DATA.people || !DATA.people.length) {
    $("formCard").innerHTML = '<h2>Not ready yet 🎄</h2><p class="lead">The draw hasn\'t been set up. Please check back later or message the organizer.</p>';
    return;
  }

  var names = DATA.people.map(function (p) { return p.n; });
  var ev = DATA.event || {};
  if (ev.name) { $("evName").textContent = ev.name; document.title = ev.name + " 🎁"; }
  var metaBits = [];
  if (ev.budget) metaBits.push("Budget: " + ev.budget);
  if (ev.date) metaBits.push("Exchange: " + ev.date);
  $("evMeta").textContent = metaBits.join("  ·  ");

  /* ----- Searchable dropdown ----- */
  var input = $("nameInput"), list = $("nameList");
  var selected = null, active = -1, shown = [];

  function openList() {
    var q = input.value.trim().toLowerCase();
    shown = names.filter(function (n) { return n.toLowerCase().indexOf(q) !== -1; });
    list.innerHTML = "";
    if (!shown.length) {
      var li = document.createElement("li");
      li.className = "empty"; li.textContent = "No match. Check the spelling.";
      list.appendChild(li);
    }
    shown.forEach(function (n, i) {
      var li = document.createElement("li");
      li.id = "opt-" + i; li.setAttribute("role", "option"); li.textContent = n;
      li.setAttribute("aria-selected", i === active ? "true" : "false");
      li.addEventListener("mousedown", function (e) { e.preventDefault(); choose(n); });
      list.appendChild(li);
    });
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }
  function closeList() { list.hidden = true; input.setAttribute("aria-expanded", "false"); active = -1; input.removeAttribute("aria-activedescendant"); }
  function choose(n) { selected = n; input.value = n; closeList(); $("error").textContent = ""; $("codeInput").focus(); }
  function highlight(i) {
    active = i;
    Array.prototype.forEach.call(list.children, function (li, k) { li.setAttribute("aria-selected", k === i ? "true" : "false"); });
    var el = $("opt-" + i);
    if (el) { el.scrollIntoView({ block: "nearest" }); input.setAttribute("aria-activedescendant", el.id); }
  }

  input.addEventListener("input", function () { selected = null; active = -1; openList(); });
  input.addEventListener("focus", openList);
  input.addEventListener("blur", function () { setTimeout(closeList, 120); });
  input.addEventListener("keydown", function (e) {
    if (list.hidden && (e.key === "ArrowDown" || e.key === "ArrowUp")) openList();
    if (e.key === "ArrowDown") { e.preventDefault(); highlight(Math.min(active + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); highlight(Math.max(active - 1, 0)); }
    else if (e.key === "Enter" && !list.hidden && active >= 0) { e.preventDefault(); choose(shown[active]); }
    else if (e.key === "Escape") closeList();
  });

  function resolveName() {
    if (selected) return selected;
    var typed = input.value.trim().toLowerCase();
    for (var i = 0; i < names.length; i++) if (names[i].toLowerCase() === typed) return names[i];
    return null;
  }

  /* ----- Draw ----- */
  var GENERIC_ERROR = "Hmm, that didn't work. Please check your name and code and try again. 🎄";

  $("drawForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var err = $("error"), btn = $("drawBtn");
    err.textContent = "";
    var name = resolveName();
    var code = normalizeCode($("codeInput").value);
    if (!name) { err.textContent = "Please pick your name from the list."; input.focus(); return; }
    if (!code) { err.textContent = "Please type your secret code."; $("codeInput").focus(); return; }

    btn.disabled = true; btn.textContent = "Checking…";
    var person = DATA.people.find(function (p) { return p.n === name; });
    var result = await unlock(person, code, DATA.iter);
    btn.disabled = false; btn.textContent = "🎁 Draw my name";

    if (!result) { err.textContent = ""; void err.offsetWidth; err.textContent = GENERIC_ERROR; return; }
    $("codeInput").value = "";
    await play(name, result);
  });

  async function play(me, recipient) {
    $("formCard").hidden = true;
    var stage = $("stage"), reel = $("reelName"), gift = $("gift"), text = $("stageText");
    reel.parentElement.classList.remove("done");
    gift.className = "gift";
    text.textContent = "Binubunot na…";
    stage.hidden = false;

    if (!reduceMotion) {
      // 1) Shuffle names, slowing down like a spinning drum.
      var pool = names.filter(function (n) { return n !== me; });
      var delay = 55;
      while (delay < 360) {
        reel.textContent = pool[Math.floor(Math.random() * pool.length)]; // visual only
        reel.classList.remove("tick"); void reel.offsetWidth; reel.classList.add("tick");
        await wait(delay);
        delay *= 1.12;
      }
      reel.textContent = "🎁 🎁 🎁";
      reel.parentElement.classList.add("done");
      // 2) Gift box shakes, then opens.
      text.textContent = "Ayan na!";
      gift.classList.add("ready", "shake");
      await wait(950);
      gift.classList.remove("shake");
      gift.classList.add("open");
      confetti();
      await wait(800);
    }

    // 3) Reveal.
    stage.hidden = true;
    $("resultHello").textContent = "Hi, " + me + "!";
    $("revealName").textContent = recipient;
    var d = $("details"); d.innerHTML = "";
    if (ev.budget) addDetail(d, "💰 Budget: " + ev.budget);
    if (ev.date) addDetail(d, "📅 Exchange: " + ev.date);
    var card = $("resultCard");
    card.hidden = false;
    card.focus();
  }
  function addDetail(ul, t) { var li = document.createElement("li"); li.textContent = t; ul.appendChild(li); }

  $("hideBtn").addEventListener("click", function () {
    $("resultCard").hidden = true;
    $("revealName").textContent = "—";
    input.value = ""; selected = null;
    $("formCard").hidden = false;
    window.scrollTo(0, 0);
  });

  /* ----- Canvas helpers ----- */
  function fitCanvas(c) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    var ctx = c.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  /* Falling snow (lightweight) */
  (function snow() {
    if (reduceMotion) return;
    var c = $("snow"), ctx = fitCanvas(c), flakes = [];
    var count = Math.min(70, Math.round(innerWidth / 8));
    for (var i = 0; i < count; i++) flakes.push(newFlake(true));
    function newFlake(any) {
      return { x: Math.random() * innerWidth, y: any ? Math.random() * innerHeight : -10,
        r: 1 + Math.random() * 2.6, s: .3 + Math.random() * .9, w: Math.random() * Math.PI * 2, o: .4 + Math.random() * .5 };
    }
    addEventListener("resize", function () { ctx = fitCanvas(c); });
    (function frame() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (var i = 0; i < flakes.length; i++) {
        var f = flakes[i];
        f.y += f.s; f.w += .01; f.x += Math.sin(f.w) * .4;
        if (f.y > innerHeight + 10) flakes[i] = newFlake(false);
        ctx.beginPath(); ctx.fillStyle = "rgba(255,255,255," + f.o + ")";
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
      }
      if (!document.hidden) requestAnimationFrame(frame); else setTimeout(frame, 500);
    })();
  })();

  /* Confetti burst */
  function confetti() {
    var c = $("confetti"), ctx = fitCanvas(c), parts = [];
    var colors = ["#c8102e", "#f2c14e", "#1f8a4c", "#ffffff", "#ff6b81", "#ffe7a3"];
    var cx = innerWidth / 2, cy = innerHeight * .45;
    for (var i = 0; i < 160; i++) {
      var a = Math.random() * Math.PI * 2, sp = 4 + Math.random() * 9;
      parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 6,
        w: 6 + Math.random() * 6, h: 4 + Math.random() * 8, rot: Math.random() * 6, vr: (Math.random() - .5) * .4,
        col: colors[i % colors.length], round: Math.random() < .3 });
    }
    var start = performance.now();
    (function frame(t) {
      var age = (t - start) / 1000;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, age - 2.4) / 1.2);
      parts.forEach(function (p) {
        p.vy += .22; p.vx *= .985; p.vy *= .985;
        p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.col;
        if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2.4, 0, Math.PI * 2); ctx.fill(); }
        else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot)));
        ctx.restore();
      });
      if (age < 3.6) requestAnimationFrame(frame); else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })(start);
  }
})();
