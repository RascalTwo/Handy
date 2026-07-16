import React from "react";
import { useTranslation } from "react-i18next";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { Alert } from "../ui/Alert";
import { useSettings } from "../../hooks/useSettings";
import type { PasteMethod, PasteTiming } from "@/bindings";

interface PasteTimingProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

/** Paste methods that go through the clipboard rather than typing keystrokes. */
const CLIPBOARD_METHODS: PasteMethod[] = [
  "ctrl_v",
  "ctrl_shift_v",
  "shift_insert",
];

export const PasteTimingSetting: React.FC<PasteTimingProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const options = [
      {
        value: "on_finish",
        label: t("settings.advanced.pasteTiming.options.onFinish"),
      },
      {
        value: "live",
        label: t("settings.advanced.pasteTiming.options.live"),
      },
    ];

    const selected = (getSetting("paste_timing") || "on_finish") as PasteTiming;
    const pasteMethod = (getSetting("paste_method") || "ctrl_v") as PasteMethod;
    const postProcessEnabled = getSetting("post_process_enabled") || false;

    // Only the caveats that actually apply right now — a static list of
    // everything Live touches is noise the user has to filter themselves.
    const caveats: string[] = [];
    if (selected === "live") {
      if (pasteMethod === "none") {
        caveats.push(t("settings.advanced.pasteTiming.liveWarning.pasteNone"));
      } else if (CLIPBOARD_METHODS.includes(pasteMethod)) {
        caveats.push(
          t("settings.advanced.pasteTiming.liveWarning.pasteClipboard"),
        );
      } else if (pasteMethod === "external_script") {
        caveats.push(
          t("settings.advanced.pasteTiming.liveWarning.pasteExternalScript"),
        );
      }
      if (postProcessEnabled) {
        caveats.push(
          t("settings.advanced.pasteTiming.liveWarning.postProcessing"),
        );
      }
      caveats.push(t("settings.advanced.pasteTiming.liveWarning.lastWord"));
      caveats.push(t("settings.advanced.pasteTiming.liveWarning.cancel"));
      caveats.push(
        t("settings.advanced.pasteTiming.liveWarning.streamingOnly"),
      );
    }

    // Warn only where the combination is actually broken: post-processing's
    // result gets thrown away, and None types nothing at all. The rest are
    // consequences worth knowing about that still behave correctly.
    const isBroken = postProcessEnabled || pasteMethod === "none";
    const variant = isBroken ? "warning" : "info";

    return (
      <SettingContainer
        title={t("settings.advanced.pasteTiming.title")}
        description={t("settings.advanced.pasteTiming.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
        tooltipPosition="bottom"
      >
        <div className="flex flex-col gap-2">
          <Dropdown
            options={options}
            selectedValue={selected}
            onSelect={(value) =>
              updateSetting("paste_timing", value as PasteTiming)
            }
            disabled={isUpdating("paste_timing")}
          />
          {caveats.length > 0 && (
            <Alert variant={variant}>
              <span className="font-medium">
                {t("settings.advanced.pasteTiming.liveWarning.title")}
              </span>
              <ul className="mt-1 list-disc list-outside pl-4 space-y-1">
                {caveats.map((caveat) => (
                  <li key={caveat}>{caveat}</li>
                ))}
              </ul>
            </Alert>
          )}
        </div>
      </SettingContainer>
    );
  },
);
