import "../../test/setup";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, mock } from "bun:test";

const listMock = mock(async (_params?: { page?: number; limit?: number; type?: string }) => ({
  data: {
    size: 2,
    hasNext: false,
    data: [
      {
        id: 1,
        title: "第一篇",
        summary: "摘要一",
        hashtags: [{ id: 9, name: "随笔" }],
        user: { avatar: null, id: 1, username: "admin" },
        avatar: null,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-02T00:00:00.000Z",
        pv: 0,
        uv: 0,
        sortOrder: 0,
        top: 0,
        draft: 0,
        listed: 1,
      },
      {
        id: 2,
        title: "第二篇",
        summary: "摘要二",
        hashtags: [],
        user: { avatar: null, id: 1, username: "admin" },
        avatar: null,
        createdAt: "2023-12-01T00:00:00.000Z",
        updatedAt: "2023-12-02T00:00:00.000Z",
        pv: 0,
        uv: 0,
        sortOrder: 0,
        top: 0,
        draft: 0,
        listed: 1,
      },
    ],
  },
}));

const setSortMock = mock(async (_id: number, _sortOrder: number) => ({ data: undefined }));
const deleteMock = mock(async (_id: number) => ({ data: undefined }));
const confirmMock = mock(async (
  _title: string,
  _message: string,
  onConfirm?: () => Promise<void> | void,
) => {
  await onConfirm?.();
});

mock.module("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number; date?: string }) =>
      options && typeof options.count === "number" ? `${key}:${options.count}` : key,
  }),
}));

mock.module("wouter", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

mock.module("../../app/runtime", () => ({
  client: {
    feed: {
      list: listMock,
      setSort: setSortMock,
      delete: deleteMock,
    },
  },
}));

mock.module("../../components/dialog", () => ({
  useAlert: () => ({ showAlert: mock(), alertUI: null }),
  useConfirm: () => ({ showConfirm: confirmMock, confirmUI: null }),
}));

mock.module("../../hooks/useSiteConfig", () => ({
  useSiteConfig: () => ({ name: "Rin" }),
}));

import { FeedsAdminPage } from "../feeds-admin";

describe("FeedsAdminPage", () => {
  afterEach(() => {
    cleanup();
    listMock.mockClear();
    setSortMock.mockClear();
    deleteMock.mockClear();
    confirmMock.mockClear();
  });

  it("lists published feeds and reloads with the selected tab", async () => {
    const { getByText } = render(<FeedsAdminPage />);

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledWith({ page: 1, limit: 20, type: "normal" });
    });
    expect(getByText("第一篇")).toBeTruthy();
    expect(getByText("第二篇")).toBeTruthy();

    fireEvent.click(getByText("feeds_admin.tabs.draft"));

    await waitFor(() => {
      expect(listMock).toHaveBeenLastCalledWith({ page: 1, limit: 20, type: "draft" });
    });
  });

  it("saves a custom sort number after expanding the sort editor", async () => {
    const { getAllByRole, getAllByText, getByText, queryAllByRole } = render(<FeedsAdminPage />);

    await waitFor(() => {
      expect(getByText("第一篇")).toBeTruthy();
    });

    expect(queryAllByRole("spinbutton")).toHaveLength(0);

    const user = userEvent.setup();
    fireEvent.click(getAllByText("sort_order")[0]!);

    await waitFor(() => {
      expect(getAllByRole("spinbutton")).toHaveLength(1);
    });

    const sortInput = getAllByRole("spinbutton")[0]!;
    await user.clear(sortInput);
    await user.type(sortInput, "7");
    const saveButton = getAllByText("feeds_admin.save_order")[0] as HTMLButtonElement;
    await waitFor(() => {
      expect(saveButton.disabled).toBe(false);
    });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(setSortMock).toHaveBeenCalledWith(1, 7);
    });
    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2);
    });
  });

  it("deletes a feed after confirmation and reloads the list", async () => {
    const { getAllByText, getByText } = render(<FeedsAdminPage />);

    await waitFor(() => {
      expect(getByText("第一篇")).toBeTruthy();
    });

    fireEvent.click(getAllByText("delete.title")[0]!);

    await waitFor(() => {
      expect(confirmMock).toHaveBeenCalledWith(
        "article.delete.title",
        "article.delete.confirm",
        expect.any(Function),
      );
      expect(deleteMock).toHaveBeenCalledWith(1);
    });

    await waitFor(() => {
      expect(listMock).toHaveBeenCalledTimes(2);
    });
  });
});
