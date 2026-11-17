import { t } from "i18next";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { ButtonWithLoading, Button } from "../components/button";
import { Icon } from "../components/icon";
import { Input } from "../components/input";
import { TurnstileWidget } from "../components/turnstile";
import { client, oauth_url } from "../app/runtime";
import { setAuthToken } from "../utils/auth";
import { getLoginRedirectPath } from "../utils/auth-redirect";

export function LoginPage() {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [authStatus, setAuthStatus] = useState<{ github: boolean; password: boolean; register: boolean; turnstile: boolean; turnstileSiteKey: string }>({ github: false, password: false, register: false, turnstile: false, turnstileSiteKey: '' });
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [captchaToken, setCaptchaToken] = useState('');
    const [captchaResetSignal, setCaptchaResetSignal] = useState(0);
    const [, setLocation] = useLocation();

    // Fetch auth status on mount
    useEffect(() => {
        client.auth.status().then(({ data }) => {
            if (data) {
                setAuthStatus({
                    github: Boolean(data.github),
                    password: Boolean(data.password),
                    register: Boolean(data.register),
                    turnstile: Boolean(data.turnstile),
                    turnstileSiteKey: data.turnstileSiteKey || '',
                });
            }
        });
    }, []);

    const handleLogin = async () => {
        if (!username || !password) {
            setError(t('login.error.empty'));
            return;
        }
        if (authStatus.turnstile && !captchaToken) {
            setError(t('login.error.captcha'));
            return;
        }

        setIsLoading(true);
        setError('');

        try {
            const { data, error: apiError } = await client.auth.login({
                username,
                password,
                turnstileToken: captchaToken || undefined,
            });

            if (apiError) {
                const message = String(apiError.value || '');
                if (authStatus.turnstile && message.toLowerCase().includes('verification')) {
                    setError(t('login.error.captcha_failed'));
                } else {
                    setError(t('login.error.invalid'));
                }
                setIsLoading(false);
                return;
            }

            if (data?.success) {
                // Save token to localStorage for cross-domain auth
                if (data.token) {
                    setAuthToken(data.token);
                }
                setLocation(getLoginRedirectPath(window.location.search));
                window.location.reload();
            } else {
                setError(t('login.error.failed'));
            }
        } catch (err) {
            setError(t('login.error.network'));
        } finally {
            setIsLoading(false);
            if (authStatus.turnstile) {
                // Turnstile token 一次性有效，任何提交尝试后都要重新出题。
                setCaptchaToken('');
                setCaptchaResetSignal((current) => current + 1);
            }
        }
    };

    return (
        <div className="flex items-center justify-center my-8">
            <div className="bg-w w-full max-w-md flex flex-col items-center justify-between p-8 space-y-4 t-primary rounded-2xl shadow-lg">
                <p className="text-2xl font-bold">{t('login.title')}</p>

                {/* Error message */}
                {error && (
                    <p className="text-sm text-red-500">{error}</p>
                )}

                {/* Password login form */}
                {authStatus.password && (
                    <>
                        <Input
                            value={username}
                            setValue={setUsername}
                            placeholder={t('login.username.placeholder')}
                            disabled={isLoading}
                            autofocus
                        />
                        <Input
                            value={password}
                            setValue={setPassword}
                            placeholder={t('login.password.placeholder')}
                            type="password"
                            onSubmit={handleLogin}
                            disabled={isLoading}
                        />
                        {authStatus.turnstile && authStatus.turnstileSiteKey && (
                            <TurnstileWidget
                                siteKey={authStatus.turnstileSiteKey}
                                resetSignal={captchaResetSignal}
                                onToken={setCaptchaToken}
                            />
                        )}
                        <div className="flex flex-row items-center space-x-4 pt-2">
                            <ButtonWithLoading
                                title={isLoading ? t("login.loading") : t("login.title")}
                                onClick={handleLogin}
                                loading={isLoading}
                            />
                        </div>
                        <button
                            type="button"
                            className="text-xs t-secondary transition-colors hover:text-theme"
                            onClick={() => setLocation('/forgot-password')}
                        >
                            {t('login.forgot_password')}
                        </button>
                    </>
                )}

                {/* OAuth options */}
                {authStatus.github && (
                    <div className="flex flex-col justify-center items-center space-y-2 pt-2">
                        {authStatus.password && <p className="text-xs t-secondary">{t('login.or')}</p>}
                        {!authStatus.password && <p className="text-xs t-secondary">{t('login.oauth_only')}</p>}
                        <div className="flex flex-row items-center space-x-4">
                            <Icon label={t('github_login')} name="ri-github-line" onClick={() => {
                                window.location.href = `${oauth_url}`
                            }} hover={true} />
                        </div>
                    </div>
                )}

                {/* Register entry */}
                {authStatus.register && (
                    <div className="flex flex-col items-center gap-2 border-t border-black/5 pt-3 dark:border-white/5">
                        <p className="text-xs t-secondary">{t('login.register_hint')}</p>
                        <Button
                            title={t('login.register')}
                            secondary
                            onClick={() => setLocation('/register')}
                        />
                    </div>
                )}

                {/* No auth methods available */}
                {!authStatus.github && !authStatus.password && (
                    <p className="text-sm text-red-500">{t('login.no_methods')}</p>
                )}
            </div>
        </div>
    );
}
