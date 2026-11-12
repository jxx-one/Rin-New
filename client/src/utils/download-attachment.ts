import { client } from "../app/runtime";
import type { FeedAttachment } from "@rin/api";

/**
 * 通过后端鉴权接口下载附件。
 * 不用直接 window.open：附件接口可能返回 401（下载凭证过期），
 * 这里可以先把错误交给调用方展示，而不是把用户带到错误页面。
 */
export async function downloadFeedAttachment(
  feedId: number,
  attachment: FeedAttachment,
  token?: string,
): Promise<string | null> {
  const { data, error } = await client.feed.downloadAttachment(feedId, attachment.id, token);

  if (error || !data) {
    return error?.value || "Download failed";
  }

  const objectUrl = URL.createObjectURL(data);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = attachment.fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // 给浏览器留出读取 Blob 的时间后再释放 URL。
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  return null;
}
