import { useContext, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Button, ButtonWithLoading } from "../components/button";
import { client } from "../app/runtime";
import { ImageUploadInput } from "../components/image-upload-input";
import { Input } from "../components/input";
import { ProfileContext } from "../state/profile";

/** 从接口错误里取可读信息；网络错误返回空字符串，交给页面统一文案兜底。 */
function readApiError(error: { value: string } | undefined): string {
    return error?.value || "";
}

export function ProfilePage() {
    const { t } = useTranslation();
    const profile = useContext(ProfileContext);
    const [, setLocation] = useLocation();
    const [username, setUsername] = useState('');
    const [avatar, setAvatar] = useState('');
    const [email, setEmail] = useState('');
    const [emailCode, setEmailCode] = useState('');
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordOpen, setPasswordOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [codeSending, setCodeSending] = useState(false);
    const [codeCooldown, setCodeCooldown] = useState(0);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const originalEmail = profile?.email || '';
    const emailChanged = email.trim().toLowerCase() !== originalEmail.toLowerCase();

    /** 验证码发送后的冷却倒计时；页面卸载时清理计时器。 */
    useEffect(() => {
        if (codeCooldown <= 0) {
            return;
        }
        const timer = window.setInterval(() => {
            setCodeCooldown((current) => Math.max(0, current - 1));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [codeCooldown]);

    // Load current profile data and redirect to login if not authenticated
    useEffect(() => {
        if (profile === undefined) {
            return;
        }
        if (profile === null) {
            setLocation('/login');
            return;
        }
        setUsername(profile.name || '');
        setAvatar(profile.avatar || '');
        setEmail(profile.email || '');
    }, [profile, setLocation]);

    const sendEmailCode = async () => {
        const nextEmail = email.trim().toLowerCase();
        if (!nextEmail) {
            setError(t('profile.error.empty_email'));
            return;
        }
        if (!emailChanged) {
            setError(t('profile.error.email_unchanged'));
            return;
        }

        setCodeSending(true);
        setError('');
        setSuccess('');
        try {
            const { data, error: apiError } = await client.user.sendEmailCode(nextEmail);
            if (apiError) {
                setError(readApiError(apiError) || t('profile.error.send_code_failed'));
                return;
            }
            setCodeCooldown(Number(data?.resendAfter) || 60);
            setSuccess(t('profile.email_code_sent'));
        } catch {
            setError(t('profile.error.network'));
        } finally {
            setCodeSending(false);
        }
    };

    const handleSubmit = async () => {
        if (!username.trim()) {
            setError(t('profile.error.empty_username'));
            return;
        }

        const nextPassword = newPassword.trim();
        if (nextPassword) {
            if (nextPassword.length < 8) {
                setError(t('profile.error.password_too_short'));
                return;
            }
            if (nextPassword !== confirmPassword.trim()) {
                setError(t('profile.error.password_mismatch'));
                return;
            }
            if (profile?.hasPassword && !currentPassword.trim()) {
                setError(t('profile.error.current_password_required'));
                return;
            }
        }

        if (emailChanged && !/^\d{6}$/.test(emailCode.trim())) {
            setError(t('profile.error.email_code_required'));
            return;
        }

        const payload = {
            username: username.trim(),
            avatar: avatar || null,
            ...(emailChanged ? { email: email.trim().toLowerCase(), emailCode: emailCode.trim() } : {}),
            ...(nextPassword ? {
                newPassword: nextPassword,
                ...(profile?.hasPassword ? { currentPassword: currentPassword.trim() } : {}),
            } : {}),
        };

        const hasChanges = Boolean(
            payload.username !== (profile?.name || '')
            || payload.avatar !== (profile?.avatar || null)
            || emailChanged
            || nextPassword,
        );

        if (!hasChanges) {
            setError(t('profile.error.no_changes'));
            return;
        }

        setIsLoading(true);
        setError('');
        setSuccess('');

        try {
            const { error: apiError } = await client.user.updateProfile(payload);

            if (apiError) {
                const message = readApiError(apiError);
                if (apiError.status === 403 && message.toLowerCase().includes("current password")) {
                    setError(t('profile.error.current_password_incorrect'));
                } else if (apiError.status === 409) {
                    setError(t('profile.error.conflict'));
                } else if (apiError.status === 429) {
                    setError(t('profile.error.rate_limited'));
                } else if (apiError.status === 400) {
                    setError(t('profile.error.invalid_input'));
                } else {
                    setError(message || t('profile.error.update_failed'));
                }
                return;
            }

            setSuccess(t('profile.success'));
            setTimeout(() => {
                window.location.reload();
            }, 1000);
        } catch {
            setError(t('profile.error.network'));
        } finally {
            setIsLoading(false);
        }
    };

    const emailHint = useMemo(() => {
        if (!emailChanged) {
            return t('profile.email_hint');
        }
        return t('profile.email_change_hint');
    }, [emailChanged, t]);

    if (profile === undefined) {
        return (
            <div className="py-8 px-4 my-32 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-theme"></div>
            </div>
        );
    }

    if (profile === null) {
        return null;
    }

    return (
        <div className="py-8 px-4 my-8">
            <div className="max-w-2xl mx-auto bg-w rounded-2xl shadow-lg p-8">
                <h1 className="text-2xl font-bold mb-8 t-primary">{t('profile.title')}</h1>

                {error && (
                    <p className="text-sm text-red-500 mb-4">{error}</p>
                )}
                {success && (
                    <p className="text-sm text-green-500 mb-4">{success}</p>
                )}

                <div className="space-y-7">
                    <div className="flex flex-col items-start space-y-4">
                        <label className="text-sm font-medium t-secondary">{t('profile.avatar')}</label>
                        <div className="w-full max-w-xl">
                            <ImageUploadInput
                                value={avatar}
                                onChange={(value) => {
                                    setError('');
                                    setAvatar(value);
                                }}
                                onError={setError}
                                disabled={isLoading}
                                shape="circle"
                                maxFileSize={2 * 1024 * 1024}
                                placeholder={t('upload.image.url_placeholder')}
                            />
                        </div>
                        <p className="text-left text-xs t-secondary">{t('profile.avatar_hint')}</p>
                    </div>

                    <div className="grid gap-5 sm:grid-cols-2">
                        <div className="space-y-2">
                            <label className="text-sm font-medium t-secondary">{t('profile.username')}</label>
                            <Input
                                value={username}
                                setValue={setUsername}
                                placeholder={t('profile.username_placeholder')}
                                disabled={isLoading}
                            />
                        </div>

                        <div className="space-y-2 sm:col-span-2">
                            <label className="text-sm font-medium t-secondary">{t('profile.email')}</label>
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                <div className="min-w-0 flex-1">
                                    <Input
                                        value={email}
                                        setValue={(value) => {
                                            setError('');
                                            setEmail(value);
                                        }}
                                        placeholder={t('profile.email_placeholder')}
                                        type="email"
                                        disabled={isLoading}
                                    />
                                </div>
                                <Button
                                    title={codeSending
                                        ? t('profile.sending_code')
                                        : codeCooldown > 0
                                            ? t('profile.resend_code$seconds', { seconds: codeCooldown })
                                            : t('profile.send_code')}
                                    secondary
                                    disabled={isLoading || codeSending || codeCooldown > 0 || !emailChanged}
                                    onClick={sendEmailCode}
                                    className="shrink-0"
                                />
                            </div>
                            <p className="text-xs t-secondary">{emailHint}</p>
                        </div>

                        {emailChanged && (
                            <div className="space-y-2 sm:col-span-2">
                                <label className="text-sm font-medium t-secondary">{t('profile.email_code')}</label>
                                <Input
                                    value={emailCode}
                                    setValue={setEmailCode}
                                    placeholder={t('profile.email_code_placeholder')}
                                    disabled={isLoading}
                                />
                            </div>
                        )}
                    </div>

                    <div className="border-t border-black/5 pt-6 dark:border-white/5">
                        <div className="flex items-center justify-between gap-4">
                            <div>
                                <p className="text-sm font-medium t-primary">{t('profile.password')}</p>
                                <p className="mt-1 text-xs t-secondary">{t('profile.password_hint')}</p>
                            </div>
                            <Button
                                title={passwordOpen ? t('profile.collapse_password') : t('profile.change_password')}
                                secondary
                                onClick={() => {
                                    setPasswordOpen((current) => !current);
                                }}
                                disabled={isLoading}
                            />
                        </div>

                        {passwordOpen && (
                            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                {profile.hasPassword && (
                                    <div className="space-y-2 sm:col-span-2">
                                        <label className="text-sm font-medium t-secondary">{t('profile.current_password')}</label>
                                        <Input
                                            value={currentPassword}
                                            setValue={setCurrentPassword}
                                            placeholder={t('profile.current_password_placeholder')}
                                            type="password"
                                            disabled={isLoading}
                                        />
                                    </div>
                                )}
                                <div className="space-y-2">
                                    <label className="text-sm font-medium t-secondary">{t('profile.new_password')}</label>
                                    <Input
                                        value={newPassword}
                                        setValue={setNewPassword}
                                        placeholder={t('profile.new_password_placeholder')}
                                        type="password"
                                        disabled={isLoading}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-sm font-medium t-secondary">{t('profile.confirm_password')}</label>
                                    <Input
                                        value={confirmPassword}
                                        setValue={setConfirmPassword}
                                        placeholder={t('profile.confirm_password_placeholder')}
                                        type="password"
                                        disabled={isLoading}
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="pt-2">
                        <ButtonWithLoading
                            title={isLoading ? t('profile.saving') : t('profile.save')}
                            onClick={handleSubmit}
                            loading={isLoading}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
