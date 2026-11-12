import { useEffect, useState } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import { Modal } from "@rin/ui";
import { Button } from "../components/button";
import { Checkbox, Input } from "../components/input";
import { ImageWithFallback } from "../components/image-with-fallback";
import { client } from "../app/runtime";
import { useSiteConfig } from "../hooks/useSiteConfig";
import type { AdminUserSummary } from "@rin/api";

type AdminUserDraft = {
    username: string;
    email: string;
    avatar: string;
    newPassword: string;
    permission: boolean;
};

function formatDate(value: string | Date | null | undefined): string {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString();
}

function toDraft(user: AdminUserSummary): AdminUserDraft {
    return {
        username: user.username,
        email: user.email || "",
        avatar: user.avatar || "",
        newPassword: "",
        permission: user.permission,
    };
}

/** 后台用户列表：查看注册用户，并允许管理员编辑资料、角色和重置密码。 */
function UsersAdminPage() {
    const { t } = useTranslation();
    const siteConfig = useSiteConfig();
    const [items, setItems] = useState<AdminUserSummary[]>([]);
    const [page, setPage] = useState(1);
    const [searchInput, setSearchInput] = useState("");
    const [search, setSearch] = useState("");
    const [hasNext, setHasNext] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [editing, setEditing] = useState<AdminUserSummary | null>(null);
    const [draft, setDraft] = useState<AdminUserDraft | null>(null);
    const [saveError, setSaveError] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError("");

        client.user.adminList({ page, limit: 20, search }).then(({ data, error: apiError }) => {
            if (cancelled) return;
            if (apiError) {
                setError(apiError.value || t("admin_users.error"));
                setItems([]);
                setHasNext(false);
                return;
            }
            setItems(data?.data || []);
            setHasNext(Boolean(data?.hasNext));
        }).catch(() => {
            if (!cancelled) {
                setError(t("admin_users.error"));
            }
        }).finally(() => {
            if (!cancelled) {
                setLoading(false);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [page, search, t]);

    const submitSearch = () => {
        setPage(1);
        setSearch(searchInput.trim());
    };

    const openEditor = (user: AdminUserSummary) => {
        setEditing(user);
        setDraft(toDraft(user));
        setSaveError("");
    };

    const closeEditor = () => {
        if (saving) return;
        setEditing(null);
        setDraft(null);
        setSaveError("");
    };

    const updateDraft = (patch: Partial<AdminUserDraft>) => {
        setDraft((current) => current ? { ...current, ...patch } : current);
    };

    const setPermission = (value: boolean | ((current: boolean) => boolean)) => {
        setDraft((current) => {
            if (!current) return current;
            return {
                ...current,
                permission: typeof value === "function" ? value(current.permission) : value,
            };
        });
    };

    const describeSaveError = (status: number, message: string) => {
        if (message.toLowerCase().includes("own permission")) {
            return t("admin_users.form.self_permission_error");
        }
        if (status === 401 || status === 403) {
            return t("admin_users.errors.unauthorized");
        }
        if (status === 409) {
            return t("admin_users.errors.conflict");
        }
        if (status === 404) {
            return t("admin_users.errors.not_found");
        }
        if (status === 400) {
            return t("admin_users.errors.invalid");
        }
        return t("admin_users.save_error");
    };

    const saveUser = async () => {
        if (!editing || !draft || saving) return;

        const username = draft.username.trim();
        const email = draft.email.trim();
        const avatar = draft.avatar.trim();
        const hasChanges = username !== editing.username
            || email !== (editing.email || "")
            || avatar !== (editing.avatar || "")
            || draft.permission !== editing.permission
            || draft.newPassword.length > 0;

        if (!hasChanges) {
            closeEditor();
            return;
        }

        setSaving(true);
        setSaveError("");

        const body = {
            username,
            email: email || null,
            avatar: avatar || null,
            permission: draft.permission,
            ...(draft.newPassword ? { newPassword: draft.newPassword } : {}),
        };

        try {
            const { data, error: apiError } = await client.user.adminUpdate(editing.id, body);
            if (apiError) {
                setSaveError(describeSaveError(apiError.status, apiError.value));
                return;
            }
            const updatedUser = data?.user;
            if (updatedUser) {
                setItems((current) => current.map((item) => item.id === updatedUser.id ? updatedUser : item));
            }
            setEditing(null);
            setDraft(null);
        } catch {
            setSaveError(t("admin_users.save_error"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <Helmet>
                <title>{`${t("admin_users.title")} - ${siteConfig.name}`}</title>
            </Helmet>
            <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-80">
                <Input
                    value={searchInput}
                    setValue={setSearchInput}
                    placeholder={t("admin_users.search_placeholder")}
                    onSubmit={submitSearch}
                />
                <Button
                    title={t("admin_users.search")}
                    secondary
                    onClick={submitSearch}
                    className="shrink-0"
                />
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            {loading && (
                <p className="py-10 text-center text-sm t-secondary">{t("admin_users.loading")}</p>
            )}

            {!loading && !error && items.length === 0 && (
                <p className="py-10 text-center text-sm t-secondary">{t("admin_users.empty")}</p>
            )}

            {!loading && items.length > 0 && (
                <div className="overflow-hidden rounded-2xl border border-black/5 bg-w dark:border-white/5">
                    <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,2.2fr)_0.8fr_1fr_0.7fr] gap-4 border-b border-black/5 px-4 py-3 text-xs font-medium t-secondary sm:grid dark:border-white/5">
                        <span>{t("admin_users.columns.user")}</span>
                        <span>{t("admin_users.columns.email")}</span>
                        <span>{t("admin_users.columns.role")}</span>
                        <span>{t("admin_users.columns.created")}</span>
                        <span className="text-right">{t("admin_users.columns.actions")}</span>
                    </div>

                    {items.map((user) => (
                        <div
                            key={user.id}
                            className="grid gap-3 border-b border-black/5 px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,2fr)_minmax(0,2.2fr)_0.8fr_1fr_0.7fr] sm:items-center dark:border-white/5"
                        >
                            <div className="flex min-w-0 items-center gap-3">
                                <ImageWithFallback
                                    src={user.avatar}
                                    alt={user.username}
                                    className="h-9 w-9 shrink-0 rounded-full"
                                />
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium t-primary">{user.username}</p>
                                    <p className="text-xs t-secondary">#{user.id}</p>
                                </div>
                            </div>

                            <div className="min-w-0">
                                <p className="truncate text-sm t-primary">{user.email || t("admin_users.unbound_email")}</p>
                                <p className="text-xs t-secondary">
                                    {user.email
                                        ? (user.emailVerified ? t("admin_users.verified") : t("admin_users.unverified"))
                                        : t("admin_users.no_email")}
                                </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded-full px-2 py-0.5 text-xs ${user.permission ? "bg-theme/10 text-theme" : "bg-black/5 t-secondary dark:bg-white/10"}`}>
                                    {user.permission ? t("admin_users.admin") : t("admin_users.user")}
                                </span>
                                <span className="text-xs t-secondary">
                                    {user.hasPassword ? t("admin_users.has_password") : t("admin_users.no_password")}
                                </span>
                            </div>

                            <div className="text-xs t-secondary">
                                <p>{formatDate(user.createdAt)}</p>
                                <p className="mt-0.5">{t("admin_users.updated_at")}: {formatDate(user.updatedAt)}</p>
                            </div>

                            <div className="flex justify-start sm:justify-end">
                                <Button
                                    title={t("admin_users.edit")}
                                    secondary
                                    onClick={() => openEditor(user)}
                                    className="shrink-0"
                                />
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex items-center justify-between pt-1">
                <p className="text-xs t-secondary">{t("admin_users.page", { page })}</p>
                <div className="flex items-center gap-2">
                    <Button
                        title={t("admin_users.previous")}
                        secondary
                        disabled={loading || page <= 1}
                        onClick={() => setPage((current) => Math.max(1, current - 1))}
                    />
                    <Button
                        title={t("admin_users.next")}
                        secondary
                        disabled={loading || !hasNext}
                        onClick={() => setPage((current) => current + 1)}
                    />
                </div>
            </div>

            <Modal
                isOpen={Boolean(editing && draft)}
                onRequestClose={closeEditor}
                contentLabel={t("admin_users.edit_title")}
                size="md"
                position="center"
                panelClassName="p-0"
            >
                {editing && draft && (
                    <>
                        <div className="flex items-start justify-between gap-4 border-b border-black/5 px-5 py-4 dark:border-white/5">
                            <div className="flex min-w-0 items-center gap-3">
                                <ImageWithFallback
                                    src={draft.avatar}
                                    alt={draft.username}
                                    className="h-10 w-10 rounded-full"
                                />
                                <div className="min-w-0">
                                    <h2 className="truncate text-base font-semibold t-primary">{t("admin_users.edit_title")}</h2>
                                    <p className="mt-0.5 truncate text-xs t-secondary">
                                        #{editing.id} · {t("admin_users.created_at")}: {formatDate(editing.createdAt)}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                aria-label={t("cancel")}
                                title={t("cancel")}
                                disabled={saving}
                                onClick={closeEditor}
                                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg t-secondary transition-colors hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
                            >
                                <i className="ri-close-line text-lg" />
                            </button>
                        </div>

                        <div className="space-y-4 px-5 py-4">
                            <div className="grid gap-3 min-[560px]:grid-cols-2">
                                <div className="min-w-0">
                                    <p className="mb-1 text-xs font-medium t-secondary">{t("admin_users.form.username")}</p>
                                    <Input
                                        value={draft.username}
                                        setValue={(value) => updateDraft({ username: value })}
                                        placeholder={t("admin_users.form.username_placeholder")}
                                    />
                                </div>
                                <div className="min-w-0">
                                    <p className="mb-1 text-xs font-medium t-secondary">{t("admin_users.form.email")}</p>
                                    <Input
                                        value={draft.email}
                                        setValue={(value) => updateDraft({ email: value })}
                                        placeholder={t("admin_users.form.email_placeholder")}
                                        type="email"
                                    />
                                    <p className="mt-1 text-[11px] leading-4 t-secondary">{t("admin_users.form.email_hint")}</p>
                                </div>
                            </div>

                            <div className="grid gap-3 min-[560px]:grid-cols-2">
                                <div className="min-w-0">
                                    <p className="mb-1 text-xs font-medium t-secondary">{t("admin_users.form.avatar")}</p>
                                    <Input
                                        value={draft.avatar}
                                        setValue={(value) => updateDraft({ avatar: value })}
                                        placeholder={t("admin_users.form.avatar_placeholder")}
                                    />
                                    <p className="mt-1 text-[11px] leading-4 t-secondary">{t("admin_users.form.avatar_hint")}</p>
                                </div>
                                <div className="min-w-0">
                                    <p className="mb-1 text-xs font-medium t-secondary">{t("admin_users.form.password")}</p>
                                    <Input
                                        value={draft.newPassword}
                                        setValue={(value) => updateDraft({ newPassword: value })}
                                        placeholder={t("admin_users.form.password_placeholder")}
                                        type="password"
                                    />
                                    <p className="mt-1 text-[11px] leading-4 t-secondary">
                                        {editing.hasPassword
                                            ? t("admin_users.form.password_hint_existing")
                                            : t("admin_users.form.password_hint_new")}
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-center justify-between gap-4 rounded-xl bg-secondary px-4 py-3">
                                <div className="min-w-0">
                                    <p className="text-sm font-medium t-primary">{t("admin_users.form.admin_role")}</p>
                                    <p className="mt-0.5 text-[11px] leading-4 t-secondary">{t("admin_users.form.admin_role_hint")}</p>
                                </div>
                                <Checkbox
                                    id={`admin-user-role-${editing.id}`}
                                    value={draft.permission}
                                    setValue={setPermission}
                                    placeholder={t("admin_users.form.admin_role")}
                                />
                            </div>

                            {saveError && (
                                <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
                                    {saveError}
                                </p>
                            )}
                        </div>

                        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-black/5 bg-w px-5 py-3 dark:border-white/5">
                            <Button
                                title={t("cancel")}
                                secondary
                                disabled={saving}
                                onClick={closeEditor}
                            />
                            <Button
                                title={saving ? t("admin_users.saving") : t("save")}
                                disabled={saving}
                                onClick={saveUser}
                            />
                        </div>
                    </>
                )}
            </Modal>
        </div>
    );
}

export { UsersAdminPage };
