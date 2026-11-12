import type { FeedListResponse } from "@rin/api";
import { Button, FlatPanel, FlatTabButton, Input, Spinner } from "@rin/ui";
import { useCallback, useState } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { client } from "../app/runtime";
import { useAlert, useConfirm } from "../components/dialog";
import { ImageWithFallback } from "../components/image-with-fallback";
import { useApiResource } from "../hooks/use-api-resource";
import { useSiteConfig } from "../hooks/useSiteConfig";

type FeedType = "normal" | "draft" | "unlisted";

const TAB_TYPES: FeedType[] = ["normal", "draft", "unlisted"];
const PAGE_SIZE = 20;

type FeedListItem = FeedListResponse["data"][number];
type ShowAlert = (message: string) => void;

function FeedStatusBadges({ feed }: { feed: FeedListItem }) {
  const { t } = useTranslation();
  const badges: string[] = [];
  if (feed.draft === 1) badges.push(t("draft"));
  if (feed.draft !== 1 && feed.listed === 0) badges.push(t("unlisted"));
  if ((feed.top ?? 0) > 0) badges.push(t("top.title"));
  // 密码保护标记放在状态角标中，方便管理员快速识别需要密码的文章。
  if (feed.passwordProtected) badges.push(t("feed_password.protected"));

  return (
    <>
      {badges.map((badge) => (
        <span
          key={badge}
          className="rounded-full border border-black/10 bg-secondary px-2 py-0.5 text-xs text-neutral-500 dark:border-white/10 dark:text-neutral-400"
        >
          {badge}
        </span>
      ))}
    </>
  );
}

function FeedListRow({
  feed,
  showAlert,
  onSaved,
  onDelete,
}: {
  feed: FeedListItem;
  showAlert: ShowAlert;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const initialSort = feed.sortOrder ?? 0;
  const [sortValue, setSortValue] = useState(String(initialSort));
  const [sortOpen, setSortOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const trimmed = sortValue.trim();
  const parsed = Number.parseInt(trimmed, 10);
  const valid = /^\d+$/.test(trimmed) && Number.isFinite(parsed);
  const currentSort = valid ? parsed : initialSort;
  const dirty = valid && parsed !== initialSort;
  const sortStatus = dirty
    ? t("feeds_admin.sort_unsaved")
    : initialSort === 0
      ? t("feeds_admin.sort_auto")
      : `#${initialSort}`;
  const title = feed.title || t("feeds_admin.untitled");
  const createdAt = new Date(feed.createdAt).toLocaleString();
  const updatedAt = new Date(feed.updatedAt).toLocaleString();

  function stepSort(delta: number) {
    setSortValue(String(Math.max(0, currentSort + delta)));
  }

  function toggleSortEditor() {
    if (sortOpen) {
      closeSortEditor();
      return;
    }
    setSortValue(String(initialSort));
    setSortOpen(true);
  }

  function closeSortEditor() {
    setSortValue(String(initialSort));
    setSortOpen(false);
  }

  async function saveSortOrder() {
    if (!valid) {
      showAlert(t("feeds_admin.sort_invalid"));
      return;
    }
    if (!dirty) return;

    setSaving(true);
    try {
      const response = await client.feed.setSort(feed.id, parsed);
      if (response.error) {
        showAlert(response.error.value || t("feeds_admin.save_failed"));
        return;
      }
      closeSortEditor();
      onSaved();
    } catch {
      showAlert(t("feeds_admin.save_failed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-3 transition-colors hover:bg-secondary/10">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {feed.avatar ? (
            <ImageWithFallback
              src={feed.avatar}
              alt={title}
              className="h-14 w-20 shrink-0 rounded-lg border border-black/10 dark:border-white/10 sm:h-16 sm:w-24"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/admin/writing/${feed.id}`}
                className="break-words text-base font-semibold t-primary hover:text-theme [overflow-wrap:anywhere]"
              >
                {title}
              </Link>
              <FeedStatusBadges feed={feed} />
            </div>
            {feed.summary ? (
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                {feed.summary}
              </p>
            ) : null}
            <p className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              {t("created_at")} {createdAt} · {t("feeds_admin.updated_at", { date: updatedAt })}
            </p>
            {feed.hashtags.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-2">
                {feed.hashtags.map((hashtag) => (
                  <span key={hashtag.id} className="text-xs text-neutral-500 dark:text-neutral-400">
                    #{hashtag.name}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <button
            type="button"
            title={t("feeds_admin.sort_hint")}
            aria-expanded={sortOpen}
            aria-controls={sortOpen ? `sort-editor-${feed.id}` : undefined}
            onClick={toggleSortEditor}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-black/10 bg-secondary px-3 text-sm t-primary transition-colors hover:border-theme/40 dark:border-white/10"
          >
            <i className="ri-arrow-up-down-line" aria-hidden="true" />
            <span>{t("sort_order")}</span>
            <span
              className={`rounded-full bg-w px-1.5 py-0.5 text-[11px] tabular-nums ${
                dirty
                  ? "text-amber-600 dark:text-amber-300"
                  : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              {sortStatus}
            </span>
            <i
              className={`ri-arrow-down-s-line text-sm transition-transform ${sortOpen ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>
          <Link
            href={`/admin/writing/${feed.id}`}
            className="inline-flex h-9 items-center justify-center rounded-full border border-black/10 bg-secondary px-3 text-sm t-primary transition-colors hover:border-theme/40 dark:border-white/10"
          >
            {t("edit")}
          </Link>
          <Link
            href={`/feed/${feed.id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center justify-center rounded-full border border-black/10 bg-secondary px-3 text-sm t-primary transition-colors hover:border-theme/40 dark:border-white/10"
          >
            {t("feeds_admin.view")}
          </Link>
          <button
            type="button"
            onClick={onDelete}
            className="inline-flex h-9 items-center gap-1 rounded-full border border-rose-200 px-3 text-sm text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/40"
          >
            <i className="ri-delete-bin-line" aria-hidden="true" />
            {t("delete.title")}
          </button>
        </div>
      </div>

      {sortOpen ? (
        <div
          id={`sort-editor-${feed.id}`}
          className="mt-3 rounded-2xl border border-black/10 bg-secondary p-2.5 dark:border-white/10"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium t-primary">{t("sort_order")}</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label={t("feeds_admin.decrease_sort")}
                  title={t("feeds_admin.decrease_sort")}
                  disabled={saving || currentSort <= 0}
                  onClick={() => stepSort(-1)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-black/10 bg-w text-base leading-none t-primary transition-colors hover:border-theme/40 hover:text-theme disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10"
                >
                  −
                </button>
                <Input
                  value={sortValue}
                  setValue={setSortValue}
                  placeholder="0"
                  type="number"
                  disabled={saving}
                  onSubmit={() => void saveSortOrder()}
                  className="!h-9 !w-16 min-w-0 !px-2 !py-0 text-center text-sm tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  aria-label={t("feeds_admin.increase_sort")}
                  title={t("feeds_admin.increase_sort")}
                  disabled={saving}
                  onClick={() => stepSort(1)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-black/10 bg-w text-base leading-none t-primary transition-colors hover:border-theme/40 hover:text-theme disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10"
                >
                  ＋
                </button>
              </div>
              <span
                className={`text-[11px] tabular-nums ${
                  dirty
                    ? "text-amber-600 dark:text-amber-300"
                    : "text-neutral-500 dark:text-neutral-400"
                }`}
              >
                {sortStatus}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                secondary
                title={t("cancel")}
                disabled={saving}
                onClick={closeSortEditor}
                className="!h-9 !px-3 !py-0 text-xs"
              />
              <Button
                title={saving ? t("saving") : t("feeds_admin.save_order")}
                disabled={saving || !valid || !dirty}
                onClick={() => void saveSortOrder()}
                className="!h-9 !px-3 !py-0 text-xs"
              />
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-4 text-neutral-500 dark:text-neutral-400">
            {t("feeds_admin.sort_hint")}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function FeedsAdminPage() {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();
  const [tab, setTab] = useState<FeedType>("normal");
  const [page, setPage] = useState(1);
  const { showAlert, alertUI } = useAlert();
  const { showConfirm, confirmUI } = useConfirm();

  const loadFeeds = useCallback(
    () => client.feed.list({ page, limit: PAGE_SIZE, type: tab }),
    [page, tab],
  );
  const { data, loading, error, reload } = useApiResource<FeedListResponse>(loadFeeds);

  const feeds = data?.data ?? [];
  const total = data?.size ?? 0;
  const hasNext = data?.hasNext ?? false;

  function switchTab(nextTab: FeedType) {
    if (nextTab === tab) return;
    setTab(nextTab);
    setPage(1);
  }

  function deleteFeed(feed: FeedListItem) {
    showConfirm(
      t("article.delete.title"),
      t("article.delete.confirm"),
      async () => {
        const response = await client.feed.delete(feed.id);
        if (response.error) {
          showAlert(t("delete.failed$message", { message: response.error.value || "" }));
          return;
        }
        showAlert(t("delete.success"));
        if (feeds.length === 1 && page > 1) {
          setPage(page - 1);
          return;
        }
        await reload();
      },
    );
  }

  const content = (() => {
    if (loading && feeds.length === 0) {
      return (
        <div className="flex justify-center px-4 py-12">
          <Spinner />
        </div>
      );
    }

    if (error) {
      return (
        <div className="flex flex-col items-start gap-3 px-4 py-8">
          <p className="text-sm text-rose-600 dark:text-rose-300">{error}</p>
          <Button title={t("reload")} onClick={() => void reload()} />
        </div>
      );
    }

    if (feeds.length === 0) {
      return <p className="px-4 py-12 text-center text-sm text-neutral-500 dark:text-neutral-400">{t("feeds_admin.empty")}</p>;
    }

    return (
      <div className="divide-y divide-black/5 dark:divide-white/5">
        {feeds.map((feed) => (
          <FeedListRow
            key={`${feed.id}-${feed.sortOrder ?? 0}`}
            feed={feed}
            showAlert={showAlert}
            onSaved={() => void reload()}
            onDelete={() => deleteFeed(feed)}
          />
        ))}
      </div>
    );
  })();

  return (
    <div className="flex w-full flex-col gap-4">
      <Helmet>
        <title>{`${t("feeds_admin.title")} - ${siteConfig.name}`}</title>
      </Helmet>

      {alertUI}
      {confirmUI}

      <FlatPanel className="flex flex-col gap-3 p-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1">
          {TAB_TYPES.map((type) => (
            <FlatTabButton
              key={type}
              active={tab === type}
              type="button"
              onClick={() => switchTab(type)}
            >
              {t(`feeds_admin.tabs.${type}`)}
            </FlatTabButton>
          ))}
          <span className="ml-1 rounded-full bg-secondary px-2 py-1 text-[11px] text-neutral-500 dark:text-neutral-400">
            {t("feeds_admin.total", { count: total })}
          </span>
        </div>
        <Link
          href="/admin/writing"
          className="rounded-full bg-theme px-4 py-2 text-center text-sm text-white transition-colors hover:bg-theme-hover active:bg-theme-active"
        >
          {t("feeds_admin.new_article")}
        </Link>
      </FlatPanel>

      <FlatPanel className="overflow-hidden">{content}</FlatPanel>

      {feeds.length > 0 ? (
        <div className="flex flex-wrap items-center justify-end gap-3 px-1">
          <div className="flex items-center gap-2">
            <Button
              secondary
              title={t("previous")}
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            />
            <span className="text-xs text-neutral-500 dark:text-neutral-400">{page}</span>
            <Button
              secondary
              title={t("next")}
              disabled={!hasNext || loading}
              onClick={() => setPage((current) => current + 1)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
