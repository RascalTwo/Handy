# What's different in this fork

This is [RascalTwo](https://github.com/RascalTwo)'s fork of
[cjpais/Handy](https://github.com/cjpais/Handy), branched from **v0.9.3**.

Nothing here is going upstream. Upstream is under a
[feature freeze](https://github.com/cjpais/Handy/blob/main/.github/PULL_REQUEST_TEMPLATE.md)
and has closed [several](https://github.com/cjpais/Handy/pull/1556)
[attempts](https://github.com/cjpais/Handy/pull/1515) at this area already. That's
fine — upstream's own README says it best:

> Handy isn't trying to be the best speech-to-text app—it's trying to be the most
> forkable one.

So this is a fork, not a pull request. Everything upstream does still works; the
list below is only the delta.

| | Upstream | Here |
| --- | --- | --- |
| App name / bundle id | `Handy` / `com.pais.handy` | `Handy (RascalTwo)` / `com.rascaltwo.handy` |
| Auto-updater | On, points at upstream's releases | **Off, and disabled by construction** |
| Paste timing | Always after hotkey release | Optional **Live** — types as you speak |

## Patch: Live paste

Adds **Settings → Advanced → Output → Paste Timing**, a dropdown directly below
Paste Method:

| Option | Behavior |
| --- | --- |
| **On Finish** (default) | Stock Handy — the whole transcription is pasted after you release the hotkey. |
| **Live (as you speak)** | Each word is typed into the focused app as the model commits it. |

Paste Method is *how* text is sent. Paste Timing is *when*. They're independent
axes, which is why this is a new dropdown rather than a new Paste Method.

Default is **On Finish**, so an existing settings store is unaffected until you
opt in. Selecting **Live** surfaces an in-app notice listing exactly what it
changes for your current settings.

### Why the patch is small

Upstream already did the hard part. v0.9.0
([PR #1529](https://github.com/cjpais/Handy/pull/1529), which integrated
[transcribe.cpp](https://github.com/handy-computer/transcribe.cpp)) does real
streaming inference and already emits partial text several times a second — it
just renders it in the overlay instead of sending it to your app. Each update
carries a `committed` (append-only) and `tentative` (still revisable) split.

This patch types the `committed` delta and leaves `tentative` in the overlay
where it already lives. The revision problem that normally makes live dictation
horrible — the model changing its mind and needing to backspace — doesn't arise,
because `committed` is append-only.

Two people asked for exactly this, and got a maintainer "yes, eventually":
[D#793](https://github.com/cjpais/Handy/discussions/793) ("as I talk, words begin
being put where my cursor is") and
[D#1526](https://github.com/cjpais/Handy/discussions/1526). v0.9.0 shipped the
streaming half. This is the other half.

## Building it

There are no prebuilt binaries and there won't be. Upstream's
[BUILD.md](./BUILD.md) covers the toolchain; the short version on Apple Silicon:

```sh
bun install
bun run tauri build
```

That produces `Handy (RascalTwo).app` and a `.dmg` under
`src-tauri/target/release/bundle/`. Expect a slow first build — it compiles
whisper.cpp/ggml from source and the release profile uses `lto = true` with
`codegen-units = 1`.

**No Apple Developer account is needed.** `tauri.conf.json` sets
`signingIdentity: "-"` (ad-hoc), and a locally compiled app is never quarantined,
so there's no Gatekeeper prompt and no `xattr` incantation.

Handy needs **Accessibility** permission to inject keystrokes. macOS keys that
grant to the app's code signature, and an ad-hoc signature changes on every
rebuild — so a rebuild can silently invalidate the grant, and shortcuts or
pasting stop working until you remove and re-add the app in System Settings →
Privacy & Security → Accessibility. A free self-signed Code Signing certificate
from Keychain Access (Certificate Assistant → Create a Certificate → Code
Signing), pointed at by `signingIdentity`, gives a stable identity across
rebuilds and makes this go away. Worth doing before you grant Accessibility even
once.

## Running it alongside stock Handy

You can run both at the same time — the bundle identifier differs, so they get
separate settings, separate history, separate Accessibility grants, and
`tauri-plugin-single-instance` treats them as different apps. Models are shared,
not duplicated: `hf_cached_path` (`model.rs:275`) resolves from
`~/.cache/huggingface/hub`, so a model you've already downloaded is reused.

**One thing will bite you.** Both apps default the transcribe shortcut to
`option+space` and both register it globally. Change one of them on first run —
this fork's settings live at
`~/Library/Application Support/com.rascaltwo.handy/settings_store.json`, and its
logs at `~/Library/Logs/com.rascaltwo.handy/handy.log`.

## The updater is off, deliberately

Upstream's updater is configured with upstream's minisign `pubkey` and points at
upstream's releases. Left alone in a fork, that's an active hazard rather than a
dead feature: an update check finds upstream's latest release, the signature
**verifies successfully**, and the fork is replaced by stock Handy. You'd lose
this patch and have no obvious reason why.

Two changes prevent that:

- `default_update_checks_enabled()` returns `false` (upstream: `true`), so
  nothing checks.
- `tauri.conf.json` ships `"endpoints": []`, which makes the updater fail closed
  with `Error::EmptyEndpoints` — it cannot build, let alone install anything,
  even if update checks are switched back on.

A test (`update_checks_are_off_by_default_in_this_fork`) pins the first one, so a
future rebase can't quietly restore upstream's default.

## Design notes

### Filler-word filtering is why the last word lags

Even with no custom words and post-processing off, `filter_transcription_output`
strips `um`/`uh`/`ah`/… based on `app_language`, and collapses stutters and double
spaces. Raw `committed` contains those words; the final text doesn't. So
live-typed text is *not* naively a prefix of the final text.

Handled by typing only **complete words** — everything up to the last whitespace
in `committed` — then re-filtering that whole prefix on every update and diffing
against what was already typed. The filter matches on `\b` word boundaries, so it
can't safely run over a half-streamed word: `"u"` would get typed before the
filter knows it's about to become `"um"` and vanish. Re-deriving the whole prefix
each time (rather than filtering each delta in isolation) is also what makes the
filter's retroactive edits land correctly.

The cost is that the trailing word waits for a word boundary. Combined with the
genuinely uncommitted `tentative` tail, that's why the last word or two arrive on
hotkey release rather than as you speak. **This is not fixable** — the model
hasn't decided those words yet.

### `committed` really is append-only

The whole design rests on it, and it's guaranteed rather than observed.
transcribe.cpp's `commit_stream_text` can only `append`, refuses any candidate
boundary at or behind the current one, and bails outright if the raw hypothesis
no longer matches what was already committed. Commit boundaries are snapped to
UTF-8 character boundaries only — never to word boundaries — which is exactly why
the complete-words rule above is necessary.

Verified empirically too: zero divergences across a real session — 78 revisions,
2835 frames, 1237 characters, including one 87-second utterance.

`live_delta` keeps a standing check anyway. If a `committed` ever fails to extend
the previous one it logs

    live paste: committed prefix diverged (typed ..., now ...)

and types nothing further rather than garbling your text. That line appearing in
the log is the signal the assumption broke — most likely on a different model or
a transcribe.cpp bump.

### What Live is incompatible with

- **LLM post-processing** rewrites the whole transcript, which can't be
  reconciled with words already typed. `remaining_after_live` detects the
  mismatch and leaves the live text standing rather than pasting a duplicate. The
  post-processed result is discarded. Don't enable both.
- **Clipboard paste methods** are bypassed for streamed words, which are always
  typed directly — one clipboard write per word would destroy your clipboard.
  Only the final word honors your Paste Method.
- **Cancelling** can't un-type what's already in your document.
- **Non-streaming models** produce no partial text, so Live silently behaves as
  On Finish.

Push-to-talk *is* fine, despite the obvious worry: enigo's macOS `fast_text`
posts the literal Unicode string with `CGEventFlagNull`, explicitly ignoring held
modifiers, so typing while the shortcut's modifiers are physically down doesn't
mangle the text. Tested.

## Files touched

| File | Change |
| --- | --- |
| `src-tauri/src/settings.rs` | `PasteTiming` enum, `paste_timing` field, updater default off |
| `src-tauri/src/managers/transcription.rs` | `live_typed` state, `live_delta()`, `inject_live_delta()` |
| `src-tauri/src/clipboard.rs` | `paste_raw()` — types text with no trailing space / auto-submit / clipboard write |
| `src-tauri/src/actions.rs` | `remaining_after_live()` — final paste sends only the untyped remainder |
| `src/components/settings/PasteTiming.tsx` | The dropdown + the Live notice |
| `src/components/settings/advanced/AdvancedSettings.tsx` | Renders it under Output |
| `src/i18n/locales/*/translation.json` | Strings |
| `src-tauri/tauri.conf.json` | Fork identity; updater endpoints emptied |

Kept deliberately additive and localized. `transcription.rs` sees regular
upstream churn and "settings refactoring" is on upstream's roadmap, so every line
touched is a future merge conflict. Rebase on release tags rather than `main`.

## Trademark note

Upstream's README is explicit that the Handy **name, logo, icon, and brand assets
are not open-source**, and that unofficial forks must use their own branding and
must not imply endorsement or affiliation. This fork currently reuses the name and
upstream's icons, which is fine for a build-it-yourself fork but would need
renaming and re-iconing before anything resembling a distributed release.

This fork is not affiliated with or endorsed by cjpais.
