import i18n from 'i18next';
import _ from 'lodash';
import {useCallback, useEffect, useRef, useState} from "react";
import {Helmet} from "react-helmet";
import {useTranslation} from "react-i18next";
import Loading from 'react-loading';
import {ShowAlertType, useAlert, useConfirm} from '../components/dialog';
import {Checkbox, Input} from "../components/input";
import { DateTimeInput, FlatMetaRow, FlatPanel } from "@rin/ui";
import { FeedAttachment } from "@rin/api";
import { client } from "../app/runtime";
import {Cache} from '../utils/cache';
import {useSiteConfig} from "../hooks/useSiteConfig";
import {siteName} from "../utils/constants";
import { formatFileSize } from "../utils/format-file-size";
import mermaid from 'mermaid';
import { MarkdownEditor } from '../components/markdown_editor';

// 与服务端 MAX_FEED_ATTACHMENT_MB 保持一致：
// 99 MB 是给 Cloudflare Workers 100 MB 请求体上限预留 multipart 开销后的安全值。
const MAX_FEED_ATTACHMENT_MB = 99;
const MAX_FEED_ATTACHMENT_SIZE = MAX_FEED_ATTACHMENT_MB * 1024 * 1024;
const MAX_FEED_ATTACHMENTS = 20;

async function publish({
  title,
  alias,
  listed,
  content,
  summary,
  tags,
  draft,
  createdAt,
  password,
  onCompleted,
  showAlert
}: {
  title: string;
  listed: boolean;
  content: string;
  summary: string;
  tags: string[];
  draft: boolean;
  alias?: string;
  createdAt?: Date;
  password?: string;
  onCompleted?: () => void;
  showAlert: ShowAlertType;
}) {
  const t = i18n.t
  const { data, error } = await client.feed.create(
    {
      title,
      alias,
      content,
      summary,
      tags,
      listed,
      draft,
      createdAt: createdAt?.toISOString(),
      password,
    }
  );
  if (onCompleted) {
    onCompleted();
  }
  if (error) {
    showAlert(error.value as string);
  }
  if (data) {
    showAlert(t("publish.success"), () => {
      Cache.with().clear();
      window.location.href = "/feed/" + data.insertedId;
    });
  }
}

async function update({
  id,
  title,
  alias,
  content,
  summary,
  tags,
  listed,
  draft,
  createdAt,
  passwordEnabled,
  password,
  onCompleted,
  showAlert
}: {
  id: number;
  listed: boolean;
  title?: string;
  alias?: string;
  content?: string;
  summary?: string;
  tags?: string[];
  draft?: boolean;
  createdAt?: Date;
  passwordEnabled?: boolean;
  password?: string;
  onCompleted?: () => void;
  showAlert: ShowAlertType;
}) {
  const t = i18n.t
  const { error } = await client.feed.update(
    id,
    {
      title,
      alias,
      content,
      summary,
      tags,
      listed,
      draft,
      createdAt: createdAt?.toISOString(),
      passwordEnabled,
      password,
    }
  );
  if (onCompleted) {
    onCompleted();
  }
  if (error) {
    showAlert(error.value as string);
  } else {
    showAlert(t("update.success"), () => {
      Cache.with(id).clear();
      window.location.href = "/feed/" + id;
    });
  }
}

// 写作页面
export function WritingPage({ id }: { id?: number }) {
  const { t } = useTranslation();
  const siteConfig = useSiteConfig();
  const cache = Cache.with(id);
  const [title, setTitle] = cache.useCache("title", "");
  const [summary, setSummary] = cache.useCache("summary", "");
  const [tags, setTags] = cache.useCache("tags", "");
  const [alias, setAlias] = cache.useCache("alias", "");
  const [draft, setDraft] = useState(false);
  const [listed, setListed] = useState(true);
  // 密码相关状态不写入本地缓存，避免明文密码残留在浏览器 localStorage。
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordProtected, setPasswordProtected] = useState(false);
  const [content, setContent] = cache.useCache("content", "");
  const [createdAt, setCreatedAt] = useState<Date | undefined>(new Date());
  const [publishing, setPublishing] = useState(false)
  // 附件只属于已有文章：新建文章发布后再进入编辑页上传，避免临时文件跨请求残留。
  const [attachments, setAttachments] = useState<FeedAttachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<number | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const { showAlert, alertUI } = useAlert()
  const { showConfirm, confirmUI } = useConfirm()
  function attachmentErrorMessage(message: string, action: "upload" | "delete" = "upload") {
    if (message.includes("too large")) {
      return t("feed_attachment.too_large", { size: MAX_FEED_ATTACHMENT_MB });
    }
    if (message.includes("Too many")) {
      return t("feed_attachment.too_many", { count: MAX_FEED_ATTACHMENTS });
    }
    if (message.includes("Unauthorized")) {
      return t("login.required");
    }
    if (message.includes("S3_") || message.includes("Failed to upload to S3")) {
      return t("feed_attachment.storage_unavailable");
    }
    // 存储或网络异常时不要把内部错误原文暴露给用户，统一给出可重试的中文提示。
    return action === "delete"
      ? t("feed_attachment.delete_failed")
      : t("feed_attachment.upload_failed");
  }

  async function uploadAttachments(files: FileList | null) {
    if (!id || uploadingAttachment || !files || files.length === 0) {
      return;
    }

    setUploadingAttachment(true);
    try {
      for (const file of Array.from(files)) {
        // 客户端先挡一次，避免把明显超限的文件传到 Worker 才报错。
        if (file.size > MAX_FEED_ATTACHMENT_SIZE) {
          showAlert(t("feed_attachment.too_large", { size: MAX_FEED_ATTACHMENT_MB }));
          break;
        }

        const { data, error } = await client.feed.uploadAttachment(id, file);
        if (error) {
          showAlert(attachmentErrorMessage(error.value as string));
          break;
        }
        if (data?.attachment) {
          setAttachments((current) => [...current, data.attachment]);
        }
      }
    } finally {
      setUploadingAttachment(false);
      // 清空 input，允许用户再次选择同名文件。
      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = "";
      }
    }
  }

  function deleteAttachment(attachment: FeedAttachment) {
    if (!id || deletingAttachmentId !== null) {
      return;
    }

    showConfirm(
      t("feed_attachment.delete"),
      t("feed_attachment.delete_confirm", { name: attachment.fileName }),
      async () => {
        setDeletingAttachmentId(attachment.id);
        try {
          const { error } = await client.feed.deleteAttachment(id, attachment.id);
          if (error) {
            showAlert(attachmentErrorMessage(error.value as string, "delete"));
            return;
          }
          setAttachments((current) => current.filter((item) => item.id !== attachment.id));
        } finally {
          setDeletingAttachmentId(null);
        }
      },
    );
  }

  function publishButton() {
    if (publishing) return;
    const tagsplit =
      tags
        .split("#")
        .filter((tag) => tag !== "")
        .map((tag) => tag.trim()) || [];
    // 新开启密码保护时必须填写密码；编辑已有受保护文章时留空表示沿用原密码。
    if (passwordEnabled && !password.trim() && !passwordProtected) {
      showAlert(t("writing_password.required"));
      return;
    }
    if (id !== undefined) {
      setPublishing(true)
      update({
        id,
        title,
        content,
        summary,
        alias,
        tags: tagsplit,
        draft,
        listed,
        createdAt,
        passwordEnabled,
        password: passwordEnabled && password.trim() ? password.trim() : undefined,
        onCompleted: () => {
          setPublishing(false)
        },
        showAlert
      });
    } else {
      if (!title) {
        showAlert(t("title_empty"))
        return;
      }
      if (!content) {
        showAlert(t("content.empty"))
        return;
      }
      setPublishing(true)
      publish({
        title,
        content,
        summary,
        tags: tagsplit,
        draft,
        alias,
        listed,
        createdAt,
        password: passwordEnabled ? password.trim() : undefined,
        onCompleted: () => {
          setPublishing(false)
        },
        showAlert
      });
    }
  }

  useEffect(() => {
    if (id) {
      client.feed
        .get(id)
        .then(({ data }) => {
          if (data) {
            if (title == "" && data.title) setTitle(data.title);
            if (tags == "" && Array.isArray(data.hashtags))
              setTags(data.hashtags.map(({ name }: {name: string}) => `#${name}`).join(" "));
            if (alias == "" && (data as any).alias) setAlias((data as any).alias);
            if (content == "") setContent(data.content);
            if (summary == "") setSummary((data as any).summary || "");
            setListed((data as any).listed === 1);
            setDraft((data as any).draft === 1);
            // 受保护文章只回显“已启用”，不回显密码明文；输入框留空即沿用原密码。
            // 切换文章时清空上一次输入的密码，避免误把旧密码写到另一篇文章。
            setPassword("");
            setPasswordProtected(Boolean((data as any).passwordProtected));
            setPasswordEnabled(Boolean((data as any).passwordProtected));
            setAttachments(Array.isArray((data as any).attachments) ? (data as any).attachments : []);
            setCreatedAt(new Date(data.createdAt));
          }
        });
    } else {
      setAttachments([]);
    }
  }, []);
  const debouncedUpdate = useCallback(
    _.debounce(() => {
      mermaid.initialize({
        startOnLoad: false,
        theme: "default",
      });
      mermaid.run({
        suppressErrors: true,
        nodes: document.querySelectorAll("pre.mermaid_default")
      }).then(()=>{
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
        });
        mermaid.run({
          suppressErrors: true,
          nodes: document.querySelectorAll("pre.mermaid_dark")
        });
      })
    }, 100),
    []
  );
  useEffect(() => {
    debouncedUpdate();
  }, [content, debouncedUpdate]);
  function PublishButton({ className }: { className?: string }) {
    return (
      <button
        onClick={publishButton}
        className={`inline-flex items-center justify-center gap-2 rounded-xl bg-theme px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-theme-hover active:bg-theme-active disabled:cursor-not-allowed disabled:opacity-60 ${className ?? ""}`}
        disabled={publishing}
      >
        {publishing && <Loading type="spin" height={16} width={16} />}
        <span>{t('publish.title')}</span>
      </button>
    );
  }

  function MetaInput({ className }: { className?: string }) {
    return (
        <FlatPanel className={className}>
          <div className="flex flex-row gap-4 border-b border-black/5 pb-5 dark:border-white/5 items-start justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-theme/70">{t('writing')}</p>
              <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
                {id !== undefined ? t("update.title") : t("publish.title")}
              </p>
            </div>
            <PublishButton className="w-auto" />
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <div className="lg:col-span-2">
              <Input
                id={id}
                value={title}
                setValue={setTitle}
                placeholder={t("title")}
                variant="flat"
                className="text-base"
              />
            </div>
            <Input
              id={id}
              value={summary}
              setValue={setSummary}
              placeholder={t("summary")}
              variant="flat"
            />
            <Input
              id={id}
              value={alias}
              setValue={setAlias}
              placeholder={t("alias")}
              variant="flat"
            />
            <Input
              id={id}
              value={tags}
              setValue={setTags}
              placeholder={t("tags")}
              variant="flat"
              className="lg:col-span-2"
            />
          </div>

          <div className="mt-5 grid gap-2 sm:gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(18rem,2fr)]">
            <FlatMetaRow
              className="cursor-pointer rounded-none border-0 bg-transparent px-0 py-2 sm:rounded-2xl sm:border sm:bg-secondary sm:px-4 sm:py-3"
              onClick={() => setDraft(!draft)}
            >
              <p>{t('visible.self_only')}</p>
              <Checkbox
                id="draft"
                value={draft}
                setValue={setDraft}
                placeholder={t('draft')}
              />
            </FlatMetaRow>
            <FlatMetaRow
              className="cursor-pointer rounded-none border-0 bg-transparent px-0 py-2 sm:rounded-2xl sm:border sm:bg-secondary sm:px-4 sm:py-3"
              onClick={() => setListed(!listed)}
            >
              <p>{t('listed')}</p>
              <Checkbox
                id="listed"
                value={listed}
                setValue={setListed}
                placeholder={t('listed')}
              />
            </FlatMetaRow>
            <FlatMetaRow className="gap-3 rounded-none border-0 bg-transparent px-0 py-2 sm:rounded-2xl sm:border sm:bg-secondary sm:px-4 sm:py-3 xl:col-span-1">
              <p className="mr-2 whitespace-nowrap">
                {t('created_at')}
              </p>
              <DateTimeInput value={createdAt} onChange={setCreatedAt} className="w-full max-w-[16rem]" />
            </FlatMetaRow>
          </div>

          <div className="mt-3 rounded-2xl border border-black/5 bg-secondary/70 px-4 py-3 dark:border-white/10">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium t-primary">
                  <i className="ri-lock-line text-theme" aria-hidden="true" />
                  {t('writing_password.enable')}
                </p>
                <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                  {t('writing_password.desc')}
                </p>
              </div>
              <Checkbox
                id="feed-password"
                value={passwordEnabled}
                setValue={setPasswordEnabled}
                placeholder={t('writing_password.enable')}
              />
            </div>
            {passwordEnabled && (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="w-full sm:max-w-sm">
                  <Input
                    id={id}
                    type="password"
                    value={password}
                    setValue={setPassword}
                    placeholder={t('writing_password.placeholder')}
                    variant="flat"
                  />
                </div>
                <p className="text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                  {passwordProtected
                    ? t('writing_password.keep_hint')
                    : t('writing_password.new_hint')}
                </p>
              </div>
            )}
          </div>

          {/* 附件管理：仅已有文章 ID 时显示上传入口；新建文章先发布再编辑上传。 */}
          <div className="mt-3 rounded-2xl border border-black/5 bg-secondary/70 px-4 py-3 dark:border-white/10">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium t-primary">
                  <i className="ri-attachment-2 text-theme" aria-hidden="true" />
                  {t('feed_attachment.title')}
                  {attachments.length > 0 && (
                    <span className="rounded-full bg-theme/10 px-2 py-0.5 text-[11px] font-normal text-theme">
                      {attachments.length}
                    </span>
                  )}
                </p>
                <p className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                  {t('feed_attachment.writing_desc')}
                </p>
              </div>
              {id !== undefined && (
                <>
                  <input
                    ref={attachmentInputRef}
                    id="feed-attachment-input"
                    type="file"
                    multiple
                    aria-label={t('feed_attachment.upload')}
                    className="hidden"
                    onChange={(event) => uploadAttachments(event.currentTarget.files)}
                  />
                  <button
                    type="button"
                    onClick={() => attachmentInputRef.current?.click()}
                    disabled={uploadingAttachment}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-theme/25 bg-theme/5 px-3 py-1.5 text-xs font-medium text-theme transition-colors hover:bg-theme/10 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {uploadingAttachment
                      ? <i className="ri-loader-4-line animate-spin" aria-hidden="true" />
                      : <i className="ri-add-line" aria-hidden="true" />}
                    {uploadingAttachment ? t('feed_attachment.uploading') : t('feed_attachment.upload')}
                  </button>
                </>
              )}
            </div>

            {id === undefined ? (
              <p className="mt-3 rounded-xl border border-dashed border-black/10 px-3 py-2 text-xs text-neutral-500 dark:border-white/10 dark:text-neutral-400">
                {t('feed_attachment.save_first')}
              </p>
            ) : attachments.length === 0 ? (
              <p className="mt-3 text-xs text-neutral-500 dark:text-neutral-400">
                {t('feed_attachment.empty')}
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-black/5 overflow-hidden rounded-xl border border-black/5 dark:divide-white/5 dark:border-white/10">
                {attachments.map((attachment) => (
                  <li key={attachment.id} className="flex items-center gap-3 bg-w/40 px-3 py-2">
                    <i className="ri-file-line shrink-0 text-base text-neutral-400" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm t-primary" title={attachment.fileName}>
                        {attachment.fileName}
                      </p>
                      <p className="text-[11px] text-neutral-500 dark:text-neutral-400">
                        {formatFileSize(attachment.size)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteAttachment(attachment)}
                      disabled={deletingAttachmentId !== null}
                      aria-label={t('feed_attachment.delete')}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-red-900/20"
                    >
                      {deletingAttachmentId === attachment.id
                        ? <i className="ri-loader-4-line animate-spin" aria-hidden="true" />
                        : <i className="ri-delete-bin-line" aria-hidden="true" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </FlatPanel>
    )
  }

  return (
    <>
      <Helmet>
        <title>{`${t('writing')} - ${siteConfig.name}`}</title>
        <meta property="og:site_name" content={siteName} />
        <meta property="og:title" content={t('writing')} />
        <meta property="og:image" content={siteConfig.avatar} />
        <meta property="og:type" content="article" />
        <meta property="og:url" content={document.URL} />
      </Helmet>
      <div className="mt-2 flex flex-col gap-4 t-primary sm:gap-6">
        {MetaInput({ className: "p-4 sm:p-5 md:p-6" })}

        <FlatPanel className="overflow-hidden p-0">
          <MarkdownEditor content={content} setContent={setContent} height='680px' />
        </FlatPanel>
      </div>
      {alertUI}
      {confirmUI}
    </>
  );
}
