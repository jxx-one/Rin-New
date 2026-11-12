import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Button, ButtonWithLoading } from "../components/button";
import { Input } from "../components/input";
import { client } from "../app/runtime";
import { setAuthToken } from "../utils/auth";

/** 注册页：邮箱验证码 + 用户名 + 密码，成功后自动登录。 */
export function RegisterPage() {
    const { t } = useTranslation();
    const [, setLocation] = useLocation();
    const [email, setEmail] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [code, setCode] = useState("");
    const [codeSending, setCodeSending] = useState(false);
    const [codeCooldown, setCodeCooldown] = useState(0);
    const [isLoading, setIsLoading] = useState(false);
    const [registerEnabled, setRegisterEnabled] = useState<boolean | null>(null);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState("");

    useEffect(() => {
        client.auth.status().then(({ data }) => {
            setRegisterEnabled(Boolean(data?.register));
        }).catch(() => {
            setRegisterEnabled(false);
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
            setError(t("register.error.empty_email"));
            return;
        }

        setCodeSending(true);
        setError("");
        setSuccess("");
        try {
            const { data, error: apiError } = await client.auth.sendRegisterCode({ email: nextEmail });
            if (apiError) {
                setError(apiError.status === 409
                    ? t("register.error.email_exists")
                    : t("register.error.send_code_failed"));
                return;
            }
            setCodeCooldown(Number(data?.resendAfter) || 60);
            setSuccess(t("register.code_sent"));
        } catch {
            setError(t("register.error.network"));
        } finally {
            setCodeSending(false);
        }
    };

    const submit = async () => {
        if (!email.trim() || !username.trim() || !password.trim() || !code.trim()) {
            setError(t("register.error.empty"));
            return;
        }
        if (password.trim().length < 8) {
            setError(t("register.error.password_too_short"));
            return;
        }
        if (password.trim() !== confirmPassword.trim()) {
            setError(t("register.error.password_mismatch"));
            return;
        }
        if (!/^\d{6}$/.test(code.trim())) {
            setError(t("register.error.code_invalid"));
            return;
        }

        setIsLoading(true);
        setError("");
        setSuccess("");

        try {
            const { data, error: apiError } = await client.auth.register({
                email: email.trim().toLowerCase(),
                username: username.trim(),
                password: password.trim(),
                code: code.trim(),
            });

            if (apiError) {
                if (apiError.status === 409) {
                    setError(t("register.error.conflict"));
                } else if (apiError.status === 429) {
                    setError(t("register.error.rate_limited"));
                } else if (apiError.status === 400) {
                    setError(t("register.error.code_invalid"));
                } else if (apiError.status === 403) {
                    setError(t("register.error.disabled"));
                } else {
                    setError(t("register.error.failed"));
                }
                return;
            }

            if (data?.token) {
                setAuthToken(data.token);
            }
            setSuccess(t("register.success"));
            setTimeout(() => {
                window.location.href = "/profile";
            }, 800);
        } catch {
            setError(t("register.error.network"));
        } finally {
            setIsLoading(false);
        }
    };

    if (registerEnabled === null) {
        return (
            <div className="py-8 px-4 my-32 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-theme"></div>
            </div>
        );
    }

    if (!registerEnabled) {
        return (
            <div className="flex items-center justify-center my-8">
                <div className="bg-w w-full max-w-md flex flex-col items-center p-8 space-y-4 t-primary rounded-2xl shadow-lg">
                    <p className="text-2xl font-bold">{t("register.title")}</p>
                    <p className="text-sm t-secondary text-center">{t("register.disabled_hint")}</p>
                    <Button title={t("register.back_to_login")} secondary onClick={() => setLocation("/login")} />
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-center justify-center my-8">
            <div className="bg-w w-full max-w-md flex flex-col items-stretch p-8 space-y-4 t-primary rounded-2xl shadow-lg">
                <p className="text-2xl font-bold text-center">{t("register.title")}</p>
                <p className="text-xs t-secondary text-center -mt-2">{t("register.subtitle")}</p>

                {error && <p className="text-sm text-red-500">{error}</p>}
                {success && <p className="text-sm text-green-500">{success}</p>}

                <div className="space-y-1">
                    <label className="text-sm font-medium t-secondary">{t("register.email")}</label>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                            value={email}
                            setValue={(value) => {
                                setError("");
                                setEmail(value);
                            }}
                            placeholder={t("register.email_placeholder")}
                            type="email"
                            disabled={isLoading}
                        />
                        <Button
                            title={codeSending
                                ? t("register.sending_code")
                                : codeCooldown > 0
                                    ? t("register.resend_code$seconds", { seconds: codeCooldown })
                                    : t("register.send_code")}
                            secondary
                            disabled={isLoading || codeSending || codeCooldown > 0}
                            onClick={sendCode}
                            className="shrink-0"
                        />
                    </div>
                </div>

                <div className="space-y-1">
                    <label className="text-sm font-medium t-secondary">{t("register.code")}</label>
                    <Input
                        value={code}
                        setValue={setCode}
                        placeholder={t("register.code_placeholder")}
                        disabled={isLoading}
                    />
                </div>

                <div className="space-y-1">
                    <label className="text-sm font-medium t-secondary">{t("register.username")}</label>
                    <Input
                        value={username}
                        setValue={setUsername}
                        placeholder={t("register.username_placeholder")}
                        disabled={isLoading}
                    />
                </div>

                <div className="space-y-1">
                    <label className="text-sm font-medium t-secondary">{t("register.password")}</label>
                    <Input
                        value={password}
                        setValue={setPassword}
                        placeholder={t("register.password_placeholder")}
                        type="password"
                        disabled={isLoading}
                    />
                </div>

                <div className="space-y-1">
                    <label className="text-sm font-medium t-secondary">{t("register.confirm_password")}</label>
                    <Input
                        value={confirmPassword}
                        setValue={setConfirmPassword}
                        placeholder={t("register.confirm_password_placeholder")}
                        type="password"
                        onSubmit={submit}
                        disabled={isLoading}
                    />
                </div>

                <div className="space-y-3 pt-1">
                    <ButtonWithLoading
                        title={isLoading ? t("register.loading") : t("register.submit")}
                        onClick={submit}
                        loading={isLoading}
                        className="w-full justify-center px-6 py-2.5 text-sm font-semibold"
                    />

                    <p className="text-center text-xs t-secondary">
                        {t("register.have_account")}
                        <button
                            type="button"
                            className="ml-1 rounded-full px-2 py-1 font-medium text-theme transition-colors hover:bg-theme/5 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-theme/30"
                            onClick={() => setLocation("/login")}
                        >
                            {t("register.back_to_login")}
                        </button>
                    </p>
                </div>
            </div>
        </div>
    );
}
