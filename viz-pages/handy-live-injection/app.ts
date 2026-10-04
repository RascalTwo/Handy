import { stepper, $ } from "/_kit/viz.js";

/* ───────────────────────── the card figure ─────────────────────────
     y = the spoken word. x = time. A bar starts at the moment that word is
     in your document and runs to the right edge, so "present from here on"
     is a length you can point at. Live draws a staircase; stock is a wall. */

const T_MAX = 4.4,
  T_REL = 3.6,
  T_FINAL = 3.8;
const WORDS: [string, number][] = [
  ["set", 0.8],
  ["the", 1.2],
  ["retry", 2.1],
  ["budget", 2.7],
  ["to", 2.7],
  ["three", 3.1],
  ["attempts", T_FINAL], // held back to the final paste — never crossed a boundary
];

const GUT = 76,
  PX0 = 84,
  PX1 = 452,
  ROW0 = 36,
  ROWH = 33;
const xt = (t: number) => PX0 + (t / T_MAX) * (PX1 - PX0);
const ry = (i: number) => ROW0 + i * ROWH;
const PLOT_BOT = ry(WORDS.length) - 6;

// axis: ticks along the top, one per second
const parts: string[] = [
  `<line x1="${PX0}" y1="24" x2="${PX1}" y2="24" stroke="var(--border)" stroke-width="1"/>`,
];
for (let s = 0; s <= 4; s++) {
  const x = xt(s);
  parts.push(
    `<line x1="${x}" y1="24" x2="${x}" y2="${PLOT_BOT}" stroke="var(--border)" stroke-width="1" opacity="0.35"/>`,
    `<text x="${x}" y="16" fill="var(--faint)" font-family="var(--mono)" font-size="10" text-anchor="middle">${s === 0 ? "0s" : s}</text>`,
  );
}

// the two vertical events. The wash is the point of the whole chart: everything
// right of it arrived in a single paste, which is all stock Handy ever does.
parts.push(
  `<rect x="${xt(T_FINAL)}" y="26" width="${PX1 - xt(T_FINAL)}" height="${PLOT_BOT - 26}" fill="var(--stock)" opacity="0.12"/>`,
  `<line x1="${xt(T_REL)}" y1="24" x2="${xt(T_REL)}" y2="${PLOT_BOT}" stroke="var(--warn)" stroke-width="1.5" stroke-dasharray="4 3"/>`,
  `<line x1="${xt(T_FINAL)}" y1="24" x2="${xt(T_FINAL)}" y2="${PLOT_BOT}" stroke="var(--stock)" stroke-width="1" opacity="0.6"/>`,
);

// one row per spoken word
WORDS.forEach(([word, t], i) => {
  const y = ry(i);
  parts.push(
    `<text x="${GUT}" y="${y + 13}" fill="var(--muted)" font-family="var(--mono)" font-size="12.5" text-anchor="end">${word}</text>`,
    `<rect data-viz-id="live-${word}" data-label="live paste: &quot;${word}&quot; is in your document from ${t}s" ` +
      `x="${xt(t)}" y="${y + 2}" width="${PX1 - xt(t)}" height="11" rx="3" fill="var(--live)"/>`,
    `<rect data-viz-id="stock-${word}" data-label="stock: &quot;${word}&quot; arrives at the final paste, ${T_FINAL}s" ` +
      `x="${xt(T_FINAL)}" y="${y + 17}" width="${PX1 - xt(T_FINAL)}" height="7" rx="2" fill="var(--stock)" opacity="0.85"/>`,
  );
});

// the one honest annotation: the last word rides the same final paste as stock
const yLast = ry(WORDS.length - 1);
parts.push(
  `<text x="0" y="${yLast + 40}" fill="var(--warn)" font-family="var(--mono)" font-size="10.5">` +
    `↑ never crossed a word boundary — it rides the final paste too</text>`,
);

document.querySelector("#card-chart")!.innerHTML = parts.join("");

/* ─────────────────────── the walkthrough stepper ───────────────────────
     Spoken: "set the um retry budget to three attempts". Every committed /
     eligible / delta value below is what live_delta() actually computes. */

const D = (s: string) => `<span class="delta">${s}</span>`;
interface Step {
  when: string;
  call: string;
  committed: string;
  tentative: string;
  final?: boolean;
  elig: string;
  delta: string;
  doc: string;
  lede: string;
}
const STEPS: Step[] = [
  {
    when: "0.8s · feed()",
    call: "committed_changed → live_delta()",
    committed: "set the",
    tentative: " u",
    elig: `<span class="el">set</span>`,
    delta: D("set"),
    doc: "set",
    lede: `<code>committed</code> grew, so <code>live_delta</code> runs. Only <b>complete words</b> are eligible — everything up to the last whitespace — so <code>"set the"</code> yields <code>"set"</code> and <code>"the"</code> waits.`,
  },

  {
    when: "1.0s · feed()",
    call: "tentative only → not called",
    committed: "set the",
    tentative: " um r",
    elig: `<span class="none">— not re-derived</span>`,
    delta: `<span class="none">nothing</span>`,
    doc: "set",
    lede: `<b>Most updates look like this.</b> The stream revises its tentative tail several times a second; <code>committed</code> didn't move, so the filter doesn't re-run and nothing reaches your app.`,
  },

  {
    when: "1.2s · feed()",
    call: "committed_changed → live_delta()",
    committed: "set the um",
    tentative: " retr",
    elig: `<span class="el">set the</span>`,
    delta: D(" the"),
    doc: "set the",
    lede: `<code>um</code> has been committed, but it's the trailing word, so it isn't eligible. That's the rule earning its keep: the filler filter matches on word boundaries and would happily type a half-streamed <code>"u"</code>.`,
  },

  {
    when: "1.7s · feed()",
    call: "committed_changed → live_delta()",
    committed: "set the um retry",
    tentative: " bu",
    elig: `<span class="el">set the </span><span class="drop">um</span>`,
    delta: `<span class="none">nothing — empty delta</span>`,
    doc: "set the",
    lede: `<b>The filler never gets typed.</b> <code>um</code> became complete and <code>remove_filler_words</code> dropped it in the same breath. The eligible prefix is still <code>"set the"</code>, so <code>strip_prefix</code> returns an empty delta and live paste stays quiet.`,
  },

  {
    when: "2.1s · feed()",
    call: "committed_changed → live_delta()",
    committed: "set the um retry budget",
    tentative: " to",
    elig: `<span class="el">set the </span><span class="drop">um</span><span class="el"> retry</span>`,
    delta: D(" retry"),
    doc: "set the retry",
    lede: `<code>retry</code> is complete now and the filler in front of it is already gone, so it lands directly after <code>the</code>. The <em>whole</em> prefix is re-filtered and re-diffed every update — filtering each delta in isolation would have typed the <code>um</code> three steps ago.`,
  },

  {
    when: "2.7s · feed()",
    call: "committed_changed → live_delta()",
    committed: "set the um retry budget to three",
    tentative: "",
    elig: `<span class="el">set the </span><span class="drop">um</span><span class="el"> retry budget to</span>`,
    delta: D(" budget to"),
    doc: "set the retry budget to",
    lede: `Two words in one delta. Commit boundaries snap to <b>UTF-8 characters, never words</b>, so a delta is however many whole words the boundary happened to cross — sometimes none, sometimes several.`,
  },

  {
    when: "3.1s · feed()",
    call: "committed_changed → live_delta()",
    committed: "set the um retry budget to three attempts",
    tentative: "",
    elig: `<span class="el">set the </span><span class="drop">um</span><span class="el"> retry budget to three</span>`,
    delta: D(" three"),
    doc: "set the retry budget to three",
    lede: `<code>attempts</code> is committed but has no whitespace after it, so it waits. <b>This is the one-word floor.</b> Nothing after this point can be typed until you let go of the key.`,
  },

  {
    when: "3.6s · RELEASE",
    call: "finalize() → remaining_after_live()",
    committed: "set the um retry budget to three attempts",
    tentative: "",
    final: true,
    elig: `<span class="el">set the retry budget to three attempts</span> <span class="none">← final text, full filter</span>`,
    delta: `<span class="delta final"> attempts</span>`,
    doc: "set the retry budget to three attempts",
    lede: `Hotkey released. <code>finalize()</code> returns the whole utterance and post-processing runs on it normally — <b>history records the full text</b>. Then <code>remaining_after_live</code> subtracts the live-typed prefix, so only <code>" attempts"</code> is pasted, through your normal Paste Method with the trailing space and auto-submit that are only correct once.`,
  },
];

const el = {
  when: $("#s-when")!,
  call: $("#s-call")!,
  stream: $("#s-stream")!,
  elig: $("#s-elig")!,
  delta: $("#s-delta")!,
  doc: $("#s-doc")!,
  lede: $("#s-lede")!,
  pos: $("#s-pos")!,
};

function render(i: number) {
  const s = STEPS[i]!;
  el.when.innerHTML = `<span style="color:${s.final ? "var(--warn)" : "var(--live)"}">${s.when}</span>`;
  el.call.innerHTML = `<span style="color:var(--faint)">${s.call}</span>`;
  el.stream.innerHTML =
    `<span class="cm">${s.committed}</span>` +
    (s.tentative ? `<span class="tv">${s.tentative}</span>` : `<span class="none"> ·</span>`);
  el.elig.innerHTML = s.elig;
  el.delta.innerHTML = s.delta;
  el.doc.innerHTML = `${s.doc}<span class="caret"></span>`;
  el.lede.innerHTML = s.lede;
  el.pos.textContent = `${i + 1} / ${STEPS.length}`;
}

const st = stepper({ n: STEPS.length, onStep: render, autoplayMs: 3200, hashKey: "delta" });
const nextBtn = $("#s-next")!,
  prevBtn = $("#s-prev")!,
  playBtn = $("#s-play")!;
nextBtn.addEventListener("click", () => st.next());
prevBtn.addEventListener("click", () => st.prev());
let playing = false;
playBtn.addEventListener("click", () => {
  playing = !playing;
  if (playing) {
    st.play();
    playBtn.textContent = "❚❚ pause";
  } else {
    st.pause();
    playBtn.textContent = "▶ play";
  }
});
// a manual nav pauses autoplay inside stepper() — keep the button honest about it
const stopPlaying = () => {
  playing = false;
  playBtn.textContent = "▶ play";
};
for (const b of [nextBtn, prevBtn]) b.addEventListener("click", stopPlaying);
