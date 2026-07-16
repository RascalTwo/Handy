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

|                      | Upstream                                               | Here                                        |
| -------------------- | ------------------------------------------------------ | ------------------------------------------- |
| App name / bundle id | `Handy` / `com.pais.handy`                             | `Handy (RascalTwo)` / `com.rascaltwo.handy` |
| Auto-updater         | On, points at upstream's releases                      | **Off, and disabled by construction**       |
| Shortcuts            | `transcribe`, `transcribe_with_post_process`, `cancel` | **+ `transcribe_live`**                     |

## Patch: Live paste

Adds a third transcribe shortcut. Everything else is unchanged.

| Shortcut                        | Default (macOS)      | Behavior                                                               |
| ------------------------------- | -------------------- | ---------------------------------------------------------------------- |
| Transcribe                      | `option+space`       | Stock — the whole transcription is pasted when you release.            |
| **Transcribe Live**             | `ctrl+option+space`  | **New.** Types each word into the focused app as the model commits it. |
| Transcribe with Post-Processing | `option+shift+space` | Stock. Never live (see below).                                         |

This deliberately mirrors how `transcribe_with_post_process` already works: one
`TranscribeAction`, a flag, a second binding. **There is no mode setting** — the
shortcut you press _is_ the mode, exactly as post-processing has no "post-process
my main key" setting. Nothing about your existing shortcut changes; the new
binding is merged into an existing settings store on load.

Its hotkey lives in **Settings → Advanced → Live Paste**, with a notice under it
listing what it does differently for your current settings.

That structure also kills the one real incompatibility for free: post-processing
rewrites the whole transcript, which can't be reconciled with words already
typed — and because the _binding_ decides, the post-processing shortcut simply
can't be live. The bad combination is unreachable rather than warned about.

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
[BUILD.md](./BUILD.md) covers the toolchain.

**Do the [certificate step](#you-need-a-code-signing-certificate-first-a-free-self-signed-one)
first** — `tauri.conf.json` names a signing identity, so a build without it fails
at the signing step rather than falling back to ad-hoc. That's deliberate; the
fallback is a worse outcome than a clear failure, for the reason explained there.

Then, on Apple Silicon:

```sh
bun install
bunx tauri build --bundles app
```

That drops `Handy (RascalTwo).app` in `src-tauri/target/release/bundle/macos/` —
drag it to `/Applications`. Expect a slow first build: it compiles
whisper.cpp/ggml from source, and the release profile uses `lto = true` with
`codegen-units = 1`.

**No Apple Developer account is needed**, and no notarization. A locally compiled
app is never quarantined, so there's no Gatekeeper prompt and no `xattr`
incantation either.

Two things about that command:

- `--bundles app` skips the `.dmg`. A disk image only exists to hand the app to
  someone else, and you're building it yourself. It also dodges a real failure
  mode: `bundle_dmg.sh` mounts a temporary volume, and a leftover mount from an
  earlier build makes the next one die with an unhelpful
  `error running bundle_dmg.sh`. If that happens, look for a stray `dmg.XXXXXX`
  in `ls /Volumes/` and `hdiutil detach /Volumes/dmg.XXXXXX -force`.
- There's no `--` before `--bundles`. `bun run tauri build -- --bundles app`
  forwards the flag to _cargo_ instead of tauri, which fails with a baffling
  "a similar argument exists: '--benches'".

### You need a code-signing certificate first (a free, self-signed one)

`tauri.conf.json` sets `signingIdentity: "Handy Fork Local Signing"` rather than
upstream's `"-"` (ad-hoc). **Ad-hoc signing is a trap for anything needing
Accessibility**, and it will waste your afternoon if you skip this.

Handy injects keystrokes, which requires **Accessibility** permission. macOS pins
that grant to the app's _designated requirement_. Ad-hoc signing produces:

    designated => cdhash H"68d591e1a01c5439325bfb53bfdcfbb64441b8f2"

— pinned to that exact binary. Every rebuild changes the cdhash, so the stored
grant stops matching. The failure is nasty: System Settings still shows the app
ticked, the app insists permission is missing, and toggling the checkbox does
nothing because it reuses the same stale record. Signing with a certificate
instead produces:

    designated => identifier "com.rascaltwo.handy" and certificate leaf = H"..."

— pinned to the identity, which rebuilds don't change. Grant once, done.

Create one (free, no Apple account, ~1 minute):

```sh
security create-keychain -p handy-local-signing handy-signing.keychain
security unlock-keychain -p handy-local-signing handy-signing.keychain
security set-keychain-settings handy-signing.keychain   # no auto-lock

openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout handy-sign.key -out handy-sign.crt \
  -subj "/CN=Handy Fork Local Signing" \
  -addext "basicConstraints=critical,CA:false" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning"

# -certpbe/-keypbe/-macalg are required: OpenSSL 3 defaults to algorithms
# macOS's Security framework can't read ("MAC verification failed").
openssl pkcs12 -export -out handy-sign.p12 \
  -inkey handy-sign.key -in handy-sign.crt -passout pass:handy-local-signing \
  -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1

security import handy-sign.p12 -k handy-signing.keychain \
  -P handy-local-signing -T /usr/bin/codesign -A
security set-key-partition-list -S apple-tool:,apple:,codesign: \
  -s -k handy-local-signing handy-signing.keychain
security list-keychains -d user -s login.keychain-db handy-signing.keychain
```

`security find-identity -p codesigning` should now list it. It reports
`CSSMERR_TP_NOT_TRUSTED` — that's expected and harmless; `codesign` doesn't
require the certificate to be trusted, only to exist. (`find-identity -v` hides
it for exactly that reason.)

**A dedicated keychain locks on reboot.** If a build fails to sign, unlock it:

```sh
security unlock-keychain -p handy-local-signing handy-signing.keychain
```

Prefer no unlock step? Import into `login.keychain-db` instead — it unlocks at
login, at the cost of a one-time "codesign wants to access key" prompt.

If you've already been bitten and the grant is wedged, delete the stale record
rather than toggling the checkbox:

```sh
tccutil reset Accessibility com.rascaltwo.handy
tccutil reset Microphone com.rascaltwo.handy
```

## Running it alongside stock Handy

You can run both at the same time — the bundle identifier differs, so they get
separate settings, separate history, separate Accessibility grants, and
`tauri-plugin-single-instance` treats them as different apps. Models are shared,
not duplicated: `hf_cached_path` (`model.rs:275`) resolves from
`~/.cache/huggingface/hub`, so a model you've already downloaded is reused.

**One thing will bite you.** Both apps default the transcribe shortcut to
`option+space`, and a global shortcut can only be claimed once — whichever app
registers second logs `Shortcut 'option+space' is already in use` and that
shortcut silently does nothing. It won't fire twice, but it will look broken.
Rebind one of them, or just quit the other. This fork's settings live at
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
live-typed text is _not_ naively a prefix of the final text.

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

### What the live shortcut does differently

- **Clipboard paste methods** are bypassed for streamed words, which are always
  typed directly — one clipboard write per word would destroy your clipboard.
  Only the final word honors your Paste Method. (Paste Method still decides
  _how_ text is sent; this only overrides it mid-stream, where it can't work.)
- **Cancelling** can't un-type what's already in your document.
- **Non-streaming models** produce no partial text, so this shortcut behaves
  exactly like the normal Transcribe shortcut.
- **Post-processing** isn't a conflict, because it isn't reachable: that's a
  different shortcut, and it's never live. `remaining_after_live` still detects a
  mismatch defensively and leaves the live text standing rather than pasting a
  duplicate.

Push-to-talk _is_ fine, despite the obvious worry: enigo's macOS `fast_text`
posts the literal Unicode string with `CGEventFlagNull`, explicitly ignoring held
modifiers, so typing while the shortcut's modifiers are physically down doesn't
mangle the text. Tested.

## Files touched

| File                                                    | Change                                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src-tauri/src/settings.rs`                             | `transcribe_live` binding default, updater default off                                         |
| `src-tauri/src/managers/transcription.rs`               | `begin_utterance()`, `live_delta()`, `inject_live_delta()`                                     |
| `src-tauri/src/clipboard.rs`                            | `paste_raw()` — types text with no trailing space / auto-submit / clipboard write              |
| `src-tauri/src/actions.rs`                              | `live` flag on `TranscribeAction`, `transcribe_live` in `ACTION_MAP`, `remaining_after_live()` |
| `src/components/settings/LivePaste.tsx`                 | The live shortcut + its notice                                                                 |
| `src/components/settings/advanced/AdvancedSettings.tsx` | Renders the Live Paste group                                                                   |
| `src/i18n/locales/*/translation.json`                   | Strings                                                                                        |
| `src-tauri/tauri.conf.json`                             | Fork identity; updater endpoints emptied                                                       |

Kept deliberately additive and localized. `transcription.rs` sees regular
upstream churn and "settings refactoring" is on upstream's roadmap, so every line
touched is a future merge conflict. Rebase on release tags rather than `main`.

## Keeping up with upstream

The patch is deliberately a small stack of commits on top of an upstream release
tag, so updating means replaying it onto the next one. Rebase, don't merge — a
merge buries the patch in the history and makes "what's actually mine" impossible
to answer, which is the question you need answered every time upstream refactors
something underneath it.

```sh
git remote add upstream https://github.com/cjpais/Handy.git   # one time
git fetch upstream --tags

git rebase v0.9.4                # or whatever the next release tag is
# ...resolve, then:
cd src-tauri && cargo test        # the fork guards live here — see below
bunx tauri build --bundles app
git push --force-with-lease
```

Rebase on **release tags, not `main`.** Tags are tested; `main` is whatever
landed an hour ago, and you'd be debugging upstream's work-in-progress on top of
your own.

`git log v0.9.4..HEAD` is then always exactly the fork's delta.

### The conflicts you will actually hit

- **`tauri.conf.json` — every single release.** `version` sits two lines from
  `productName` and `identifier`, so a version bump always collides with the fork
  identity. Take upstream's `version`, keep everything else. Resolving it the
  other way is silent and bad, so `cargo test` has a guard
  (`fork_identity_survived_the_rebase`) that fails loudly if the identifier,
  signing identity, or updater endpoints revert. **Run the tests after every
  rebase** — that guard and `update_checks_are_off_by_default_in_this_fork` exist
  precisely because nothing at runtime would tell you.
- **`Cargo.lock`.** Take upstream's wholesale and re-run the build; never
  hand-merge it.
- **`transcription.rs` / `actions.rs`.** Where the real work is. Both see regular
  upstream churn, and "settings refactoring" and "Tauri commands cleanup" are
  both on upstream's roadmap, so expect a genuine conflict here eventually.

### If upstream changes how bindings work

Adding a transcribe binding means touching **three** places, and missing one
fails quietly:

1. `ACTION_MAP` (`actions.rs`) — what the binding does.
2. `get_default_settings()` (`settings.rs`) — its default shortcut.
3. `is_transcribe_binding()` (`transcription_coordinator.rs`) — **the easy one to
   miss.** Skip it and the binding silently drops onto the plain press/release
   path: hold-to-talk regardless of the push-to-talk setting, and outside the
   coordinator's lifecycle serialisation. That bug shipped here once.

`every_recording_binding_reaches_the_coordinator` pins #3.

## Trademark note

Upstream's README is explicit that the Handy **name, logo, icon, and brand assets
are not open-source**, and that unofficial forks must use their own branding and
must not imply endorsement or affiliation. This fork currently reuses the name and
upstream's icons, which is fine for a build-it-yourself fork but would need
renaming and re-iconing before anything resembling a distributed release.

This fork is not affiliated with or endorsed by cjpais.
