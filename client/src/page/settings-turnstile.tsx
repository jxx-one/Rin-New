import {
  SettingsBadge,
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
  SettingsCardRow,
} from "@rin/ui";
import * as Switch from "@radix-ui/react-switch";
import { useTranslation } from "react-i18next";
import { ItemTitle } from "./settings-items";
import type { TurnstileSettingsValue } from "./settings-helpers";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-w px-4 py-3 text-sm t-primary outline-none transition-colors placeholder:text-neutral-400 focus:border-black/20 focus:ring-2 focus:ring-theme/10 dark:border-white/10 dark:placeholder:text-neutral-500 dark:focus:border-white/20";

/** Cloudflare Turnstile 人机验证设置：开关 + 站点密钥（公开）+ 服务端密钥（打码）。 */
export function TurnstileSettings({
  value,
  onChange,
}: {
  value: TurnstileSettingsValue;
  onChange: (updates: Partial<TurnstileSettingsValue>) => void;
}) {
  const { t } = useTranslation();

  return (
    <>
      <ItemTitle title={t("settings.turnstile.title")} />
      <SettingsCard>
        <SettingsCardRow
          header={
            <SettingsCardHeader
              title={t("settings.turnstile.enable.title")}
              description={t("settings.turnstile.enable.desc")}
            />
          }
          action={
            <Switch.Root
              className="SwitchRoot"
              checked={value.enabled}
              onCheckedChange={(checked) => onChange({ enabled: checked })}
            >
              <Switch.Thumb className="SwitchThumb" />
            </Switch.Root>
          }
        />
      </SettingsCard>

      {value.enabled && (
        <SettingsCard>
          <SettingsCardHeader
            title={t("settings.turnstile.keys.title")}
            description={t("settings.turnstile.keys.desc")}
          />
          <SettingsCardBody>
            <div className="grid gap-4">
              <div className="space-y-2">
                <p className="text-sm font-medium t-primary">{t("settings.turnstile.site_key.title")}</p>
                <input
                  type="text"
                  value={value.siteKey}
                  onChange={(event) => onChange({ siteKey: event.target.value })}
                  placeholder="0x4AAAAAAA..."
                  className={inputClass}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                />
                <p className="text-xs text-neutral-500">{t("settings.turnstile.site_key.desc")}</p>
              </div>
              <div className="space-y-2">
                <p className="text-sm font-medium t-primary">
                  {t("settings.turnstile.secret_key.title")}
                  {value.secretKeySet && (
                    <span className="ml-2">
                      <SettingsBadge tone="success">{t("settings.turnstile.secret_key.set")}</SettingsBadge>
                    </span>
                  )}
                </p>
                <input
                  type="password"
                  name="rin-turnstile-secret"
                  autoComplete="new-password"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  value={value.secretKey}
                  onChange={(event) => onChange({ secretKey: event.target.value })}
                  placeholder={
                    value.secretKeySet
                      ? t("settings.turnstile.secret_key.placeholder_set")
                      : t("settings.turnstile.secret_key.placeholder")
                  }
                  className={inputClass}
                />
                <p className="text-xs text-neutral-500">{t("settings.turnstile.secret_key.desc")}</p>
              </div>
            </div>
          </SettingsCardBody>
        </SettingsCard>
      )}
    </>
  );
}
