import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { FeedService } from '../feed';
import { Hono } from "hono";
import type { Variables } from "../../core/hono-types";
import { setupTestApp, createTestUser, cleanupTestDB } from '../../../tests/fixtures';
import type { Database } from 'bun:sqlite';
import type { TestCacheImpl } from '../../../tests/fixtures';

describe('FeedService', () => {
    let db: any;
    let sqlite: Database;
    let env: Env;
    let app: Hono<{ Bindings: Env; Variables: Variables }>;
    let cache: TestCacheImpl;
    let serverConfig: TestCacheImpl;
    let clientConfig: TestCacheImpl;

    beforeEach(async () => {
        const ctx = await setupTestApp(FeedService);
        db = ctx.db;
        sqlite = ctx.sqlite;
        env = ctx.env;
        app = ctx.app;
        cache = ctx.cache;
        serverConfig = ctx.serverConfig;
        clientConfig = ctx.clientConfig;
        
        // Create test user
        await createTestUser(sqlite);
    });

    afterEach(() => {
        cleanupTestDB(sqlite);
    });



    describe('GET / - List feeds', () => {
        it('should list published feeds', async () => {
            // Create feeds via API
            const res1 = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Test Feed 1',
                    content: 'Content 1',
                    listed: true,
                    draft: false,
                    tags: [],
                }),
            }, env);
            expect(res1.status).toBe(200);
            
            const res2 = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Test Feed 2',
                    content: 'Content 2',
                    listed: true,
                    draft: false,
                    tags: [],
                }),
            }, env);
            expect(res2.status).toBe(200);
            
            const listRes = await app.request('/?page=1&limit=10', { method: 'GET' }, env);
            
            expect(listRes.status).toBe(200);
            const data = await listRes.json() as any;
            expect(data.size).toBe(2);
            expect(data.data).toBeArray();
        });

        it('should return empty list when no feeds exist', async () => {
            const res = await app.request('/', { method: 'GET' }, env);
            
            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.size).toBe(0);
            expect(data.data).toEqual([]);
        });

        it('should filter drafts for non-admin users', async () => {
            // Create a draft feed
            await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Draft Feed',
                    content: 'Draft Content',
                    listed: true,
                    draft: true,
                    tags: [],
                }),
            }, env);
            
            const res = await app.request('/?type=draft', { method: 'GET' }, env);
            
            expect(res.status).toBe(403);
        });

        it('should allow admin to view drafts', async () => {
            // Create a draft feed
            await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Draft Feed',
                    content: 'Draft Content',
                    listed: true,
                    draft: true,
                    tags: [],
                }),
            }, env);
            
            const res = await app.request('/?type=draft', {
                method: 'GET',
                headers: { 'Authorization': 'Bearer mock_token_1' },
            }, env);
            
            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.size).toBe(1);
        });
    });

    describe('POST /sort/:id - Custom feed order', () => {
        const adminAuth = {
            'Authorization': 'Bearer mock_token_1',
            'Content-Type': 'application/json',
        };

        async function createPublishedFeed(title: string, createdAt: string) {
            const res = await app.request('/', {
                method: 'POST',
                headers: adminAuth,
                body: JSON.stringify({
                    title,
                    content: `${title} content`,
                    listed: true,
                    draft: false,
                    tags: [],
                    createdAt,
                }),
            }, env);

            expect(res.status).toBe(200);
            const body = await res.json() as { insertedId: number };
            return body.insertedId;
        }

        it('should rank feeds by sort order on the list and timeline and drop cached pages', async () => {
            const oldest = await createPublishedFeed('Oldest', '2024-01-01T00:00:00.000Z');
            const middle = await createPublishedFeed('Middle', '2024-02-01T00:00:00.000Z');
            const newest = await createPublishedFeed('Newest', '2024-03-01T00:00:00.000Z');

            // Populate the public list cache with the default publish-date order.
            const beforeRes = await app.request('/?page=1&limit=10', { method: 'GET' }, env);
            const before = await beforeRes.json() as any;
            expect(before.data.map((feed: any) => feed.title)).toEqual(['Newest', 'Middle', 'Oldest']);

            const sortRes = await app.request(`/sort/${oldest}`, {
                method: 'POST',
                headers: adminAuth,
                body: JSON.stringify({ sortOrder: 5 }),
            }, env);
            expect(sortRes.status).toBe(200);

            const afterRes = await app.request('/?page=1&limit=10', {
                method: 'GET',
                headers: { 'Authorization': 'Bearer mock_token_1' },
            }, env);
            const after = await afterRes.json() as any;
            expect(after.data.map((feed: any) => feed.title)).toEqual(['Oldest', 'Newest', 'Middle']);
            expect(after.data[0].sortOrder).toBe(5);

            const timelineRes = await app.request('/timeline', { method: 'GET' }, env);
            const timeline = await timelineRes.json() as any;
            expect(timeline.map((feed: any) => feed.title)).toEqual(['Oldest', 'Newest', 'Middle']);

            // Reset to 0 so the article falls back to the publish-date order.
            const resetRes = await app.request(`/sort/${oldest}`, {
                method: 'POST',
                headers: adminAuth,
                body: JSON.stringify({ sortOrder: 0 }),
            }, env);
            expect(resetRes.status).toBe(200);

            const resetListRes = await app.request('/?page=1&limit=10', { method: 'GET' }, env);
            const resetList = await resetListRes.json() as any;
            expect(resetList.data.map((feed: any) => feed.title)).toEqual(['Newest', 'Middle', 'Oldest']);
        });

        it('should keep top pinned above the custom order', async () => {
            const first = await createPublishedFeed('First', '2024-04-01T00:00:00.000Z');
            const second = await createPublishedFeed('Second', '2024-05-01T00:00:00.000Z');

            await app.request(`/sort/${first}`, {
                method: 'POST',
                headers: adminAuth,
                body: JSON.stringify({ sortOrder: 10 }),
            }, env);
            await app.request(`/top/${second}`, {
                method: 'POST',
                headers: adminAuth,
                body: JSON.stringify({ top: 1 }),
            }, env);

            const listRes = await app.request('/?page=1&limit=10', { method: 'GET' }, env);
            const list = await listRes.json() as any;
            expect(list.data.map((feed: any) => feed.title)).toEqual(['Second', 'First']);
        });

        it('should reject sorting another user feed without admin permission', async () => {
            const feedId = await createPublishedFeed('Owner only', '2024-06-01T00:00:00.000Z');
            sqlite.exec(`
                INSERT INTO users (id, username, openid, permission) VALUES (2, 'visitor', 'gh_visitor', 0)
            `);

            const res = await app.request(`/sort/${feedId}`, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_2',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ sortOrder: 99 }),
            }, env);

            expect(res.status).toBe(403);
            expect(sqlite.query('SELECT sort_order FROM feeds WHERE id = ?').get(feedId)).toEqual({ sort_order: 0 });
        });
    });

    describe('GET /:id - Get single feed', () => {
        it('should return feed by id', async () => {
            // Create a feed first
            const createRes = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Test Feed',
                    content: 'Test Content',
                    listed: true,
                    draft: false,
                    tags: [],
                }),
            }, env);
            
            expect(createRes.status).toBe(200);
            const createData = await createRes.json() as any;
            const feedId = createData.insertedId;
            
            const getRes = await app.request(`/${feedId}`, { method: 'GET' }, env);
            
            expect(getRes.status).toBe(200);
            const data = await getRes.json() as any;
            expect(data.title).toBe('Test Feed');
        });

        it('should prefer a numeric feed id over another feed numeric alias', async () => {
            const firstRes = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Previous Feed',
                    alias: '2',
                    content: 'Previous Content',
                    listed: true,
                    draft: false,
                    tags: [],
                }),
            }, env);
            expect(firstRes.status).toBe(200);

            const secondRes = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Target Feed',
                    content: 'Target Content',
                    listed: true,
                    draft: false,
                    tags: [],
                }),
            }, env);
            expect(secondRes.status).toBe(200);
            const secondData = await secondRes.json() as any;

            const getRes = await app.request(`/${secondData.insertedId}`, { method: 'GET' }, env);

            expect(getRes.status).toBe(200);
            const data = await getRes.json() as any;
            expect(data.id).toBe(secondData.insertedId);
            expect(data.title).toBe('Target Feed');
            expect(data.content).toBe('Target Content');
        });

        it('should return feed by non-numeric alias', async () => {
            const createRes = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Alias Feed',
                    alias: 'custom-slug',
                    content: 'Alias Content',
                    listed: true,
                    draft: false,
                    tags: [],
                }),
            }, env);

            expect(createRes.status).toBe(200);

            const getRes = await app.request('/custom-slug', { method: 'GET' }, env);

            expect(getRes.status).toBe(200);
            const data = await getRes.json() as any;
            expect(data.title).toBe('Alias Feed');
        });

        it('should return AI summary generation status for a queued feed', async () => {
            await serverConfig.set('ai_summary.enabled', 'true', false);
            await serverConfig.set('ai_summary.provider', 'worker-ai', false);
            await serverConfig.set('ai_summary.model', 'llama-3-8b', false);

            const createRes = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Queued AI Feed',
                    content: 'Queued AI content',
                    listed: true,
                    draft: false,
                    tags: [],
                }),
            }, env);

            const createData = await createRes.json() as any;
            const getRes = await app.request(`/${createData.insertedId}`, { method: 'GET' }, env);

            expect(getRes.status).toBe(200);
            const data = await getRes.json() as any;
            expect(data.ai_summary_status).toBe('pending');
            expect(data.ai_summary_error).toBe('');
        });

        it('should return 404 for non-existent feed', async () => {
            const res = await app.request('/9999', { method: 'GET' }, env);
            
            expect(res.status).toBe(404);
        });

        it('should bypass stale public cache when cache is disabled', async () => {
            await clientConfig.set('cache.enabled', false);
            await clientConfig.set('counter.enabled', false);

            const createRes = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Fresh Feed',
                    content: 'Fresh Content',
                    listed: true,
                    draft: false,
                    tags: [],
                }),
            }, env);

            const createData = await createRes.json() as any;
            await cache.set(`feed_${createData.insertedId}`, {
                id: createData.insertedId,
                title: 'Stale Feed',
                content: 'stale',
                summary: '',
                ai_summary: '',
                ai_summary_status: 'idle',
                ai_summary_error: '',
                draft: 0,
                listed: 1,
                uid: 1,
                alias: null,
                hashtags: [],
                user: { id: 1, username: 'testuser', avatar: 'avatar.png' },
            });

            const getRes = await app.request(`/${createData.insertedId}`, { method: 'GET' }, env);
            const data = await getRes.json() as any;

            expect(data.title).toBe('Fresh Feed');
        });
    });

    describe('POST / - Create feed', () => {
        it('should create feed with admin permission', async () => {
            const res = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'New Test Feed',
                    content: 'This is a new test feed content',
                    listed: true,
                    draft: false,
                    tags: [],
                }),
            }, env);

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.insertedId).toBeDefined();
        });

        it('should require admin permission', async () => {
            // Create app without admin permission
            const res = await app.request('/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Test',
                    content: 'Test',
                    tags: [],
                    draft: false,
                    listed: true,
                }),
            }, env);

            expect(res.status).toBe(403);
        });

        it('should require title', async () => {
            const res = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    content: 'Content without title',
                    tags: [],
                    draft: false,
                    listed: true,
                }),
            }, env);

            expect(res.status).toBe(400);
        });

        it('should require content', async () => {
            const res = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Test',
                    content: '',
                    tags: [],
                    draft: false,
                    listed: true,
                }),
            }, env);

            expect(res.status).toBe(400);
            expect(await res.text()).toBe('Content is required');
        });

        it('should reject invalid contract field types before writing', async () => {
            const res = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Invalid tags',
                    content: 'Content',
                    tags: 'not-an-array',
                    draft: false,
                    listed: true,
                }),
            }, env);

            expect(res.status).toBe(400);
            expect(await res.text()).toBe('tags must be an array');
            expect(sqlite.query('SELECT COUNT(*) AS count FROM feeds').get()).toEqual({ count: 0 });
        });
    });

    describe('POST /:id - Update feed', () => {
        it('should update feed with admin permission', async () => {
            // Create feed first
            const createRes = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Original Title',
                    content: 'Original Content',
                    listed: true,
                    draft: false,
                    tags: [],
                }),
            }, env);
            
            expect(createRes.status).toBe(200);
            const createData = await createRes.json() as any;
            const feedId = createData.insertedId;
            
            const updateRes = await app.request(`/${feedId}`, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Updated Title',
                    content: 'Updated content',
                    listed: true,
                }),
            }, env);

            expect(updateRes.status).toBe(200);
            
            // Verify update
            const getRes = await app.request(`/${feedId}`, { method: 'GET' }, env);
            const data = await getRes.json() as any;
            expect(data.title).toBe('Updated Title');
        });

        it('should return updated content through unchanged alias after edit', async () => {
            await clientConfig.set('counter.enabled', false);

            const createRes = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Alias Title',
                    alias: 'alias-post',
                    content: 'Original alias content',
                    listed: true,
                    draft: false,
                    tags: [],
                }),
            }, env);

            expect(createRes.status).toBe(200);
            const createData = await createRes.json() as any;
            const feedId = createData.insertedId;

            const cachedAliasRes = await app.request('/alias-post', { method: 'GET' }, env);
            expect(cachedAliasRes.status).toBe(200);
            expect(((await cachedAliasRes.json()) as any).content).toBe('Original alias content');

            const updateRes = await app.request(`/${feedId}`, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Alias Title Updated',
                    alias: 'alias-post',
                    content: 'Updated alias content',
                    listed: true,
                }),
            }, env);

            expect(updateRes.status).toBe(200);

            const aliasRes = await app.request('/alias-post', { method: 'GET' }, env);
            expect(aliasRes.status).toBe(200);
            const aliasData = await aliasRes.json() as any;
            expect(aliasData.title).toBe('Alias Title Updated');
            expect(aliasData.content).toBe('Updated alias content');

            const idRes = await app.request(`/${feedId}`, { method: 'GET' }, env);
            expect(idRes.status).toBe(200);
            expect(((await idRes.json()) as any).content).toBe('Updated alias content');
        });

        it('should require admin permission to update', async () => {
            // Create feed first
            const createRes = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Original',
                    content: 'Content',
                    listed: true,
                    draft: false,
                    tags: [],
                }),
            }, env);
            
            expect(createRes.status).toBe(200);
            const createData = await createRes.json() as any;
            const feedId = createData.insertedId;
            
            const updateRes = await app.request(`/${feedId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'New Title',
                    listed: true,
                }),
            }, env);

            expect(updateRes.status).toBe(403);
        });
    });

    describe('DELETE /:id - Delete feed', () => {
        it('should delete feed with admin permission', async () => {
            // Create feed first
            const createRes = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'To Delete',
                    content: 'Content',
                    listed: true,
                    draft: false,
                    tags: [],
                }),
            }, env);
            
            expect(createRes.status).toBe(200);
            const createData = await createRes.json() as any;
            const feedId = createData.insertedId;
            
            const deleteRes = await app.request(`/${feedId}`, {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer mock_token_1' },
            }, env);

            expect(deleteRes.status).toBe(200);
            
            // Verify deletion
            const getRes = await app.request(`/${feedId}`, { method: 'GET' }, env);
            expect(getRes.status).toBe(404);
        });

        it('should require admin permission to delete', async () => {
            // Create feed first
            const createRes = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Test',
                    content: 'Content',
                    listed: true,
                    draft: false,
                    tags: [],
                }),
            }, env);
            
            expect(createRes.status).toBe(200);
            const createData = await createRes.json() as any;
            const feedId = createData.insertedId;
            
            const deleteRes = await app.request(`/${feedId}`, { method: 'DELETE' }, env);

            expect(deleteRes.status).toBe(403);
        });
    });

    describe('Export / Import', () => {
        it('should export feeds with tags, status and sort order', async () => {
            const createRes = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Export A',
                    alias: 'export-a',
                    content: 'Export content A',
                    summary: 'Export summary A',
                    listed: true,
                    draft: false,
                    tags: ['export-tag'],
                }),
            }, env);
            expect(createRes.status).toBe(200);
            const created = await createRes.json() as any;

            await app.request(`/sort/${created.insertedId}`, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ sortOrder: 7 }),
            }, env);
            await app.request(`/top/${created.insertedId}`, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ top: 1 }),
            }, env);

            const exportRes = await app.request('/export', {
                headers: { 'Authorization': 'Bearer mock_token_1' },
            }, env);

            expect(exportRes.status).toBe(200);
            expect(exportRes.headers.get('content-disposition')).toContain('rin-feeds-');

            const payload = await exportRes.json() as any;
            expect(payload.version).toBe(1);
            expect(payload.feeds).toBeArray();

            const item = payload.feeds.find((feed: any) => feed.alias === 'export-a');
            expect(item).toBeDefined();
            expect(item.summary).toBe('Export summary A');
            expect(item.tags).toEqual(['export-tag']);
            expect(item.sortOrder).toBe(7);
            expect(item.top).toBe(1);
            expect(item.draft).toBe(0);
            expect(item.listed).toBe(1);
        });

        it('should import new feeds and skip alias/content duplicates', async () => {
            const existingRes = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Existing',
                    alias: 'existing-alias',
                    content: 'Existing content',
                    listed: true,
                    draft: false,
                    tags: [],
                }),
            }, env);
            expect(existingRes.status).toBe(200);

            const payload = {
                version: 1,
                feeds: [
                    {
                        title: 'Imported New',
                        alias: 'import-new',
                        content: 'Imported content new',
                        summary: 'Imported summary',
                        listed: 1,
                        draft: 0,
                        top: 1,
                        sortOrder: 9,
                        createdAt: '2024-01-01T00:00:00.000Z',
                        updatedAt: '2024-01-02T00:00:00.000Z',
                        tags: ['import-tag'],
                    },
                    {
                        title: 'Duplicate alias',
                        alias: 'existing-alias',
                        content: 'Different content',
                    },
                    {
                        title: 'Duplicate content',
                        content: 'Existing content',
                    },
                ],
            };

            const importRes = await app.request('/import', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            }, env);

            expect(importRes.status).toBe(200);
            const result = await importRes.json() as any;
            expect(result.imported).toBe(1);
            expect(result.skipped).toBe(2);
            expect(result.total).toBe(3);
            expect(result.skippedList.map((item: any) => item.reason).sort()).toEqual(['alias exists', 'content exists']);

            const detailRes = await app.request('/import-new', { method: 'GET' }, env);
            expect(detailRes.status).toBe(200);
            const detail = await detailRes.json() as any;
            expect(detail.title).toBe('Imported New');
            expect(detail.summary).toBe('Imported summary');
            expect(detail.sortOrder).toBe(9);
            expect(detail.top).toBe(1);
            expect(detail.draft).toBe(0);
            expect(detail.hashtags.map((tag: any) => tag.name)).toEqual(['import-tag']);

            const secondImport = await app.request('/import', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload),
            }, env);
            const secondResult = await secondImport.json() as any;
            expect(secondResult.imported).toBe(0);
            expect(secondResult.skipped).toBe(3);
        });

        it('should import from a multipart JSON file', async () => {
            const payload = {
                version: 1,
                feeds: [{
                    title: 'Multipart Feed',
                    alias: 'multipart-feed',
                    content: 'Multipart content',
                    listed: 1,
                    draft: 0,
                    top: 0,
                    sortOrder: 0,
                    tags: ['multipart-tag'],
                }],
            };
            const form = new FormData();
            form.append('data', new File([JSON.stringify(payload)], 'backup.json', { type: 'application/json' }));

            const res = await app.request('/import', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer mock_token_1' },
                body: form,
            }, env);

            expect(res.status).toBe(200);
            const result = await res.json() as any;
            expect(result.imported).toBe(1);
            expect(result.skipped).toBe(0);
        });

        it('should reject import without admin permission', async () => {
            const res = await app.request('/import', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ feeds: [] }),
            }, env);

            expect(res.status).toBe(403);
        });
    });

    describe('Password protection', () => {
        it('hides the body from visitors, unlocks with the right password, and can be removed', async () => {
            const createRes = await app.request('/', {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    title: 'Protected Feed',
                    content: 'Secret body',
                    summary: 'Secret summary',
                    listed: true,
                    draft: false,
                    tags: [],
                    password: 'correct-password',
                }),
            }, env);
            expect(createRes.status).toBe(200);
            const created = await createRes.json() as any;
            const feedId = created.insertedId;

            const publicGet = await app.request(`/${feedId}`, { method: 'GET' }, env);
            expect(publicGet.status).toBe(200);
            const lockedFeed = await publicGet.json() as any;
            expect(lockedFeed.locked).toBe(true);
            expect(lockedFeed.passwordProtected).toBe(true);
            expect(lockedFeed.title).toBe('Protected Feed');
            expect(lockedFeed.content).toBe('');
            expect(lockedFeed.summary).toBe('');
            expect(lockedFeed.ai_summary).toBe('');
            expect(lockedFeed.attachmentCount).toBe(0);
            expect(lockedFeed.passwordHash).toBeUndefined();
            expect(lockedFeed.password_hash).toBeUndefined();

            const listRes = await app.request('/?page=1&limit=10&type=normal', { method: 'GET' }, env);
            expect(listRes.status).toBe(200);
            const list = await listRes.json() as any;
            const listedFeed = list.data.find((item: any) => item.id === feedId);
            expect(listedFeed.passwordProtected).toBe(true);
            expect(listedFeed.summary).toBe('');
            expect(listedFeed.avatar).toBeNull();

            const wrongRes = await app.request(`/${feedId}/unlock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'wrong-password' }),
            }, env);
            expect(wrongRes.status).toBe(401);

            const unlockRes = await app.request(`/${feedId}/unlock`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'correct-password' }),
            }, env);
            expect(unlockRes.status).toBe(200);
            const unlocked = await unlockRes.json() as any;
            expect(unlocked.locked).toBe(false);
            expect(unlocked.content).toBe('Secret body');
            expect(unlocked.summary).toBe('Secret summary');
            expect(unlocked.attachments).toEqual([]);
            // 有密码的文章解锁后必须签发短期附件下载凭证，游客凭它下载附件。
            expect(unlocked.downloadToken).toBeString();
            expect(unlocked.downloadTokenExpiresAt).toBeString();

            // The author still sees the body through the normal detail endpoint.
            const ownerGet = await app.request(`/${feedId}`, {
                method: 'GET',
                headers: { 'Authorization': 'Bearer mock_token_1' },
            }, env);
            expect(ownerGet.status).toBe(200);
            const ownerFeed = await ownerGet.json() as any;
            expect(ownerFeed.locked).toBe(false);
            expect(ownerFeed.content).toBe('Secret body');

            const removeRes = await app.request(`/${feedId}`, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ listed: true, passwordEnabled: false }),
            }, env);
            expect(removeRes.status).toBe(200);

            const reopened = await app.request(`/${feedId}`, { method: 'GET' }, env);
            expect(reopened.status).toBe(200);
            const reopenedFeed = await reopened.json() as any;
            expect(reopenedFeed.locked).toBe(false);
            expect(reopenedFeed.content).toBe('Secret body');

            const enableWithoutPassword = await app.request(`/${feedId}`, {
                method: 'POST',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ listed: true, passwordEnabled: true }),
            }, env);
            expect(enableWithoutPassword.status).toBe(400);
        });
    });
});
