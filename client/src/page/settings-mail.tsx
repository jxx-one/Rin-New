import {
  SettingsBadge,
  SettingsCard,
  SettingsCardBody,
  SettingsCardHeader,
  SettingsCardRow,
} from "@rin/ui";
import * as Switch from "@radix-ui/react-switch";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import ReactLoading from "react-loading";
import { client } from "../app/runtime";
import { Button } from "../components/button";
import { useAlert } from "../components/dialog";
import { ItemTitle } from "./settings-items";
import {
  buildMailTestRequest,
  type MailSettingsValue,
} from "./settings-helpers";

const inputClass =
  "w-full rounded-xl border border-black/10 bg-w px-4 py-3 text-sm t-primary outline-none transition-colors placeholder:text-neutral-400 focus:border-black/20 focus:ring-2 focus:ring-theme/10 dark:border-white/10 dark:placeholder:text-neutral-500 dark:focus:border-white/20";

export function MailSettings({
  value,
  onChange,
}: {
  value: MailSettingsValue;
  onChange: (updates: Partial<MailSettingsValue>) => void;
}) {
  const { t } = useTranslation();
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testResult, setTestResult] = useState<{ error?: string; details?: string } | null>(null);
  const { alertUI } = useAlert();

  const handleTestMail = async () => {
    setTestStatus("testing");
    setTestResult(null);
    try {
      const { data, error } = await client.config.testMail(buildMailTestRequest(value));

      if (error) {
        setTestStatus("error");
        setTestResult({
          error: error.value || t("settings.mail.test.failed"),
        });
      } else if (data?.success) {
        setTestStatus("success");
        setTestResult(null);
      } else {
        setTestStatus("error");
        setTestResult({
          error: data?.error || t("settings.mail.test.failed"),
          details: data?.details,
        });
      }
    } catch (err) {
      setTestStatus("error");
      setTestResult({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <>
      <ItemTitle title={t("settings.mail.title")} />
      <SettingsCard>
        <SettingsCardRow
          header={
            <SettingsCardHeader
              title={t("settings.mail.enable.title")}
              description={t("settings.mail.enable.desc")}
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
        <>
          <SettingsCard>
            <SettingsCardHeader
              title={t("settings.mail.api_url.title")}
              description={t("settings.mail.api_url.desc")}
            />
            <SettingsCardBody>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2 lg:col-span-2">
                  <input
                    type="text"
                    value={value.apiUrl}
                    onChange={(event) => onChange({ apiUrl: event.target.value })}
                    placeholder="https://skymail.ink"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium t-primary">{t("settings.mail.email.title")}</p>
                  <input
                    type="email"
                    value={value.email}
                    onChange={(event) => onChange({ email: event.target.value })}
                    placeholder="admin@example.com"
                    className={inputClass}
                  />
                  <p className="text-xs text-neutral-500">{t("settings.mail.email.desc")}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium t-primary">
                    {t("settings.mail.password.title")}
                    {value.passwordSet && (
                      <span className="ml-2">
                        <SettingsBadge tone="success">{t("settings.mail.password.set")}</SettingsBadge>
                      </span>
                    )}
                  </p>
                  <input
                    type="password"
                    name="rin-mail-password"
                    autoComplete="new-password"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    value={value.password}
                    onChange={(event) => onChange({ password: event.target.value })}
                    placeholder={
                      value.passwordSet
                        ? t("settings.mail.password.placeholder_set")
                        : t("settings.mail.password.placeholder")
                    }
                    className={inputClass}
                  />
                  <p className="text-xs text-neutral-500">{t("settings.mail.password.desc")}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium t-primary">{t("settings.mail.account_id.title")}</p>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={value.accountId}
                    onChange={(event) => onChange({ accountId: event.target.value })}
                    placeholder={t("settings.mail.account_id.placeholder")}
                    className={inputClass}
                  />
                  <p className="text-xs text-neutral-500">{t("settings.mail.account_id.desc")}</p>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-medium t-primary">{t("settings.mail.from_name.title")}</p>
                  <input
                    type="text"
                    value={value.fromName}
                    onChange={(event) => onChange({ fromName: event.target.value })}
                    placeholder={t("settings.mail.from_name.placeholder")}
                    className={inputClass}
                  />
                  <p className="text-xs text-neutral-500">{t("settings.mail.from_name.desc")}</p>
                </div>
                <div className="space-y-2 lg:col-span-2">
                  <p className="text-sm font-medium t-primary">{t("settings.mail.to.title")}</p>
                  <input
                    type="text"
                    value={value.to}
                    onChange={(event) => onChange({ to: event.target.value })}
                    placeholder="you@example.com"
                    className={inputClass}
                  />
                  <p className="text-xs text-neutral-500">{t("settings.mail.to.desc")}</p>
                </div>
              </div>
            </SettingsCardBody>
          </SettingsCard>

          <SettingsCard>
            <SettingsCardRow
              header={
                <SettingsCardHeader
                  title={t("settings.mail.events.title")}
                  description={t("settings.mail.events.desc")}
                />
              }
              action={null}
            />
            <SettingsCardRow
              header={
                <SettingsCardHeader
                  title={t("settings.mail.events.comment.title")}
                  description={t("settings.mail.events.comment.desc")}
                />
              }
              action={
                <Switch.Root
                  className="SwitchRoot"
                  checked={value.notifyComment}
                  onCheckedChange={(checked) => onChange({ notifyComment: checked })}
                >
                  <Switch.Thumb className="SwitchThumb" />
                </Switch.Root>
              }
            />
            <SettingsCardRow
              header={
                <SettingsCardHeader
                  title={t("settings.mail.events.friend.title")}
                  description={t("settings.mail.events.friend.desc")}
                />
              }
              action={
                <Switch.Root
                  className="SwitchRoot"
                  checked={value.notifyFriend}
                  onCheckedChange={(checked) => onChange({ notifyFriend: checked })}
                >
                  <Switch.Thumb className="SwitchThumb" />
                </Switch.Root>
              }
            />
            <SettingsCardRow
              header={
                <SettingsCardHeader
                  title={t("settings.mail.events.feed.title")}
                  description={t("settings.mail.events.feed.desc")}
                />
              }
              action={
                <Switch.Root
                  className="SwitchRoot"
                  checked={value.notifyFeed}
                  onCheckedChange={(checked) => onChange({ notifyFeed: checked })}
                >
                  <Switch.Thumb className="SwitchThumb" />
                </Switch.Root>
              }
            />
          </SettingsCard>

          <SettingsCard
            tone={testStatus === "error" ? "danger" : testStatus === "success" ? "success" : "default"}
          >
            <SettingsCardRow
              header={
                <SettingsCardHeader
                  title={t("settings.mail.test.title")}
                  description={t("settings.mail.test.desc")}
                />
              }
              action={
                <>
                  {testStatus === "testing" && (
                    <ReactLoading width="1em" height="1em" type="spin" color="#FC466B" />
                  )}
                  <Button
                    title={t("settings.mail.test.button")}
                    onClick={handleTestMail}
                    disabled={testStatus === "testing"}
                  />
                </>
              }
            />
            {testStatus === "success" && (
              <SettingsCardBody>
                <p className="text-sm font-semibold text-green-700 dark:text-green-300">
                  {t("settings.mail.test.success")}
                </p>
              </SettingsCardBody>
            )}
            {testStatus === "error" && testResult && (
              <SettingsCardBody>
                <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">
                  {t("settings.mail.test.failed")}
                </p>
                {testResult.error && (
                  <p className="mt-1 text-xs font-medium text-red-700 dark:text-red-300">
                    {testResult.error}
                  </p>
                )}
                {testResult.details && (
                  <p className="mt-1 text-xs text-red-600 dark:text-red-400">{testResult.details}</p>
                )}
              </SettingsCardBody>
            )}
          </SettingsCard>
        </>
      )}
      {alertUI}
    </>
  );
}
