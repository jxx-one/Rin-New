import type { Feed, FeedAttachment } from "@rin/api";
import { Modal } from "@rin/ui";
import { useContext, useEffect, useRef, useState } from "react";
import { Helmet } from "react-helmet";
import { useTranslation } from "react-i18next";
import Popup from "reactjs-popup";
import { Link, useLocation } from "wouter";
import { useAlert, useConfirm } from "../components/dialog";
import { Input } from "../components/input";
import { HashTag } from "../components/hashtag";
import { ImageWithFallback } from "../components/image-with-fallback";
import { Waiting } from "../components/loading";
import { Markdown } from "../components/markdown";
import { client } from "../app/runtime";
import { ClientConfigContext } from "../state/config";
import { ProfileContext } from "../state/profile";
import { useSiteConfig } from "../hooks/useSiteConfig";
import { siteName } from "../utils/constants";
import { timeago } from "../utils/timeago";
import { downloadFeedAttachment } from "../utils/download-attachment";
import { formatFileSize } from "../utils/format-file-size";
import { Button } from "../components/button";
import { Tips } from "../components/tips";
import mermaid from "mermaid";
import { AdjacentSection } from "../components/adjacent_feed.tsx";
import { stripImageUrlMetadata } from "../utils/image-upload";

function extractFirstMarkdownImageUrl(content: string) {
  const match = /!\[.*?\]\((\S+?)(?:\s+"[^"]*")?\)/.exec(content);
  if (!match) {
    return undefined;
  }

  return stripImageUrlMetadata(match[1]);
}

export function FeedPage({ id, TOC, clean }: { id: string, TOC: () => JSX.Element, clean: (id: string) => void }) {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();
  const profile = useContext(ProfileContext);
  const [feed, setFeed] = useState<Feed>();
  const [error, setError] = useState<string>();
  const [headImage, setHeadImage] = useState<string>();
  // 密码验证只在当前页面内存中保存，不写入缓存或 localStorage。
  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  // 附件下载状态只保存在当前页面，下载凭证同样只留在内存中。
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<number | null>(null);
  const ref = useRef("");
  const [, setLocation] = useLocation();
  const { showAlert, alertUI } = useAlert();
  const { showConfirm, confirmUI } = useConfirm();
  const [top, setTop] = useState<number>(0);
  const config = useContext(ClientConfigContext);
  const counterEnabled = config.getBoolean('counter.enabled');
  const hasAISummary = Boolean(feed?.ai_summary?.trim());
  const showAISummaryState = feed?.ai_summary_status === "pending" || feed?.ai_summary_status === "processing" || feed?.ai_summary_status === "failed";
  const hashtags = Array.isArray(feed?.hashtags) ? feed.hashtags : [];

  async function unlockFeed() {
    if (!feed || unlocking) return;
    const password = passwordInput.trim();
    if (!password) {
      setPasswordError(t("feed_password.empty"));
      return;
    }

    setUnlocking(true);
    setPasswordError("");
    const { data, error } = await client.feed.unlock(feed.id, password);
    setUnlocking(false);

    if (error) {
      if (error.status === 401) {
        setPasswordError(t("feed_password.invalid"));
      } else if (error.status === 403) {
        setPasswordError(t("feed_password.forbidden"));
      } else {
        setPasswordError(error.value || t("feed_password.failed"));
      }
      return;
    }

    if (data) {
      setFeed((current) => current ? { ...current, ...data, locked: false } : current);
      setPasswordInput("");
    }
  }

  async function downloadAttachment(attachment: FeedAttachment) {
    if (!feed || downloadingAttachmentId !== null) {
      return;
    }

    setDownloadingAttachmentId(attachment.id);
    try {
      // 作者/管理员靠登录态免密；游客靠 unlockFeed 返回的短期 token。
      const failure = await downloadFeedAttachment(feed.id, attachment, feed.downloadToken);
      if (failure) {
        showAlert(t("feed_attachment.download_failed"));
      }
    } finally {
      setDownloadingAttachmentId(null);
    }
  }

  function deleteFeed() {
    // Confirm
    showConfirm(
      t("article.delete.title"),
      t("article.delete.confirm"),
      () => {
        if (!feed) return;
        client.feed
          .delete(feed.id)
          .then(({ error }) => {
            if (error) {
              showAlert(error.value as string);
            } else {
              showAlert(t("delete.success"));
              setLocation("/");
            }
          });
      })
  }
  function topFeed() {
    const isUnTop = !(top > 0)
    const topNew = isUnTop ? 1 : 0;
    // Confirm
    showConfirm(
      isUnTop ? t("article.top.title") : t("article.untop.title"),
      isUnTop ? t("article.top.confirm") : t("article.untop.confirm"),
      () => {
        if (!feed) return;
        client.feed
          .setTop(feed.id, topNew)
          .then(({ error }) => {
            if (error) {
              showAlert(error.value as string);
            } else {
              showAlert(isUnTop ? t("article.top.success") : t("article.untop.success"));
              setTop(topNew);
            }
          });
      })
  }
  useEffect(() => {
    if (ref.current == id) return;
    setFeed(undefined);
    setError(undefined);
    setHeadImage(undefined);
    setPasswordInput("");
    setPasswordError("");
    setUnlocking(false);
    client.feed
      .get(id)
      .then(({ data, error }) => {
        if (error) {
          setError(error.value as string);
        } else if (data && typeof data !== "string") {
          setTimeout(() => {
            setFeed(data as any);
            setTop(data.top || 0);
            const headImageUrl = extractFirstMarkdownImageUrl(data.content);
            if (headImageUrl) {
              setHeadImage(headImageUrl);
            }
            clean(id);
          }, 0);
        }
      });
    ref.current = id;
  }, [id]);
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: "default",
    });
    mermaid.run({
      suppressErrors: true,
      nodes: document.querySelectorAll("pre.mermaid_default")
    }).then(() => {
      mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
      });
      mermaid.run({
        suppressErrors: true,
        nodes: document.querySelectorAll("pre.mermaid_dark")
      });
    })
  }, [feed]);

  return (
    <Waiting for={feed || error}>
      {feed && (
        <Helmet>
          <title>{`${feed.title ?? "Unnamed"} - ${siteConfig.name}`}</title>
          <meta property="og:site_name" content={siteName} />
          <meta property="og:title" content={feed.title ?? ""} />
          <meta property="og:image" content={headImage ?? siteConfig.avatar} />
          <meta property="og:type" content="article" />
          <meta property="og:url" content={document.URL} />
          <meta
            name="og:description"
            content={
              feed.content.length > 200
                ? feed.content.substring(0, 200)
                : feed.content
            }
          />
          <meta name="author" content={feed.user.username} />
          <meta
            name="keywords"
            content={hashtags.map(({ name }) => name).join(", ")}
          />
          <meta
            name="description"
            content={
              feed.content.length > 200
                ? feed.content.substring(0, 200)
                : feed.content
            }
          />
        </Helmet>
      )}
      <div className="w-full flex flex-row justify-center ani-show">
        {error && (
          <>
            <div className="flex flex-col wauto rounded-2xl bg-w m-2 p-6 items-center justify-center space-y-2">
              <h1 className="text-xl font-bold t-primary">{error}</h1>
              {error === "Not found" && id === "about" && (
                <Tips value={t("about.notfound")} />
              )}
              <Button
                title={t("index.back")}
                onClick={() => (window.location.href = "/")}
              />
            </div>
          </>
        )}
        {feed && !error && (
          <>
            <div className="xl:w-64" />
            <main className="wauto">
              <article
                className="rounded-2xl bg-w m-2 px-6 py-4"
                aria-label={feed.title ?? "Unnamed"}
              >
                <div className="flex justify-between">
                  <div>
                    <div className="mt-1 mb-1 flex gap-1">
                      <p
                        className="text-gray-400 text-[12px]"
                        title={new Date(feed.createdAt).toLocaleString()}
                      >
                        {t("feed_card.published$time", {
                          time: timeago(feed.createdAt),
                        })}
                      </p>

                      {feed.createdAt !== feed.updatedAt && (
                        <p
                          className="text-gray-400 text-[12px]"
                          title={new Date(feed.updatedAt).toLocaleString()}
                        >
                          {t("feed_card.updated$time", {
                            time: timeago(feed.updatedAt),
                          })}
                        </p>
                      )}
                    </div>
                    {counterEnabled && <p className='text-[12px] text-gray-400 font-normal link-line'>
                      <span> {t("count.pv")} </span>
                      <span>
                        {feed.pv}
                      </span>
                      <span> |</span>
                      <span> {t("count.uv")} </span>
                      <span>
                        {feed.uv}
                      </span>
                    </p>}
                    <div className="flex flex-row items-center">
                      <h1 className="text-2xl font-bold t-primary break-all">
                        {feed.title}
                      </h1>
                      <div className="flex-1 w-0" />
                    </div>
                  </div>
                  <div className="pt-2">
                    {profile?.permission && (
                      <div className="flex gap-2">
                        <button
                          aria-label={top > 0 ? t("untop.title") : t("top.title")}
                          onClick={topFeed}
                          className={`flex-1 flex flex-col items-end justify-center px-2 py rounded-full transition ${top > 0 ? "bg-theme text-white hover:bg-theme-hover active:bg-theme-active" : "bg-secondary bg-button dark:text-neutral-400"}`}
                        >
                          <i className="ri-skip-up-line" />
                        </button>
                        <Link
                          aria-label={t("edit")}
                          href={`/admin/writing/${feed.id}`}
                          className="flex-1 flex flex-col items-end justify-center px-2 py bg-secondary bg-button rounded-full transition"
                        >
                          <i className="ri-edit-2-line dark:text-neutral-400" />
                        </Link>
                        <button
                          aria-label={t("delete.title")}
                          onClick={deleteFeed}
                          className="flex-1 flex flex-col items-end justify-center px-2 py bg-secondary bg-button rounded-full transition"
                        >
                          <i className="ri-delete-bin-7-line text-red-500" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                {feed.locked ? (
                  <div className="my-6 overflow-hidden rounded-3xl border border-theme/20 bg-secondary/70 p-5 sm:p-7">
                    <div className="mx-auto flex max-w-md flex-col items-center text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-theme/20 bg-theme/10 text-theme">
                        <i className="ri-lock-2-line text-xl" aria-hidden="true" />
                      </div>
                      <h2 className="mt-4 text-lg font-semibold t-primary">{t("feed_password.title")}</h2>
                      <p className="mt-1 text-sm leading-6 text-neutral-500 dark:text-neutral-400">
                        {t("feed_password.desc")}
                      </p>
                      <div className="mt-4 flex w-full flex-col gap-2 sm:flex-row">
                        <div className="min-w-0 flex-1">
                          <Input
                            autofocus
                            type="password"
                            value={passwordInput}
                            setValue={setPasswordInput}
                            placeholder={t("feed_password.placeholder")}
                            onSubmit={unlockFeed}
                            disabled={unlocking}
                            className="border-theme/30 focus:ring-theme/20"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={unlockFeed}
                          disabled={unlocking || !passwordInput.trim()}
                          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-theme px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-theme-hover active:bg-theme-active disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {unlocking && <i className="ri-loader-4-line animate-spin" aria-hidden="true" />}
                          <span>{t("feed_password.submit")}</span>
                        </button>
                      </div>
                      {passwordError && (
                        <p className="mt-3 text-sm text-rose-600 dark:text-rose-300" role="alert">
                          {passwordError}
                        </p>
                      )}
                      {Boolean(feed.attachmentCount) && (
                        <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-theme/10 px-3 py-1 text-xs text-theme">
                          <i className="ri-attachment-2" aria-hidden="true" />
                          {t("feed_attachment.locked_hint", { count: feed.attachmentCount })}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    {(hasAISummary || showAISummaryState) && (
                      <div className="my-4 p-4 rounded-xl bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-900/20 dark:to-blue-900/20 border border-purple-100 dark:border-purple-800/30">
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2">
                            <i className="ri-sparkling-2-fill text-purple-500" />
                            <span className="text-sm font-medium text-purple-600 dark:text-purple-400">
                              {t('ai_summary.title')}
                            </span>
                          </div>
                          {showAISummaryState ? (
                            <span className="rounded-full bg-white/70 px-2 py-1 text-xs font-medium text-purple-700 dark:bg-white/10 dark:text-purple-300">
                              {t(`ai_summary.status.${feed.ai_summary_status}`)}
                            </span>
                          ) : null}
                        </div>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed t-secondary [overflow-wrap:anywhere]">
                          {hasAISummary ? feed.ai_summary : t(`ai_summary.message.${feed.ai_summary_status}`)}
                        </p>
                        {feed.ai_summary_status === "failed" && feed.ai_summary_error ? (
                          <p className="mt-2 whitespace-pre-wrap text-xs text-rose-600 dark:text-rose-300 [overflow-wrap:anywhere]">
                            {feed.ai_summary_error}
                          </p>
                        ) : null}
                      </div>
                    )}
                    <Markdown content={feed.content} />
                    {Array.isArray(feed.attachments) && feed.attachments.length > 0 && (
                      <div className="mt-6 overflow-hidden rounded-2xl border border-black/5 bg-secondary/60 dark:border-white/10">
                        <div className="flex items-center justify-between gap-3 border-b border-black/5 px-4 py-3 dark:border-white/10">
                          <p className="flex items-center gap-2 text-sm font-medium t-primary">
                            <i className="ri-attachment-2 text-theme" aria-hidden="true" />
                            {t("feed_attachment.title")}
                          </p>
                          <span className="text-xs text-neutral-500 dark:text-neutral-400">
                            {t("feed_attachment.count", { count: feed.attachments.length })}
                          </span>
                        </div>
                        <ul className="divide-y divide-black/5 dark:divide-white/5">
                          {feed.attachments.map((attachment) => (
                            <li key={attachment.id} className="flex items-center gap-3 px-4 py-3">
                              <i className="ri-file-line shrink-0 text-lg text-neutral-400" aria-hidden="true" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm t-primary" title={attachment.fileName}>
                                  {attachment.fileName}
                                </p>
                                <p className="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                                  {formatFileSize(attachment.size)}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => downloadAttachment(attachment)}
                                disabled={downloadingAttachmentId !== null}
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-theme/25 bg-theme/5 px-3 py-1.5 text-xs font-medium text-theme transition-colors hover:bg-theme/10 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {downloadingAttachmentId === attachment.id
                                  ? <i className="ri-loader-4-line animate-spin" aria-hidden="true" />
                                  : <i className="ri-download-2-line" aria-hidden="true" />}
                                {t("feed_attachment.download")}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                )}
                <div className="mt-6 flex flex-col gap-2">
                  {hashtags.length > 0 && (
                    <div className="flex flex-row flex-wrap gap-x-2">
                      {hashtags.map(({ name }, index) => (
                        <HashTag key={index} name={name} />
                      ))}
                    </div>
                  )}
                  <div className="flex min-w-0 flex-row items-center">
                    <ImageWithFallback
                      src={feed.user.avatar || "/avatar.png"}
                      alt={feed.user.username}
                      className="h-8 w-8 rounded-full"
                    />
                    <div className="ml-2 min-w-0">
                      <span className="block truncate text-sm text-gray-400 cursor-default">
                        {feed.user.username}
                      </span>
                    </div>
                  </div>
                </div>
              </article>
              {id !== "about" && <AdjacentSection id={id} setError={setError} />}
              {feed && !feed.locked && <Comments id={`${feed.id}`} />}
              <div className="h-16" />
            </main>
            <div className="w-80 hidden lg:block relative">
              <div
                className={`start-0 end-0 top-[5.5rem] sticky`}
              >
                <TOC />
              </div>
            </div>
          </>
        )}
      </div>
      {alertUI}
      {confirmUI}
    </Waiting>
  );
}

export function TOCHeader({ TOC }: { TOC: () => JSX.Element }) {
  const [isOpened, setIsOpened] = useState(false);

  return (
    <div className="shrink-0 lg:hidden">
      <button
        onClick={() => setIsOpened(true)}
        className="w-10 h-10 rounded-full flex flex-row items-center justify-center"
      >
        <i className="ri-menu-2-line text-neutral-500 transition-colors hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100 ri-lg md:ri-sm md:t-secondary"></i>
      </button>
      <Modal
        isOpen={isOpened}
        onRequestClose={() => setIsOpened(false)}
        contentLabel="Table of contents"
        size="lg"
        panelClassName="p-4"
      >
        <div className="relative max-h-[75vh] overflow-auto t-primary">
          <TOC />
        </div>
      </Modal>
    </div>
  );
}

function CommentInput({
  id,
  onRefresh,
}: {
  id: string;
  onRefresh: () => void;
}) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestWebsite, setGuestWebsite] = useState("");
  const [error, setError] = useState("");
  const { showAlert, alertUI } = useAlert();
  const profile = useContext(ProfileContext);
  const [, setLocation] = useLocation();
  const config = useContext(ClientConfigContext);
  // guest comments enabled by default; admin can disable via client config `comment.guest.enabled=false`
  const rawGuest = config.get('comment.guest.enabled');
  const guestEnabled = rawGuest !== false && rawGuest !== 'false';
  function errorHumanize(error: string) {
    if (error === "Unauthorized") return t("login.required");
    else if (error === "Content is required") return t("comment.empty");
    else if (error === "Guest name is required") return t("comment.guest_name_required");
    return error;
  }
  function submit() {
    if (profile) {
      client.comment
        .create(parseInt(id), { content })
        .then(({ error }) => {
          if (error) {
            setError(errorHumanize(error.value as string));
          } else {
            setContent("");
            setError("");
            showAlert(t("comment.success"), () => {
              onRefresh();
            });
          }
        });
    } else if (guestEnabled) {
      if (!guestName.trim()) {
        setError(t("comment.guest_name_required"));
        return;
      }
      client.comment
        .create(parseInt(id), {
          content,
          guestName: guestName.trim(),
          guestEmail: guestEmail.trim() || undefined,
          guestWebsite: guestWebsite.trim() || undefined,
        })
        .then(({ error }) => {
          if (error) {
            setError(errorHumanize(error.value as string));
          } else {
            setContent("");
            setGuestName("");
            setGuestEmail("");
            setGuestWebsite("");
            setError("");
            showAlert(t("comment.success"), () => {
              onRefresh();
            });
          }
        });
    } else {
      setLocation('/login');
    }
  }
  return (
    <div className="w-full rounded-2xl bg-w t-primary p-6 items-end flex flex-col">
      <div className="flex flex-col w-full items-start mb-4">
        <label htmlFor="comment">{t("comment.title")}</label>
      </div>
      {profile ? (<>
        <textarea
          id="comment"
          placeholder={t("comment.placeholder.title")}
          className="bg-w w-full h-24 rounded-lg"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <button
          className="mt-4 bg-theme text-white px-4 py-2 rounded-full"
          onClick={submit}
        >
          {t("comment.submit")}
        </button>
      </>) : guestEnabled ? (<>
        <div className="grid w-full grid-cols-1 gap-2 mb-2 sm:grid-cols-3">
          <input
            type="text"
            required
            aria-label={t("comment.guest_name_placeholder")}
            autoComplete="nickname"
            placeholder={t("comment.guest_name_placeholder")}
            className="bg-w w-full min-w-0 rounded-lg px-3 py-2 border border-gray-200 dark:border-gray-700"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
          />
          <input
            type="email"
            aria-label={t("comment.guest_email_placeholder")}
            autoComplete="email"
            placeholder={t("comment.guest_email_placeholder")}
            className="bg-w w-full min-w-0 rounded-lg px-3 py-2 border border-gray-200 dark:border-gray-700"
            value={guestEmail}
            onChange={(e) => setGuestEmail(e.target.value)}
          />
          <input
            type="url"
            aria-label={t("comment.guest_website_placeholder")}
            autoComplete="url"
            placeholder={t("comment.guest_website_placeholder")}
            className="bg-w w-full min-w-0 rounded-lg px-3 py-2 border border-gray-200 dark:border-gray-700"
            value={guestWebsite}
            onChange={(e) => setGuestWebsite(e.target.value)}
          />
        </div>
        <textarea
          id="comment"
          placeholder={t("comment.placeholder.title")}
          className="bg-w w-full h-24 rounded-lg"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <button
          className="mt-4 bg-theme text-white px-4 py-2 rounded-full"
          onClick={submit}
        >
          {t("comment.submit")}
        </button>
      </>) : (
        <div className="flex flex-row w-full items-center justify-center space-x-2 py-12">
          <button
            className="mt-2 bg-theme text-white px-4 py-2 rounded-full"
            onClick={() => setLocation('/login')}
          >
            {t("login.required")}
          </button>
        </div>
      )}
      {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
      {alertUI}
    </div>
  );
}

type Comment = {
  id: number;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  user?: {
    id: number;
    username: string;
    avatar: string | null;
    permission: number | null;
  } | null;
  guestName?: string;
  guestEmail?: string;
  guestWebsite?: string;
};

function Comments({ id }: { id: string }) {
  const config = useContext(ClientConfigContext);
  const [comments, setComments] = useState<Comment[]>([]);
  const [error, setError] = useState<string>();
  const ref = useRef("");
  const { t } = useTranslation();

  function loadComments() {
    client.comment
      .list(parseInt(id))
      .then(({ data, error }) => {
        if (error) {
          setError(error.value as string);
        } else if (data && Array.isArray(data)) {
          setComments(data as any);
        }
      });
  }
  useEffect(() => {
    if (ref.current == id) return;
    loadComments();
    ref.current = id;
  }, [id]);
  return (
    <>
      {config.getBoolean('comment.enabled') &&
        <div className="m-2 flex flex-col justify-center items-center">
          <CommentInput id={id} onRefresh={loadComments} />
          {error && (
            <>
              <div className="flex flex-col wauto rounded-2xl bg-w t-primary m-2 p-6 items-center justify-center">
                <h1 className="text-xl font-bold t-primary">{error}</h1>
                <button
                  className="mt-2 bg-theme text-white px-4 py-2 rounded-full"
                  onClick={loadComments}
                >
                  {t("reload")}
                </button>
              </div>
            </>
          )}
          {comments.length > 0 && (
            <div className="w-full">
              {comments.map((comment) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  onRefresh={loadComments}
                />
              ))}
            </div>
          )}
        </div>
      }
    </>
  );
}

function CommentItem({
  comment,
  onRefresh,
}: {
  comment: Comment;
  onRefresh: () => void;
}) {
  const { showConfirm, confirmUI } = useConfirm();
  const { showAlert, alertUI } = useAlert();
  const { t } = useTranslation();
  const profile = useContext(ProfileContext);
  const commenterName = comment.user?.username || comment.guestName || t("anonymous");
  const commenterAvatar = comment.user?.avatar || "/avatar.png";
  function deleteComment() {
    showConfirm(
      t("delete.comment.title"),
      t("delete.comment.confirm"),
      async () => {
        client.comment
          .delete(comment.id)
          .then(({ error }) => {
            if (error) {
              showAlert(error.value as string);
            } else {
              showAlert(t("delete.success"), () => {
                onRefresh();
              });
            }
          });
      })
  }
  return (
    <div className="flex flex-row items-start rounded-xl mt-2">
      <ImageWithFallback
        src={commenterAvatar}
        alt={commenterName}
        className="mt-4 h-8 w-8 rounded-full"
      />
      <div className="flex flex-col flex-1 w-0 ml-2 bg-w rounded-xl p-4">
        <div className="flex min-w-0 flex-row items-center gap-2">
          <span className="min-w-0 truncate text-base font-bold t-primary">
            {commenterName}
          </span>
          {comment.guestWebsite && (
            <a
              href={comment.guestWebsite}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-gray-400 transition-colors hover:text-theme"
            >
              <i className="ri-external-link-line"></i>
            </a>
          )}
          <div className="flex-1 w-0" />
          <span
            title={new Date(comment.createdAt).toLocaleString()}
            className="shrink-0 text-sm text-gray-400"
          >
            {timeago(comment.createdAt)}
          </span>
        </div>
        <p className="break-words t-primary [overflow-wrap:anywhere]">{comment.content}</p>
        <div className="flex flex-row justify-end">
          {(profile?.permission || (comment.user && profile?.id == comment.user.id)) && (
            <Popup
              arrow={false}
              trigger={
                <button className="px-2 py bg-secondary rounded-full">
                  <i className="ri-more-fill t-secondary"></i>
                </button>
              }
              position="left center"
            >
              <div className="flex flex-row self-end mr-2">
                <button
                  onClick={deleteComment}
                  aria-label={t("delete.comment.title")}
                  className="px-2 py bg-secondary rounded-full"
                >
                  <i className="ri-delete-bin-2-line t-secondary"></i>
                </button>
              </div>
            </Popup>
          )}
        </div>
      </div>
      {confirmUI}
      {alertUI}
    </div>
  );
}
