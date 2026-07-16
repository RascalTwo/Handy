import React from "react";
import { useTranslation } from "react-i18next";
import { ShortcutInput } from "./ShortcutInput";
import { Alert } from "../ui/Alert";
import { useSettings } from "../../hooks/useSettings";
import type { PasteMethod } from "@/bindings";

/** Paste methods that go through the clipboard rather than typing keystrokes. */
const CLIPBOARD_METHODS: PasteMethod[] = [
  "ctrl_v",
  "ctrl_shift_v",
  "shift_insert",
];

/**
 * The live-paste hotkey, plus what it does differently.
 *
 * Live paste is reachable only by this shortcut — there is no mode setting, the
 * same way post-processing is only reachable by its own shortcut.
 */
export const LivePasteSetting: React.FC = React.memo(() => {
  const { t } = useTranslation();
  const { getSetting } = useSettings();

  const pasteMethod = (getSetting("paste_method") || "ctrl_v") as PasteMethod;

  // Only the caveats that actually apply to the current settings — a static
  // list of everything Live touches is noise the reader has to filter.
  const caveats: string[] = [];
  if (pasteMethod === "none") {
    caveats.push(t("settings.advanced.livePaste.notice.pasteNone"));
  } else if (CLIPBOARD_METHODS.includes(pasteMethod)) {
    caveats.push(t("settings.advanced.livePaste.notice.pasteClipboard"));
  } else if (pasteMethod === "external_script") {
    caveats.push(t("settings.advanced.livePaste.notice.pasteExternalScript"));
  }
  caveats.push(t("settings.advanced.livePaste.notice.lastWord"));
  caveats.push(t("settings.advanced.livePaste.notice.cancel"));
  caveats.push(t("settings.advanced.livePaste.notice.streamingOnly"));

  // "None" is the only combination that's outright broken — nothing gets typed
  // at all. The rest are consequences worth knowing that still behave correctly.
  const variant = pasteMethod === "none" ? "warning" : "info";

  return (
    <div className="flex flex-col gap-2">
      <ShortcutInput
        shortcutId="transcribe_live"
        descriptionMode="tooltip"
        grouped={true}
      />
      <Alert variant={variant}>
        <span className="font-medium">
          {t("settings.advanced.livePaste.notice.title")}
        </span>
        <ul className="mt-1 list-disc list-outside pl-4 space-y-1">
          {caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </Alert>
    </div>
  );
});
