const socket = io();

// ---- Intro crawl - shown every time /play loads, unless the player
// has explicitly chosen "Never show again" ----
(function initIntroCrawl() {
  const overlay = document.getElementById("intro-crawl-overlay");
  const crawlText = document.getElementById("crawl-text");
  const bodyEl = document.getElementById("crawl-body");
  if (!overlay) return;

  let neverShow = false;
  try {
    neverShow = localStorage.getItem("watchtower_intro_never_show") === "1";
  } catch (e) {
    neverShow = false;
  }

  if (neverShow) {
    overlay.classList.add("crawl-hidden");
    return;
  }

  bodyEl.innerHTML = (INTRO_SCRIPT || "")
    .split("\n\n")
    .map(para => para.trim())
    .filter(Boolean)
    .map(para => `<span class="crawl-para">${para}</span><br><br>`)
    .join("");

  const dismiss = () => {
    overlay.classList.add("crawl-hidden");
  };

  crawlText.addEventListener("animationend", dismiss);
  window.skipIntroCrawl = dismiss;
  window.neverShowIntroCrawl = () => {
    try {
      localStorage.setItem("watchtower_intro_never_show", "1");
    } catch (e) { /* ignore - private browsing etc, just won't persist */ }
    dismiss();
  };
})();

// ---- animated overlay show/hide (fade + scale, see .map-overlay CSS) ----
function showOverlay(id) {
  document.getElementById(id).classList.add("overlay-open");
}
function hideOverlay(id) {
  document.getElementById(id).classList.remove("overlay-open");
}

// ---- Alerts log - every prompt/alert Watchtower sends this player is
// recorded here (in-memory, current session only) with a reopen callback
// so a missed or accidentally-dismissed prompt can always be pulled back
// up from the Alerts tab. ----
let alertsLog = [];
let alertsUnreadCount = 0;
let alertsSeq = 0;

function logAlert(title, subtitle, reopenFn) {
  alertsSeq += 1;
  alertsLog.unshift({
    id: alertsSeq,
    time: new Date(),
    title,
    subtitle: subtitle || "",
    reopenFn,
  });
  alertsUnreadCount += 1;
  updateAlertsBadge();
  const overlay = document.getElementById("alerts-overlay");
  if (overlay && overlay.classList.contains("overlay-open")) {
    renderAlertsList();
  }
}

function updateAlertsBadge() {
  const badge = document.getElementById("alerts-badge");
  if (!badge) return;
  if (alertsUnreadCount > 0) {
    badge.textContent = alertsUnreadCount > 99 ? "99+" : String(alertsUnreadCount);
    badge.style.display = "inline-block";
  } else {
    badge.style.display = "none";
  }
}

function renderAlertsList() {
  const body = document.getElementById("alerts-body");
  if (!body) return;
  if (!alertsLog.length) {
    body.innerHTML = `<div class="empty">No alerts yet this session.</div>`;
    return;
  }
  body.innerHTML = alertsLog.map(e => `
    <div class="alert-log-item" data-id="${e.id}">
      <div class="alert-log-time">${e.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
      <div class="alert-log-title">${e.title}</div>
      ${e.subtitle ? `<div class="alert-log-sub">${e.subtitle}</div>` : ""}
    </div>
  `).join("");
  body.querySelectorAll(".alert-log-item").forEach(el => {
    el.addEventListener("click", () => {
      const entry = alertsLog.find(a => String(a.id) === el.dataset.id);
      if (entry && entry.reopenFn) {
        hideOverlay("alerts-overlay");
        entry.reopenFn();
      }
    });
  });
}

function openAlerts() {
  alertsUnreadCount = 0;
  updateAlertsBadge();
  renderAlertsList();
  showOverlay("alerts-overlay");
}
function closeAlerts() {
  hideOverlay("alerts-overlay");
}

// ---- Type: X tags render as a small stylized letter badge instead of
// the plain word, matching the team badge colors used elsewhere ----
const TYPE_BADGE = {
  civilian: '<span class="type-tag type-tag-civilian">C</span>',
  hero: '<span class="type-tag type-tag-hero">H</span>',
  villain: '<span class="type-tag type-tag-villain">V</span>',
};
function styleTypeTags(text) {
  return text.replace(/type:?\s*(civilian|hero|villain)(\s+only)?/gi, (m, cls, only) => {
    return "Type: " + TYPE_BADGE[cls.toLowerCase()] + (only ? " only" : "");
  });
}

// ---- ability text parser (KIND ABILITY[.:] Title[.!?…] Description) ----
// Title-ending punctuation is "." (stripped - just a neutral sentence
// end) or "!"/"?"/an ellipsis (kept - usually part of the title's own
// flavor, e.g. "Zip!", "Bzz!", "Join Me…").
function parseAbilityText(a) {
  const m = a.match(/^([A-Z ]+ABILITY)[.:]\s*(.+?)(\.\.\.|\u2026|[.!?])\s*([\s\S]*)$/);
  if (!m) return null;
  const [, kind, titleBase, term, rawDesc] = m;
  const keepTerm = term === "." ? "" : (term === "..." || term === "\u2026" ? "\u2026" : term);
  const desc = styleTypeTags(rawDesc.replace(/^[.\s]+/, ""));
  return { kind, title: titleBase + keepTerm, desc };
}

let myName = localStorage.getItem("watchtower_name") || "";
let myVote = null;
let latestState = null;

if (myName) showGame();

socket.on("connect", () => {
  socket.emit("register_player", { name: myName });
});

socket.on("whoami_result", (data) => {
  renderWhoAmI((data && data.characters) || []);
});

function setName() {
  const v = document.getElementById("player-name").value.trim();
  if (!v) return;
  myName = v;
  localStorage.setItem("watchtower_name", v);
  socket.emit("register_player", { name: myName });
  showGame();
}

function showGame() {
  document.getElementById("name-gate").style.display = "none";
  document.getElementById("game-view").style.display = "block";
  document.getElementById("player-toolbar").style.display = "flex";
}

function renderWhoAmI(characters) {
  updateLinksTabVisibility(characters || []);
  const el = document.getElementById("whoami-banner");
  if (!el) return;
  if (!characters.length) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  el.style.display = "block";
  el.textContent = characters.length === 1
    ? `You are ${characters[0]}`
    : `You are: ${characters.join(", ")}`;
}

// The Links tab only matters to whoever is currently Martian Manhunter or
// Miss Martian - everyone else never sees the button.
function updateLinksTabVisibility(characters) {
  const btn = document.getElementById("links-tab-btn");
  if (!btn) return;
  const isTelepath = characters.includes("Martian Manhunter") || characters.includes("Miss Martian");
  btn.style.display = isTelepath ? "" : "none";
}

// ---- shuffle reveal ----
function showShuffleReveal(data) {
  document.getElementById("reveal-name").textContent = data.character;
  showOverlay("shuffle-overlay");
}
socket.on("shuffle_reveal", (data) => {
  showShuffleReveal(data);
  logAlert("Character Assigned", data.character, () => showShuffleReveal(data));
});

function closeReveal() {
  hideOverlay("shuffle-overlay");
}

// ---- super ability unlocked (Round 3+) ----
function showSuperOverlay(data) {
  document.getElementById("super-character-name").textContent = data.character;
  document.getElementById("super-ability-text").textContent = data.ability;
  showOverlay("super-overlay");
}
socket.on("super_ability_unlocked", (data) => {
  showSuperOverlay(data);
  logAlert("Super Ability Unlocked", `${data.character} — ${data.ability}`, () => showSuperOverlay(data));
});

function closeSuperOverlay() {
  hideOverlay("super-overlay");
}

// ---- vibration feedback (Android only - iOS Safari has never
// implemented the Vibration API, so this silently does nothing there) ----
function vibrateDevice(pattern) {
  if (navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

// ---- conditions (Exposed / Eliminated / Rescued / Targeted) ----
socket.on("condition_alert", (data) => {
  if (data.title === "Eliminated!") {
    vibrateDevice([200, 100, 200, 100, 400]);
  }
  renderConditionOverlay([data]);
  logAlert(data.title, data.body, () => renderConditionOverlay([data]));
});

socket.on("hp_lost", (data) => {
  vibrateDevice(150);
});

socket.on("condition_recap", (data) => {
  const conditions = data.conditions || [];
  renderConditionOverlay(conditions);
  if (conditions.length) {
    logAlert("Status Recap", conditions.map(c => c.title).join(", "), () => renderConditionOverlay(conditions));
  }
});

function renderConditionOverlay(conditions) {
  if (!conditions.length) return;
  const body = document.getElementById("condition-list-body");
  body.innerHTML = conditions.map(c => `
    <div class="condition-entry">
      <div class="reveal-label" style="color:var(--amber)">${c.title}</div>
      <div style="font-size:14px; color:var(--text); margin:8px 0 14px; line-height:1.5">${c.body}</div>
    </div>
  `).join("");
  showOverlay("condition-overlay");
}

function closeConditionOverlay() {
  hideOverlay("condition-overlay");
}

// ---- game over ----
function showGameOver(data) {
  document.getElementById("gameover-title").textContent = data.title;
  document.getElementById("gameover-message").textContent = data.message;
  showOverlay("gameover-overlay");
}
socket.on("game_over", (data) => {
  showGameOver(data);
  logAlert(data.title, data.message, () => showGameOver(data));
});

function closeGameOver() {
  hideOverlay("gameover-overlay");
}

// ---- ask Watchtower (silent Martian-check inspection) ----
function showInspectPrompt(data) {
  const list = document.getElementById("inspect-candidate-list");
  const candidates = data.candidates || [];
  list.innerHTML = candidates.length
    ? candidates.map(name => `<div class="hostage-target" data-name="${name}">${name}</div>`).join("")
    : `<div class="empty">No one else is active right now.</div>`;
  list.querySelectorAll(".hostage-target").forEach(el => {
    el.addEventListener("click", () => submitInspectTarget(el.dataset.name));
  });
  showOverlay("inspect-prompt-overlay");
}
socket.on("inspect_prompt", (data) => {
  showInspectPrompt(data);
  logAlert("Inspect Prompt", "Ask Watchtower if another player is a White Martian", () => showInspectPrompt(data));
});

function submitInspectTarget(targetName) {
  socket.emit("ask_watchtower", { asker: myName, target_name: targetName });
  hideOverlay("inspect-prompt-overlay");
  document.getElementById("inspect-waiting-target").textContent = targetName;
  showOverlay("inspect-waiting-overlay");
}

socket.on("ask_watchtower_error", (data) => {
  hideOverlay("inspect-waiting-overlay");
  alert(data.message);
});

function showInspectAnswer(data) {
  document.getElementById("inspect-answer-text").textContent =
    data.answer ? `Yes, ${data.target_name} is a White Martian!` : `No, ${data.target_name} is not a White Martian.`;
  showOverlay("inspect-answer-overlay");
}
socket.on("inspection_answer", (data) => {
  hideOverlay("inspect-waiting-overlay");
  showInspectAnswer(data);
  logAlert("Watchtower Answered", data.answer ? `Yes, ${data.target_name} is a White Martian!` : `No, ${data.target_name} is not a White Martian.`, () => showInspectAnswer(data));
});

function closeInspectAnswer() {
  hideOverlay("inspect-answer-overlay");
}

// ---- Protect phase - silently choose who to shield ----
function renderProtectCandidates(candidates) {
  const list = document.getElementById("protect-candidate-list");
  const items = (candidates || []).length
    ? candidates.map(name => {
        const label = name.trim().toLowerCase() === myName.trim().toLowerCase() ? `${name} (yourself)` : name;
        return `<div class="hostage-target" data-name="${name}">${label}</div>`;
      }).join("")
    : `<div class="empty">No one else is active right now.</div>`;
  list.innerHTML = items;
  list.querySelectorAll(".hostage-target").forEach(el => {
    el.addEventListener("click", () => submitProtectTarget(el.dataset.name));
  });
}

function showProtectPrompt(data) {
  document.getElementById("protect-reject-msg").style.display = "none";
  renderProtectCandidates(data.candidates || []);
  showOverlay("protect-prompt-overlay");
}
socket.on("protect_prompt", (data) => {
  showProtectPrompt(data);
  logAlert("Protect Prompt", "Choose a player to shield", () => showProtectPrompt(data));
});

// A higher-priority protector already claimed your target - pick again.
// Reopens the same prompt with an error banner and a fresh candidate list;
// no host action needed.
function showProtectRejection(data) {
  const msg = document.getElementById("protect-reject-msg");
  msg.textContent = data.message || "That player is already shielded - choose someone else.";
  msg.style.display = "block";
  renderProtectCandidates(data.candidates || []);
  showOverlay("protect-prompt-overlay");
}
socket.on("protect_target_rejected", (data) => {
  hideOverlay("protect-confirm-overlay");
  showProtectRejection(data);
  logAlert("Shield Target Taken", data.message || "That player is already shielded - choose someone else.", () => showProtectRejection(data));
});

function submitProtectTarget(targetName) {
  socket.emit("submit_protect_target", { protector: myName, target_name: targetName });
  hideOverlay("protect-prompt-overlay");
  document.getElementById("protect-confirm-text").textContent = `You chose to shield ${targetName}.`;
  showOverlay("protect-confirm-overlay");
}

function closeProtectConfirm() {
  hideOverlay("protect-confirm-overlay");
}

// ---- Parasite - absorb an Exposed player's abilities ----
function showAbsorptionPrompt(data) {
  const list = document.getElementById("absorption-candidate-list");
  const candidates = data.candidates || [];
  list.innerHTML = candidates.length
    ? candidates.map(name => `<div class="hostage-target" data-name="${name}">${name}</div>`).join("")
    : `<div class="empty">No one is currently Exposed.</div>`;
  list.querySelectorAll(".hostage-target").forEach(el => {
    el.addEventListener("click", () => submitAbsorptionTarget(el.dataset.name));
  });
  showOverlay("absorption-prompt-overlay");
}
socket.on("absorption_prompt", (data) => {
  showAbsorptionPrompt(data);
  logAlert("Absorption Prompt", "Choose an Exposed player to absorb", () => showAbsorptionPrompt(data));
});

function submitAbsorptionTarget(targetName) {
  socket.emit("submit_absorption_target", { parasite: myName, target_name: targetName });
  hideOverlay("absorption-prompt-overlay");
  document.getElementById("absorption-confirm-text").textContent = `You absorbed ${targetName}'s abilities.`;
  showOverlay("absorption-confirm-overlay");
}

function closeAbsorptionConfirm() {
  hideOverlay("absorption-confirm-overlay");
}

// ---- Dr. Alchemy - target a player, then choose Protector/Eliminator ----
function showAlchemyPrompt(data) {
  const list = document.getElementById("alchemy-candidate-list");
  const candidates = data.candidates || [];
  list.innerHTML = candidates.length
    ? candidates.map(name => `<div class="hostage-target" data-name="${name}">${name}</div>`).join("")
    : `<div class="empty">No one else is active right now.</div>`;
  list.querySelectorAll(".hostage-target").forEach(el => {
    el.addEventListener("click", () => {
      socket.emit("submit_alchemy_target", { alchemist: myName, target_name: el.dataset.name });
      hideOverlay("alchemy-prompt-overlay");
    });
  });
  showOverlay("alchemy-prompt-overlay");
}
socket.on("alchemy_prompt", (data) => {
  showAlchemyPrompt(data);
  logAlert("Alchemy Prompt", "Choose a player to transform", () => showAlchemyPrompt(data));
});

function showAlchemyChoicePrompt(data) {
  document.getElementById("alchemy-choice-target").textContent = data.target_name;
  showOverlay("alchemy-choice-overlay");
}
socket.on("alchemy_choice_prompt", (data) => {
  showAlchemyChoicePrompt(data);
  logAlert("Alchemy Choice", `Choose Protector or Eliminator for ${data.target_name}`, () => showAlchemyChoicePrompt(data));
});

function submitAlchemyChoice(choice) {
  socket.emit("submit_alchemy_choice", { alchemist: myName, choice });
  hideOverlay("alchemy-choice-overlay");
  const label = choice === "protector" ? "Protector" : "Eliminator";
  document.getElementById("alchemy-confirm-text").textContent = `They are now a ${label}.`;
  showOverlay("alchemy-confirm-overlay");
}

function closeAlchemyConfirm() {
  hideOverlay("alchemy-confirm-overlay");
}

// ---- Citizen's Arrest / Forget the Rules ----
function showArrestPrompt(data) {
  const list = document.getElementById("arrest-candidate-list");
  const candidates = data.candidates || [];
  list.innerHTML = candidates.length
    ? candidates.map(name => `<div class="hostage-target" data-name="${name}">${name}</div>`).join("")
    : `<div class="empty">No one else is active right now.</div>`;
  list.querySelectorAll(".hostage-target").forEach(el => {
    el.addEventListener("click", () => {
      socket.emit("submit_arrest_target", { arrester: myName, target_name: el.dataset.name });
      hideOverlay("arrest-prompt-overlay");
      document.getElementById("arrest-confirm-text").textContent = `You arrested ${el.dataset.name}.`;
      showOverlay("arrest-confirm-overlay");
    });
  });
  showOverlay("arrest-prompt-overlay");
}
socket.on("arrest_prompt", (data) => {
  showArrestPrompt(data);
  logAlert("Arrest Prompt", "Choose a player to arrest", () => showArrestPrompt(data));
});

function closeArrestConfirm() {
  hideOverlay("arrest-confirm-overlay");
}

// ---- A Good Doctor (Dr. Caitlin Snow, Leslie Thompkins, Dr. Harleen Quinzel) ----
function showGoodDoctorPrompt(data) {
  const list = document.getElementById("good-doctor-candidate-list");
  const candidates = data.candidates || [];
  list.innerHTML = candidates.length
    ? candidates.map(name => `<div class="hostage-target" data-name="${name}">${name}</div>`).join("")
    : `<div class="empty">No one is currently Eliminated.</div>`;
  list.querySelectorAll(".hostage-target").forEach(el => {
    el.addEventListener("click", () => {
      socket.emit("submit_good_doctor_target", { doctor: myName, target_name: el.dataset.name });
      hideOverlay("good-doctor-prompt-overlay");
      document.getElementById("good-doctor-confirm-text").textContent =
        `You asked Watchtower to restore ${el.dataset.name}.`;
      showOverlay("good-doctor-confirm-overlay");
    });
  });
  showOverlay("good-doctor-prompt-overlay");
}
socket.on("good_doctor_prompt", (data) => {
  showGoodDoctorPrompt(data);
  logAlert("A Good Doctor Prompt", "Choose an Eliminated player to restore", () => showGoodDoctorPrompt(data));
});

function closeGoodDoctorConfirm() {
  hideOverlay("good-doctor-confirm-overlay");
}

// ---- Beast Boy's Giraffe! - peek at one player's identity ----
function showGiraffePrompt(data) {
  const list = document.getElementById("giraffe-candidate-list");
  const candidates = data.candidates || [];
  list.innerHTML = candidates.length
    ? candidates.map(name => `<div class="hostage-target" data-name="${name}">${name}</div>`).join("")
    : `<div class="empty">No one else is active right now.</div>`;
  list.querySelectorAll(".hostage-target").forEach(el => {
    el.addEventListener("click", () => {
      socket.emit("submit_giraffe_target", { beast_boy: myName, target_name: el.dataset.name });
      hideOverlay("giraffe-prompt-overlay");
    });
  });
  showOverlay("giraffe-prompt-overlay");
}
socket.on("giraffe_prompt", (data) => {
  showGiraffePrompt(data);
  logAlert("Giraffe! Prompt", "Choose a player to peek at", () => showGiraffePrompt(data));
});

function showGiraffeReveal(data) {
  document.getElementById("giraffe-reveal-text").textContent = `${data.player} is ${data.character}`;
  showOverlay("giraffe-reveal-overlay");
}
socket.on("giraffe_reveal", (data) => {
  showGiraffeReveal(data);
  logAlert("Giraffe! Reveal", `${data.player} is ${data.character}`, () => showGiraffeReveal(data));
});

function closeGiraffeReveal() {
  hideOverlay("giraffe-reveal-overlay");
}

// ---- Telepathic Link / Telepathic Team (Martian Manhunter, Miss Martian) ----
// Two-step flow on the inspector's side: pick a candidate, then confirm
// before it's actually sent (per design, the target's phone vibrates the
// moment this is confirmed, so we don't want stray taps to trigger it).
let pendingTelepathicPromptData = null;
let pendingTelepathicTarget = null;

function showTelepathicLinkPrompt(data) {
  pendingTelepathicPromptData = data;
  const list = document.getElementById("telepathic-link-candidate-list");
  const candidates = data.candidates || [];
  list.innerHTML = candidates.length
    ? candidates.map(name => `<div class="hostage-target" data-name="${name}">${name}</div>`).join("")
    : `<div class="empty">No one new is available to link with right now.</div>`;
  list.querySelectorAll(".hostage-target").forEach(el => {
    el.addEventListener("click", () => {
      pendingTelepathicTarget = el.dataset.name;
      hideOverlay("telepathic-link-prompt-overlay");
      document.getElementById("telepathic-link-confirm-text").textContent =
        `Set up a Telepathic Link with ${pendingTelepathicTarget}?`;
      showOverlay("telepathic-link-confirm-overlay");
    });
  });
  showOverlay("telepathic-link-prompt-overlay");
}
socket.on("telepathic_link_prompt", (data) => {
  showTelepathicLinkPrompt(data);
  logAlert("Telepathic Link Prompt", "Choose a player to link with", () => showTelepathicLinkPrompt(data));
});

function confirmTelepathicLinkTarget() {
  if (!pendingTelepathicTarget) return;
  socket.emit("submit_telepathic_link_target", { inspector: myName, target_name: pendingTelepathicTarget });
  hideOverlay("telepathic-link-confirm-overlay");
  pendingTelepathicTarget = null;
}

function cancelTelepathicLinkTarget() {
  hideOverlay("telepathic-link-confirm-overlay");
  pendingTelepathicTarget = null;
  if (pendingTelepathicPromptData) showTelepathicLinkPrompt(pendingTelepathicPromptData);
}

// ---- Alert chime - synthesized with Web Audio, no sound file needed. ----
// iOS Safari never implemented navigator.vibrate(), so on an iPhone the
// vibrate calls below are silent no-ops - this chime is what actually gets
// a player's attention there. Web Audio on iOS requires the AudioContext to
// be created/resumed from a real user gesture at least once per page load,
// so we lazily "unlock" it on the player's very first tap/touch (they'll
// have tapped plenty of buttons - Join, Accept, etc. - well before any
// Telepathic Link/Team alert can possibly fire), then just reuse it.
let audioCtx = null;
function unlockAudio() {
  if (audioCtx) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  } catch (e) { /* ignore - no Web Audio support */ }
}
document.addEventListener("click", unlockAudio, { once: true });
document.addEventListener("touchstart", unlockAudio, { once: true });

function playAlertChime() {
  try {
    if (!audioCtx) unlockAudio();
    if (!audioCtx) return;
    if (audioCtx.state === "suspended") audioCtx.resume();
    const now = audioCtx.currentTime;
    // Two-note "ping-ping" chime.
    [[880, 0], [1175, 0.15]].forEach(([freq, offset]) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now + offset);
      gain.gain.linearRampToValueAtTime(0.35, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.35);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(now + offset);
      osc.stop(now + offset + 0.4);
    });
  } catch (e) { /* ignore */ }
}

// ---- Telepathic Link alert (target's side) ----
// Vibrate + chime, show "TELEPATHICALLY LINKED!" with an ACCEPT button, and
// either way (tapped or 5s timeout) move on to reveal the player's own
// Signal. navigator.vibrate() is a no-op (not an error) on browsers that
// don't implement it - notably iOS Safari - which is why the visual alert
// and chime are always the primary cues and vibration is just a bonus.
let telepathicLinkAutoTimer = null;

function showTelepathicLinkAlert(data) {
  try { if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]); } catch (e) { /* ignore */ }
  playAlertChime();
  document.getElementById("telepathic-link-alert-overlay").dataset.signal = data.signal || "";
  showOverlay("telepathic-link-alert-overlay");
  clearTimeout(telepathicLinkAutoTimer);
  telepathicLinkAutoTimer = setTimeout(acceptTelepathicLinkAlert, 5000);
}
socket.on("telepathic_link_alert", (data) => {
  showTelepathicLinkAlert(data);
  logAlert("Telepathically Linked!", "Tap to see your Signal", () => showTelepathicLinkAlert(data));
});

function acceptTelepathicLinkAlert() {
  clearTimeout(telepathicLinkAutoTimer);
  try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) { /* ignore */ }
  const signal = document.getElementById("telepathic-link-alert-overlay").dataset.signal || "";
  hideOverlay("telepathic-link-alert-overlay");
  document.getElementById("telepathic-link-signal-text").textContent = signal;
  showOverlay("telepathic-link-signal-overlay");
}

function closeTelepathicLinkSignal() {
  hideOverlay("telepathic-link-signal-overlay");
}

// ---- Telepathic Team - same vibrate/accept gate, then the existing
// cross-reveal list (unchanged content, just staged behind the alert) ----
let telepathicTeamAutoTimer = null;
let pendingTelepathicTeamData = null;

function showTelepathicTeamAlert(data) {
  pendingTelepathicTeamData = data;
  try { if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]); } catch (e) { /* ignore */ }
  playAlertChime();
  showOverlay("telepathic-team-alert-overlay");
  clearTimeout(telepathicTeamAutoTimer);
  telepathicTeamAutoTimer = setTimeout(acceptTelepathicTeamAlert, 5000);
}
socket.on("telepathic_team_reveal", (data) => {
  showTelepathicTeamAlert(data);
  logAlert("Telepathic Team Reveal", `${(data.entries || []).length} linked player(s) revealed`, () => showTelepathicTeamAlert(data));
});

function acceptTelepathicTeamAlert() {
  clearTimeout(telepathicTeamAutoTimer);
  try { if (navigator.vibrate) navigator.vibrate(0); } catch (e) { /* ignore */ }
  hideOverlay("telepathic-team-alert-overlay");
  if (pendingTelepathicTeamData) showTelepathicTeamReveal(pendingTelepathicTeamData);
}

function showTelepathicTeamReveal(data) {
  const list = document.getElementById("telepathic-team-list");
  const entries = data.entries || [];
  list.innerHTML = entries.length
    ? entries.map(e => `<div class="hostage-target" style="cursor:default">${e.player} is ${e.character}</div>`).join("")
    : `<div class="empty">No one else is currently linked.</div>`;
  showOverlay("telepathic-team-reveal-overlay");
}

function closeTelepathicTeamReveal() {
  hideOverlay("telepathic-team-reveal-overlay");
}

// ---- Links tab (Martian Manhunter / Miss Martian only) - persistent list
// of everyone this player has Telepathically Linked with this game ----
function renderLinksTab(data) {
  const body = document.getElementById("links-body");
  if (!body) return;
  if (!data.assigned || data.telepathic_links === null || data.telepathic_links === undefined) {
    body.innerHTML = `<div class="empty">No Telepathic Link data available.</div>`;
    return;
  }
  const links = data.telepathic_links || [];
  body.innerHTML = links.length
    ? links.map(name => `<div class="hostage-target" style="cursor:default">${name}</div>`).join("")
    : `<div class="empty">You haven't Telepathically Linked with anyone yet.</div>`;
}

function openLinks() {
  socket.emit("get_my_card", { name: myName });
  showOverlay("links-overlay");
}
function closeLinks() {
  hideOverlay("links-overlay");
}

// ---- The Flash's Fastest Man Alive - seat swap ----
function showSpeedsterSwapPrompt(data) {
  const list = document.getElementById("speedster-swap-candidate-list");
  const candidates = data.candidates || [];
  list.innerHTML = candidates.length
    ? candidates.map(name => `<div class="hostage-target" data-name="${name}">${name}</div>`).join("")
    : `<div class="empty">No one else is active right now.</div>`;
  list.querySelectorAll(".hostage-target").forEach(el => {
    el.addEventListener("click", () => {
      socket.emit("submit_speedster_swap_target", { flash: myName, target_name: el.dataset.name });
      hideOverlay("speedster-swap-prompt-overlay");
    });
  });
  showOverlay("speedster-swap-prompt-overlay");
}
socket.on("speedster_swap_prompt", (data) => {
  showSpeedsterSwapPrompt(data);
  logAlert("Speedster Swap Prompt", "Choose a player to swap seats with", () => showSpeedsterSwapPrompt(data));
});

// Public - every player sees this, by design. It's a visible tell.
function showSeatSwapAnnouncement(data) {
  document.getElementById("seat-swap-announcement-text").textContent =
    `${data.player_a} swapped seats with ${data.player_b}!`;
  showOverlay("seat-swap-announcement-overlay");
}
socket.on("seat_swap_announcement", (data) => {
  showSeatSwapAnnouncement(data);
  logAlert("Seat Swap", `${data.player_a} swapped seats with ${data.player_b}!`, () => showSeatSwapAnnouncement(data));
});

function closeSeatSwapAnnouncement() {
  hideOverlay("seat-swap-announcement-overlay");
}

// ---- Plastic Man's Group Hug - silent left/right shield ----
function showPlasticManPrompt() {
  showOverlay("plastic-man-prompt-overlay");
}
socket.on("plastic_man_prompt", () => {
  showPlasticManPrompt();
  logAlert("Group Hug Prompt", "Choose left or right to shield", () => showPlasticManPrompt());
});

function submitPlasticManChoice(direction) {
  socket.emit("submit_plastic_man_choice", { plastic_man: myName, direction });
  hideOverlay("plastic-man-prompt-overlay");
}

// ---- Reverse Flash's Not So Fast - seat swap with a Teleport target ----
function showReverseFlashPrompt(data) {
  const list = document.getElementById("reverse-flash-candidate-list");
  const candidates = data.candidates || [];
  list.innerHTML = candidates.length
    ? candidates.map(name => `<div class="hostage-target" data-name="${name}">${name}</div>`).join("")
    : `<div class="empty">No one is currently Targeted for Teleportation.</div>`;
  list.querySelectorAll(".hostage-target").forEach(el => {
    el.addEventListener("click", () => {
      socket.emit("submit_reverse_flash_target", { reverse_flash: myName, target_name: el.dataset.name });
      hideOverlay("reverse-flash-prompt-overlay");
    });
  });
  showOverlay("reverse-flash-prompt-overlay");
}
socket.on("reverse_flash_prompt", (data) => {
  showReverseFlashPrompt(data);
  logAlert("Not So Fast Prompt", "Choose a Targeted player to swap with", () => showReverseFlashPrompt(data));
});

// ---- Thunder's Stomp - pick a side ----
function showThunderPrompt() {
  showOverlay("thunder-prompt-overlay");
}
socket.on("thunder_prompt", () => {
  showThunderPrompt();
  logAlert("Stomp! Prompt", "Choose a side", () => showThunderPrompt());
});

function submitThunderChoice(direction) {
  socket.emit("submit_thunder_choice", { thunder: myName, direction });
  hideOverlay("thunder-prompt-overlay");
}

// ---- Hawkman's Timeless Love / Joker's Mad Love - guess who it is.
// Results (correct or not) arrive via the existing condition_alert and
// shuffle_reveal handlers already wired up elsewhere - nothing more
// needed here beyond showing the candidate list. ----
function showWakePrompt(data) {
  const list = document.getElementById("wake-candidate-list");
  const candidates = data.candidates || [];
  list.innerHTML = candidates.length
    ? candidates.map(name => `<div class="hostage-target" data-name="${name}">${name}</div>`).join("")
    : `<div class="empty">No one else is active right now.</div>`;
  list.querySelectorAll(".hostage-target").forEach(el => {
    el.addEventListener("click", () => {
      socket.emit("submit_wake_target", { waker: myName, target_name: el.dataset.name });
      hideOverlay("wake-prompt-overlay");
    });
  });
  showOverlay("wake-prompt-overlay");
}
socket.on("wake_prompt", (data) => {
  showWakePrompt(data);
  logAlert("Wake Prompt", "Guess who it is", () => showWakePrompt(data));
});

// ---- Secret Identity roster view (Plastic Man's Petty Thief, Zatanna's
// Thgiels fo Dnah) - view-only, auto-dismisses after 10 seconds ----
let secretRosterTimer = null;
function showSecretRosterView(data) {
  const list = document.getElementById("secret-roster-list");
  const entries = data.entries || [];
  list.innerHTML = entries.length
    ? entries.map(e => `<div class="hostage-target" style="cursor:default">${e.player} is ${e.character}</div>`).join("")
    : `<div class="empty">No one is currently assigned.</div>`;
  showOverlay("secret-roster-overlay");

  let remaining = 10;
  const countdownEl = document.getElementById("secret-roster-countdown");
  const barEl = document.getElementById("secret-roster-bar");
  countdownEl.textContent = remaining;
  barEl.style.transition = "none";
  barEl.style.width = "100%";
  // Force reflow so the next width change animates smoothly from 100%.
  void barEl.offsetWidth;
  barEl.style.transition = "width 1s linear";
  if (secretRosterTimer) clearInterval(secretRosterTimer);
  secretRosterTimer = setInterval(() => {
    remaining -= 1;
    countdownEl.textContent = Math.max(remaining, 0);
    barEl.style.width = `${Math.max(remaining, 0) * 10}%`;
    if (remaining <= 0) {
      clearInterval(secretRosterTimer);
      secretRosterTimer = null;
      hideOverlay("secret-roster-overlay");
    }
  }, 1000);
}
socket.on("secret_roster_view", (data) => {
  showSecretRosterView(data);
  logAlert("Secret Roster View", `${(data.entries || []).length} player(s) shown`, () => showSecretRosterView(data));
});

// ---- Vibe the Multiverse - view-only Zone Grid, auto-dismisses after
// 10 seconds, same pattern as the Secret Identity roster view ----
let vibeMapTimer = null;
function showMapView(data) {
  const gridEl = document.getElementById("vibe-map-grid");
  const grid = data.grid || [];
  const columns = data.columns || [];
  const blackout = data.blackout || {};

  const table = document.createElement("div");
  table.className = "map-table";

  const headRow = document.createElement("div");
  headRow.className = "map-row";
  const corner = document.createElement("div");
  corner.className = "map-corner";
  headRow.appendChild(corner);
  columns.forEach(([letter, hex]) => {
    const el = document.createElement("div");
    el.className = "map-colhead";
    el.textContent = letter;
    el.style.background = hex;
    headRow.appendChild(el);
  });
  table.appendChild(headRow);

  grid.forEach((row, rIdx) => {
    const rowEl = document.createElement("div");
    rowEl.className = "map-row";
    const rowHead = document.createElement("div");
    rowHead.className = "map-rowhead";
    rowHead.textContent = String(rIdx);
    rowEl.appendChild(rowHead);
    row.forEach(locName => {
      const cell = document.createElement("div");
      cell.className = "map-cell";
      if (blackout[locName]) cell.classList.add("blackout");
      cell.textContent = locName;
      rowEl.appendChild(cell);
    });
    table.appendChild(rowEl);
  });

  gridEl.innerHTML = "";
  gridEl.appendChild(table);
  showOverlay("vibe-map-overlay");

  let remaining = 10;
  const countdownEl = document.getElementById("vibe-map-countdown");
  const barEl = document.getElementById("vibe-map-bar");
  countdownEl.textContent = remaining;
  barEl.style.transition = "none";
  barEl.style.width = "100%";
  void barEl.offsetWidth;
  barEl.style.transition = "width 1s linear";
  if (vibeMapTimer) clearInterval(vibeMapTimer);
  vibeMapTimer = setInterval(() => {
    remaining -= 1;
    countdownEl.textContent = Math.max(remaining, 0);
    barEl.style.width = `${Math.max(remaining, 0) * 10}%`;
    if (remaining <= 0) {
      clearInterval(vibeMapTimer);
      vibeMapTimer = null;
      hideOverlay("vibe-map-overlay");
    }
  }, 1000);
}
socket.on("map_view", (data) => {
  showMapView(data);
  logAlert("Vibe the Multiverse — Map View", "Zone grid shown", () => showMapView(data));
});

// ---- Round-change requests (Mind Merge, Blackout, Altering the
// Timeline, Loyal Assistant, Construct, Turn the Earth) ----
function renderRoundChangeButton(rc) {
  if (rc.pending) {
    return `<button class="btn-ghost round-change-btn" disabled style="margin-top:8px;width:auto">Waiting for Watchtower&hellip;</button>`;
  }
  const disabledAttr = rc.enabled ? "" : "disabled";
  return `<button class="btn-primary round-change-btn" style="margin-top:8px;width:auto" ${disabledAttr}
            onclick="requestRoundChange('${rc.label}')">
            Request: ${rc.target_phase}!
          </button>`;
}

function requestRoundChange(label) {
  if (!currentCardId) return;
  socket.emit("request_round_change", { id: currentCardId, player: myName });
  // Refresh the card shortly after so the button flips to "Waiting..."
  setTimeout(() => socket.emit("get_my_card", { name: myName }), 200);
}

// ---- secret identity reveal (Know You Anywhere) ----
function showSecretIdentityReveal(data) {
  const reveals = data.reveals || [];
  document.getElementById("secret-identity-text").innerHTML = reveals
    .map(r => `<div>${r.target_player} is ${r.target_name}</div>`)
    .join("");
  showOverlay("secret-identity-overlay");
}
socket.on("secret_identity_reveal", (data) => {
  showSecretIdentityReveal(data);
  logAlert("Secret Identity Reveal", `${(data.reveals || []).length} identity(ies) revealed`, () => showSecretIdentityReveal(data));
});

function closeSecretIdentity() {
  hideOverlay("secret-identity-overlay");
}

// ---- my card ----
const TEAM_ICONS = {
  civilian: { letter: "C", bg: "#f3aecb", fg: "#3a1a28" },
  villain: { letter: "V", bg: "#2fbf6e", fg: "#0a2214" },
  hero: { letter: "H", bg: "#3b7fe0", fg: "#ffffff" },
  martian: { letter: "M", bg: "#9aa1ab", fg: "#1a1c1f" },
};

function letterBadgeSvg(letter, bg, fg, title) {
  return `<svg viewBox="0 0 44 44" class="team-badge" title="${title}">
    <circle cx="22" cy="22" r="21" fill="${bg}" stroke="#05070a" stroke-width="2"/>
    <text x="22" y="30" text-anchor="middle" font-family="Rajdhani, sans-serif"
          font-weight="800" font-size="22" fill="${fg}">${letter}</text>
  </svg>`;
}

function kryptonianBadgeSvg() {
  return `<svg viewBox="0 0 44 44" class="team-badge" title="Kryptonian">
    <circle cx="22" cy="22" r="21" fill="#7dd3fc" stroke="#05070a" stroke-width="2"/>
    <text x="22" y="30" text-anchor="middle" font-family="Rajdhani, sans-serif"
          font-weight="800" font-size="22" fill="#062a3d">K</text>
  </svg>`;
}

function furyBadgeSvg() {
  return `<svg viewBox="0 0 44 44" class="team-badge" title="Fury">
    <circle cx="22" cy="22" r="21" fill="#e5484d" stroke="#05070a" stroke-width="2"/>
    <path d="M11 15 L18 18" stroke="#3a0508" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M33 15 L26 18" stroke="#3a0508" stroke-width="2.5" stroke-linecap="round"/>
    <circle cx="16" cy="22" r="2.4" fill="#3a0508"/>
    <circle cx="28" cy="22" r="2.4" fill="#3a0508"/>
    <path d="M14 33 Q22 26 30 33" stroke="#3a0508" stroke-width="2.5" fill="none" stroke-linecap="round"/>
  </svg>`;
}

function starroBadgeSvg() {
  const cx = 22, cy = 22, rOuter = 20, rInner = 8;
  const points = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return `<svg viewBox="0 0 44 44" class="team-badge" title="Starro">
    <polygon points="${points.join(" ")}" fill="#c084fc" stroke="#05070a" stroke-width="2" stroke-linejoin="round"/>
  </svg>`;
}

function speedsterBadgeSvg() {
  return `<svg viewBox="0 0 44 44" class="team-badge" title="Speedster">
    <circle cx="22" cy="22" r="21" fill="#f5d76e" stroke="#05070a" stroke-width="2"/>
    <polygon points="24,8 12,25 20,25 18,36 32,18 23,18" fill="#3a2f05" stroke="#3a2f05" stroke-width="1" stroke-linejoin="round"/>
  </svg>`;
}

function renderCardBadges(data) {
  const el = document.getElementById("mycard-badges");
  const badges = [];
  const teamIcon = TEAM_ICONS[data.team];
  if (teamIcon) {
    badges.push(letterBadgeSvg(teamIcon.letter, teamIcon.bg, teamIcon.fg, data.team));
  }
  if (data.is_kryptonian) badges.push(kryptonianBadgeSvg());
  if (data.is_speedster) badges.push(speedsterBadgeSvg());
  if (data.fury) badges.push(furyBadgeSvg());
  if (data.starro) badges.push(starroBadgeSvg());
  el.innerHTML = badges.join("");
}

let currentCardId = null;

socket.on("my_card_result", (data) => {
  renderLinksTab(data);
  const body = document.getElementById("mycard-body");
  document.getElementById("mycard-name").textContent = data.assigned ? data.character : "No character yet";
  renderCardBadges(data.assigned ? data : {});
  currentCardId = data.assigned ? data.id : null;
  if (!data.assigned) {
    body.innerHTML = `<div class="empty">You haven't been assigned a character yet — ask your host to shuffle.</div>`;
    return;
  }
  const card = data.card || {};
  const rc = data.round_change;
  const abilityRows = (card.abilities || []).map(a => {
    const parsed = parseAbilityText(a);
    if (parsed) {
      const isRoundChangeAbility = rc && parsed.title === rc.label;
      const buttonHtml = isRoundChangeAbility ? renderRoundChangeButton(rc) : "";
      return `<div class="ability-row">
                <div class="ability-kind">${parsed.kind}</div>
                <div class="ability-title">${parsed.title}</div>
                <div class="ability-desc">${parsed.desc}</div>
                ${buttonHtml}
              </div>`;
    }
    return `<div class="ability-row"><div class="ability-desc">${a}</div></div>`;
  }).join("");
  const trackerHtml = data.lobo_tracker ? `
    <div class="card-meta" style="margin-top:14px">The Main Man — Exposed Tracker (${data.lobo_tracker.civilian + data.lobo_tracker.hero + data.lobo_tracker.martian} / 3)</div>
    <div class="lobo-tracker-row"><span class="lobo-tracker-label">Civilians</span><span class="lobo-tracker-count">${data.lobo_tracker.civilian}</span></div>
    <div class="lobo-tracker-row"><span class="lobo-tracker-label">Heroes</span><span class="lobo-tracker-count">${data.lobo_tracker.hero}</span></div>
    <div class="lobo-tracker-row"><span class="lobo-tracker-label">Martians</span><span class="lobo-tracker-count">${data.lobo_tracker.martian}</span></div>
  ` : "";
  const speedsterHtml = data.speedster_count !== null && data.speedster_count !== undefined ? `
    <div class="card-meta" style="margin-top:14px">Speed Thief — Active Speedsters in Play</div>
    <div class="lobo-tracker-row"><span class="lobo-tracker-label">Speedsters (not counting you)</span><span class="lobo-tracker-count">${data.speedster_count}</span></div>
  ` : "";
  const kryptonianHtml = data.kryptonian_count !== null && data.kryptonian_count !== undefined ? `
    <div class="card-meta" style="margin-top:14px">For Krypton — Active Kryptonians in Play</div>
    <div class="lobo-tracker-row"><span class="lobo-tracker-label">Kryptonians (not counting you)</span><span class="lobo-tracker-count">${data.kryptonian_count}</span></div>
  ` : "";
  body.innerHTML = `
    ${card.role ? `<div class="card-meta">${card.role}</div>` : ""}
    ${card.signal ? `<div class="card-meta">${card.signal}</div>` : ""}
    <div class="ability-list">${abilityRows || '<div class="empty">No abilities on file.</div>'}</div>
    ${card.strategy ? `<div class="card-strategy">${card.strategy}</div>` : ""}
    ${trackerHtml}
    ${speedsterHtml}
    ${kryptonianHtml}
  `;
});

function openMyCard() {
  socket.emit("get_my_card", { name: myName });
  showOverlay("mycard-overlay");
}
function closeMyCard() {
  hideOverlay("mycard-overlay");
}

// ---- rules & phases ----
function openRules() {
  const body = document.getElementById("rules-body");
  body.innerHTML = PHASES.map(p => `
    <div class="ability-row">
      <div class="ability-title">${p}!</div>
      <div class="ability-desc">${PHASE_INFO[p] || ""}</div>
    </div>
  `).join("");
  showOverlay("rules-overlay");
}
function closeRules() {
  hideOverlay("rules-overlay");
}

// ---- goals (object of the game) ----
function openGoals() {
  const body = document.getElementById("goals-body");
  body.innerHTML = `
    <div class="ability-row">
      <div class="ability-desc">
        Object of the Game: White Martians, Heroes, Civilians, and Villains all
        want to keep their identities secret until it's convenient to reveal
        them. No one wants to be Exposed!
      </div>
      <ul class="goals-list">
        <li>White Martians want to either reach the Watchtower as a team, or eliminate all the Heroes.</li>
        <li>Heroes want to Rescue! every civilian by getting them into Watchtower.</li>
        <li>Villains want to Expose! Heroes.</li>
        <li>Civilians want to buy Heroes enough time for them to be Rescued!</li>
      </ul>
    </div>
  `;
  showOverlay("goals-overlay");
}
function closeGoals() {
  hideOverlay("goals-overlay");
}

// ---- phase reminder toast ----
function showPhaseReminder(data) {
  const toast = document.getElementById("phase-reminder-toast");
  if (!data.abilities || !data.abilities.length) {
    toast.style.display = "none";
    return;
  }
  document.getElementById("phase-toast-title").textContent = `${data.phase}! — ${data.character}`;
  document.getElementById("phase-toast-body").innerHTML = data.abilities.map(a => {
    const parsed = parseAbilityText(a);
    return parsed ? `<div><b>${parsed.title}</b> — ${parsed.desc}</div>` : `<div>${a}</div>`;
  }).join("");
  toast.style.display = "block";
}
socket.on("phase_reminder", (data) => {
  showPhaseReminder(data);
  if (data.abilities && data.abilities.length) {
    logAlert(`${data.phase}! Reminder`, data.character, () => showPhaseReminder(data));
  }
});
function dismissReminder() {
  document.getElementById("phase-reminder-toast").style.display = "none";
}

socket.on("phase_guide", (data) => {
  const toast = document.getElementById("phase-guide-toast");
  if (!data.text) {
    toast.style.display = "none";
    return;
  }
  document.getElementById("phase-guide-title").textContent = `${data.phase}! — How to Play`;
  document.getElementById("phase-guide-body").textContent = data.text;
  toast.style.display = "block";
});
function dismissGuide() {
  document.getElementById("phase-guide-toast").style.display = "none";
}

const VOTE_PHASES = ["Vote", "Eliminate"];
let myVoteLocked = false;
let pendingVote = null;
let myCanVote = false;

socket.on("my_vote_result", (data) => {
  myVote = data.choice || null;
  myVoteLocked = !!data.voted;
  myCanVote = !!data.can_vote;
  pendingVote = null;
  if (latestState) renderVoteList(latestState);
});

socket.on("timer_update", (timer) => {
  renderPlayerTimer(timer);
});

function renderPlayerTimer(timer) {
  const el = document.getElementById("player-timer");
  if (!timer || !timer.label) {
    el.style.display = "none";
    return;
  }
  const remaining = Math.max(0, timer.remaining);
  const m = Math.floor(remaining / 60);
  const s = remaining % 60;
  document.getElementById("player-timer-label").textContent = timer.label;
  document.getElementById("player-timer-display").textContent =
    `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  el.classList.toggle("time-up", remaining <= 0);
  el.classList.toggle("paused", !timer.running);
  el.style.display = "flex";
}

socket.on("state", (state) => {
  latestState = state;

  const round = document.getElementById("round-label");
  const phaseLabel = document.getElementById("phase-label");
  round.textContent = `ROUND ${state.round} / ${state.num_rounds}`;
  phaseLabel.textContent = state.phase_index !== null ? PHASES[state.phase_index] + "!" : "Standing by…";

  renderPlayerTimer(state.timer);

  const votePanel = document.getElementById("vote-panel");
  const inVotePhase = state.phase_index !== null && VOTE_PHASES.includes(PHASES[state.phase_index]) && myCanVote;
  votePanel.style.display = inVotePhase ? "block" : "none";

  if (inVotePhase) {
    document.getElementById("vote-panel-heading").textContent =
      PHASES[state.phase_index] === "Eliminate" ? "Choose who to eliminate" : "Cast your vote";
    renderVoteList(state);
  }

  renderActiveList(state);
  renderPlayerSeatingDiagram(state);
});

function renderPlayerSeatingDiagram(state) {
  const panel = document.getElementById("seating-panel");
  const el = document.getElementById("player-seating-diagram");
  const seats = state.seats || [];
  if (!seats.length) {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "block";
  const size = 240, cx = size / 2, cy = size / 2, radius = 85, seatR = 20;
  const n = seats.length;
  const myLower = (myName || "").trim().toLowerCase();
  const seatEls = seats.map((name, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    const isMe = name.trim().toLowerCase() === myLower;
    const fill = isMe ? "#f5b942" : "#1b2330";
    const textColor = isMe ? "#1a1305" : "#e8edf2";
    return `
      <circle cx="${x}" cy="${y}" r="${seatR}" fill="${fill}" stroke="#f5b942" stroke-width="2"/>
      <text x="${x}" y="${y + 5}" text-anchor="middle" font-family="Rajdhani, sans-serif"
            font-weight="700" font-size="13" fill="${textColor}">${(name || "").trim().slice(0, 2).toUpperCase()}</text>
    `;
  }).join("");
  el.innerHTML = `
    <svg viewBox="0 0 ${size} ${size + 36}" style="width:100%; max-width:240px; display:block; margin:0 auto;">
      <circle cx="${cx}" cy="${cy}" r="${radius + seatR + 6}" fill="none" stroke="#2a3341" stroke-width="1" stroke-dasharray="3,4"/>
      ${seatEls}
      <circle cx="${cx}" cy="${cy - radius - seatR - 20}" r="14" fill="#3b7fe0" stroke="#05070a" stroke-width="2"/>
      <text x="${cx}" y="${cy - radius - seatR - 16}" text-anchor="middle" font-family="Rajdhani, sans-serif"
            font-weight="800" font-size="9" fill="#fff">WT</text>
    </svg>
    <div style="text-align:center; color:var(--muted); font-size:11px">Your seat is highlighted</div>
  `;
}

function renderVoteList(state) {
  const list = document.getElementById("vote-list");
  const candidates = state.vote_candidates || [];
  const confirmEl = document.getElementById("vote-confirm");

  if (!candidates.length) {
    list.innerHTML = `<div class="empty">No one is on the board yet.</div>`;
    confirmEl.innerHTML = "";
    return;
  }

  if (myVoteLocked) {
    list.innerHTML = candidates.map(name => `
      <div class="vote-option locked-option ${myVote === name ? 'picked' : ''}">
        <span>${name}</span>
        ${myVote === name ? '<b>✓</b>' : ''}
      </div>
    `).join("");
    confirmEl.innerHTML = `<div class="confirm-banner">Vote locked in for ${myVote}</div>`;
    return;
  }

  list.innerHTML = candidates.map((name, i) => `
    <div class="vote-option ${pendingVote === name ? 'picked' : ''}" data-idx="${i}">
      <span>${name}</span>
    </div>
  `).join("");
  list.querySelectorAll(".vote-option").forEach((el, i) => {
    el.addEventListener("click", () => selectVoteCandidate(candidates[i]));
  });

  confirmEl.innerHTML = pendingVote
    ? `<div class="vote-confirm-prompt">
         <div>Vote for <b>${pendingVote}</b>?</div>
         <div class="vote-confirm-buttons">
           <button class="btn-primary" onclick="submitVote()">Confirm Vote</button>
           <button class="btn-ghost" onclick="cancelPendingVote()">Cancel</button>
         </div>
       </div>`
    : "";
}

function selectVoteCandidate(name) {
  if (myVoteLocked) return;
  pendingVote = name;
  renderVoteList(latestState);
}

function cancelPendingVote() {
  pendingVote = null;
  renderVoteList(latestState);
}

function submitVote() {
  if (!myName || !pendingVote || myVoteLocked) return;
  socket.emit("cast_vote", { voter: myName, target_name: pendingVote });
}

function renderActiveList(state) {
  const el = document.getElementById("active-list");
  const active = CHARACTERS.filter(c => state.characters[c.id] && state.characters[c.id].active);
  if (!active.length) {
    el.innerHTML = `<div class="empty">Nobody's active yet — hang tight.</div>`;
    return;
  }
  el.innerHTML = active.map(c => {
    const displayName = state.characters[c.id].display_name || c.name;
    return `<div class="feed-item"><span class="team-dot" style="background:${TEAM_COLORS[c.team]};display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px"></span>${displayName}</div>`;
  }).join("");
}
