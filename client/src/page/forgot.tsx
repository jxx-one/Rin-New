import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Button, ButtonWithLoading } from "../components/button";
import { Input } from "../components/input";
import { TurnstileWidget } from "../components/turnstile";
import { client } from "../app/runtime";

/** 忘记密码：邮箱验证码重置密码。 */
export function ForgotPasswordPage() {
    const { t } = useTranslation();
    const [, setLocation] = useLocation();
    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [codeSending, setCodeSending] = useState(false);
    const [codeCooldown, setCodeCooldown] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [turnstile, setTurnstile] = useState<{ active: boolean; siteKey: string }>({ active: false, siteKey: "" });
    const [captchaToken, setCaptchaToken] = useState("");
    const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    const resetCaptcha = () => {
        if (!turnstile.active) {
            return;
        }
        setCaptchaToken("");
        setCaptchaResetSignal((current) => current + 1);
    };

    useEffect(() => {
        client.auth.status().then(({ data }) => {
            setTurnstile({
                active: Boolean(data?.turnstile),
                siteKey: data?.turnstileSiteKey || "",
            });
        }).catch(() => {
            setTurnstile({ active: false, siteKey: "" });
        });
    }, []);

    useEffect(() => {
        if (codeCooldown <= 0) {
            return;
        }
        const timer = window.setInterval(() => {
            setCodeCooldown((current) => Math.max(0, current - 1));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [codeCooldown]);

    const sendCode = async () => {
        const nextEmail = email.trim().toLowerCase();
        if (!nextEmail) {
            setError(t("forgot.error.empty_email"));
            return;
        }
        if (turnstile.active && !captchaToken) {
            setError(t("forgot.error.captcha"));
            return;
        }

        setCodeSending(true);
        setError("");
        setSuccess("");
        try {
            const { data, error: apiError } = await client.auth.sendPasswordResetCode({
                email: nextEmail,
                turnstileToken: captchaToken || undefined,
            });
            if (apiError) {
                const message = String(apiError.value || "").toLowerCase();
                if (turnstile.active && message.includes("verification")) {
                    setError(t("forgot.error.captcha_failed"));
                } else if (apiError.status === 429) {
                    setError(t("forgot.error.rate_limited"));
                } else if (apiError.status === 503) {
                    setError(t("forgot.error.mail_unavailable"));
                } else {
                    setError(t("forgot.error.send_code_failed"));
                }
                return;
            }
            setCodeCooldown(Number(data?.resendAfter) || 60);
            setSuccess(t("forgot.code_sent"));
        } catch {
            setError(t("forgot.error.network"));
        } finally {
            setCodeSending(false);
            resetCaptcha();
        }
    };

    const submit = async () => {
        const nextEmail = email.trim().toLowerCase();
        if (!nextEmail || !code.trim() || !password.trim()) {
            setError(t("forgot.error.empty"));
            return;
        }
        if (!/^\d{6}$/.test(code.trim())) {
            setError(t("forgot.error.code_invalid"));
            return;
        }
        if (password.trim().length < 8) {
            setError(t("forgot.error.password_too_short"));
            return;
        }
        if (password.trim() !== confirmPassword.trim()) {
            setError(t("forgot.error.password_mismatch"));
            return;
        }
        if (turnstile.active && !captchaToken) {
            setError(t("forgot.error.captcha"));
            return;
        }

        setIsLoading(true);
        setError("");
        setSuccess("");

        try {
            const { error: apiError } = await client.auth.resetPassword({
                email: nextEmail,
                code: code.trim(),
                password: password.trim(),
                turnstileToken: captchaToken || undefined,
            });

            if (apiError) {
                const message = String(apiError.value || "").toLowerCase();
                if (turnstile.active && message.includes("verification")) {
                    setError(t("forgot.error.captcha_failed"));
                } else if (apiError.status === 409) {
                    setError(t("forgot.error.too_many_attempts"));
                } else if (apiError.status === 400) {
                    setError(t("forgot.error.code_invalid"));
                } else if (apiError.status === 503) {
                    setError(t("forgot.error.mail_unavailable"));
                } else {
                    setError(t("forgot.error.failed"));
                }
                return;
            }

            setSuccess(t("forgot.success"));
            setTimeout(() => {
                setLocation("/login");
            }, 1200);
        } catch {
            setError(t("forgot.error.network"));
        } finally {
            setIsLoading(false);
            resetCaptcha();
        }
    };

    return (
        <div className="flex items-center justify-center my-8">
            <div className="bg-w w-full max-w-md flex flex-col items-stretch p-8 space-y-4 t-primary rounded-2xl shadow-lg">
                <p className="text-2xl font-bold text-center">{t("forgot.title")}</p>
                <p className="text-xs t-secondary text-center -mt-2">{t("forgot.subtitle")}</p>

                {error && <p className="text-sm text-red-500">{error}</p>}
                {success && <p className="text-sm text-green-500">{success}</p>}

                <div className="space-y-1">
                    <label className="text-sm font-medium t-secondary">{t("forgot.email")}</label>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                            value={email}
                            setValue={(value) => {
                                setError("");
                                setEmail(value);
                            }}
                            placeholder={t("forgot.email_placeholder")}
                            type="email"
                            disabled={isLoading}
                        />
                        <Button
                            title={codeSending
                                ? t("forgot.sending_code")
                                : codeCooldown > 0
                                    ? t("forgot.resend_code$seconds", { seconds: codeCooldown })
                                    : t("forgot.send_code")}
                            secondary
                            disabled={isLoading || codeSending || codeCooldown > 0}
                            onClick={sendCode}
                            className="shrink-0"
                        />
                    </div>
                </div>

                <div className="space-y-1">
                    <label className="text-sm font-medium t-secondary">{t("forgot.code")}</label>
                    <Input
                        value={code}
                        setValue={setCode}
                        placeholder={t("forgot.code_placeholder")}
                        disabled={isLoading}
                    />
                </div>

                <div className="space-y-1">
                    <label className="text-sm font-medium t-secondary">{t("forgot.password")}</label>
                    <Input
                        value={password}
                        setValue={setPassword}
                        placeholder={t("forgot.password_placeholder")}
                        type="password"
                        disabled={isLoading}
                    />
                </div>

                <div className="space-y-1">
                    <label className="text-sm font-medium t-secondary">{t("forgot.confirm_password")}</label>
                    <Input
                        value={confirmPassword}
                        setValue={setConfirmPassword}
                        placeholder={t("forgot.confirm_password_placeholder")}
                        type="password"
                        onSubmit={submit}
                        disabled={isLoading}
                    />
                </div>

                <div className="space-y-3 pt-1">
                    {turnstile.active && turnstile.siteKey && (
                        <TurnstileWidget
                            siteKey={turnstile.siteKey}
                            resetSignal={captchaResetSignal}
                            onToken={setCaptchaToken}
                        />
                    )}
                    <ButtonWithLoading
                        title={isLoading ? t("forgot.loading") : t("forgot.submit")}
                        onClick={submit}
                        loading={isLoading}
                        className="w-full justify-center px-6 py-2.5 text-sm font-semibold"
                    />

                    <p className="text-center text-xs t-secondary">
                        <button
                            type="button"
                            className="rounded-full px-2 py-1 font-medium text-theme transition-colors hover:bg-theme/5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme/30"
                            onClick={() => setLocation("/login")}
                        >
                            {t("forgot.back_to_login")}
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
}
