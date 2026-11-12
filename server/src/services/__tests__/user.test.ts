import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { UserService } from '../user';
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { Variables, JWTUtils, OAuth2Utils } from "../../core/hono-types";
import { setupTestApp, TestCacheImpl, cleanupTestDB, createMockEnv } from '../../../tests/fixtures';
import { hashEmailCode } from '../../utils/email-verification';
import type { Database } from 'bun:sqlite';

describe('UserService', () => {
    let db: any;
    let sqlite: Database;
    let env: Env;
    let app: Hono<{ Bindings: Env; Variables: Variables }>;

    beforeEach(async () => {
        const ctx = await setupTestApp(UserService);
        db = ctx.db;
        sqlite = ctx.sqlite;
        env = ctx.env;
        app = ctx.app;
        
        // Add error handler
        app.onError((err, c) => {
            const error = err as any;
            if (error.code && error.statusCode) {
                return c.json({
                    success: false,
                    error: {
                        code: error.code,
                        message: error.message,
                        details: error.details,
                    },
                }, error.statusCode as any);
            }
            return c.json({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: err.message || 'An unexpected error occurred',
                },
            }, 500);
        });
        
        // Seed test data
        await seedTestData(sqlite);
    });

    afterEach(() => {
        cleanupTestDB(sqlite);
    });

    async function seedTestData(sqlite: Database) {
        sqlite.exec(`
            INSERT INTO users (id, username, avatar, permission, openid) VALUES 
                (1, 'user1', 'avatar1.png', 0, 'gh_123'),
                (2, 'admin', 'admin.png', 1, 'gh_456')
        `);
    }

    describe('GET /github - Initiate GitHub OAuth', () => {
        it('should redirect to GitHub OAuth', async () => {
            const res = await app.request('/github', {
                method: 'GET',
                headers: { 'Referer': 'http://localhost:5173/' }
            }, env);
            
            expect(res.status).toBe(302);
            const location = res.headers.get('Location');
            expect(location).toContain('github.com');
            expect(location).toContain('state=');
        });

        it('should require referer header', async () => {
            const res = await app.request('/github', { method: 'GET' }, env);
            
            expect(res.status).toBe(400);
            const data = await res.json() as { error: { message: string } };
            expect(data.error.message).toBe('Referer header is required');
        });

        it('should return 400 if OAuth not configured', async () => {
            const envNoOAuth = createMockEnv({
                RIN_GITHUB_CLIENT_ID: '',
                RIN_GITHUB_CLIENT_SECRET: '',
            });
            
            const appNoOAuth = new Hono<{ Bindings: Env; Variables: Variables }>();
            appNoOAuth.use(createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
                c.set('db', db);
                c.set('cache', new TestCacheImpl());
                c.set('serverConfig', new TestCacheImpl());
                c.set('clientConfig', new TestCacheImpl());
                c.set('jwt', {
                    sign: async (payload: any) => `mock_token_${payload.id}`,
                    verify: async (token: string) => null,
                } as JWTUtils);
                c.set('oauth2', undefined);
                c.set('env', envNoOAuth);
                await next();
            }));
            appNoOAuth.route('/', UserService());
            
            // Error handler for appNoOAuth
            appNoOAuth.onError((err, c) => {
                const error = err as any;
                if (error.code && error.statusCode) {
                    return c.json({
                        success: false,
                        error: {
                            code: error.code,
                            message: error.message,
                            details: error.details,
                        },
                    }, error.statusCode as any);
                }
                return c.json({
                    success: false,
                    error: {
                        code: 'INTERNAL_ERROR',
                        message: err.message || 'An unexpected error occurred',
                    },
                }, 500);
            });
            
            const res = await appNoOAuth.request('/github', {
                method: 'GET',
                headers: { 'Referer': 'http://localhost:5173/' }
            }, envNoOAuth);
            
            expect(res.status).toBe(400);
            const data = await res.json() as { error: { message: string } };
            expect(data.error.message).toBe('GitHub OAuth is not configured');
        });

        it('should set redirect_to cookie', async () => {
            const res = await app.request('/github', {
                method: 'GET',
                headers: { 'Referer': 'http://localhost:5173/feed/123' }
            }, env);
            
            expect(res.status).toBe(302);
            const setCookie = res.headers.get('Set-Cookie');
            expect(setCookie).toContain('redirect_to');
        });
    });

    describe('GET /github/callback - GitHub OAuth callback', () => {
        it('should authenticate existing user', async () => {
            const originalFetch = global.fetch;
            global.fetch = async () => {
                return new Response(JSON.stringify({
                    id: 'gh_123',
                    login: 'user1',
                    name: 'User One',
                    avatar_url: 'https://github.com/avatar.png'
                }), { status: 200 });
            };

            try {
                const res = await app.request('/github/callback?code=valid_code&state=mock_state', {
                    method: 'GET',
                    headers: {
                        'Cookie': 'state=mock_state; redirect_to=http://localhost:5173/callback'
                    }
                }, env);
                
                expect(res.status).toBe(302);
                const location = res.headers.get('Location');
                expect(location).toContain('/callback');
            } finally {
                global.fetch = originalFetch;
            }
        });

        it('should reject invalid state', async () => {
            const res = await app.request('/github/callback?code=valid_code&state=wrong_state', {
                method: 'GET',
                headers: {
                    'Cookie': 'state=mock_state; redirect_to=http://localhost:5173/callback'
                }
            }, env);
            
            expect(res.status).toBe(400);
            const data = await res.json() as { error: { message: string } };
            expect(data.error.message).toBe('Invalid state parameter');
        });
    });

    describe('GET /profile - Get user profile', () => {
        it('should return user profile', async () => {
            const res = await app.request('/profile', {
                method: 'GET',
                headers: { 'Authorization': 'Bearer mock_token_1' }
            }, env);
            
            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.id).toBe(1);
            expect(data.username).toBe('user1');
            expect(data.avatar).toBe('avatar1.png');
            expect(data.permission).toBe(false);
        });

        it('should return admin permission for admin user', async () => {
            const res = await app.request('/profile', {
                method: 'GET',
                headers: { 'Authorization': 'Bearer mock_token_2' }
            }, env);
            
            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.permission).toBe(true);
        });

        it('should require authentication', async () => {
            const res = await app.request('/profile', { method: 'GET' }, env);
            
            expect(res.status).toBe(403);
        });
    });

    describe('PUT /profile - Update profile', () => {
        it('should update username', async () => {
            const res = await app.request('/profile', {
                method: 'PUT',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username: 'newname' }),
            }, env);
            
            expect(res.status).toBe(200);
            
            // Verify update
            const dbResult = sqlite.prepare(`SELECT username FROM users WHERE id = 1`).all() as any[];
            expect(dbResult[0]?.username).toBe('newname');
        });

        it('should update avatar', async () => {
            const res = await app.request('/profile', {
                method: 'PUT',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ avatar: 'https://new-avatar.png' }),
            }, env);
            
            expect(res.status).toBe(200);
            
            const dbResult = sqlite.prepare(`SELECT avatar FROM users WHERE id = 1`).all() as any[];
            expect(dbResult[0]?.avatar).toBe('https://new-avatar.png');
        });

        it('should change email only after a valid code is consumed', async () => {
            const codeHash = await hashEmailCode(env.JWT_SECRET!, 'new@example.com', 'email_change', '123456');
            sqlite.prepare(
                'INSERT INTO email_verifications (email, purpose, code_hash, expires_at, attempts) VALUES (?, ?, ?, ?, 0)',
            ).run('new@example.com', 'email_change', codeHash, Math.floor(Date.now() / 1000) + 600);

            const res = await app.request('/profile', {
                method: 'PUT',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email: 'new@example.com', emailCode: '123456' }),
            }, env);

            expect(res.status).toBe(200);
            const saved = sqlite.prepare(
                'SELECT email, email_verified_at FROM users WHERE id = 1',
            ).get() as { email: string; email_verified_at: number | null };
            expect(saved.email).toBe('new@example.com');
            expect(saved.email_verified_at).not.toBeNull();
        });

        it('should set a password for a user without one', async () => {
            const res = await app.request('/profile', {
                method: 'PUT',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ newPassword: 'password123' }),
            }, env);

            expect(res.status).toBe(200);
            const saved = sqlite.prepare('SELECT password FROM users WHERE id = 1').get() as { password: string };
            expect(saved.password.startsWith('v1:')).toBe(true);
        });

        it('should require authentication', async () => {
            const res = await app.request('/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: 'test' }),
            }, env);
            
            expect(res.status).toBe(403);
        });

        it('should require at least one field', async () => {
            const res = await app.request('/profile', {
                method: 'PUT',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({}),
            }, env);
            
            expect(res.status).toBe(400);
        });
    });

    describe('GET /admin/list - Admin user list', () => {
        it('returns users without password hashes for an admin', async () => {
            const res = await app.request('/admin/list', {
                method: 'GET',
                headers: { 'Authorization': 'Bearer mock_token_2' },
            }, env);

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.data).toHaveLength(2);
            expect(data.data[0].password).toBeUndefined();
            expect(data.data[0].hasPassword).toBe(false);
        });

        it('rejects a non-admin user', async () => {
            const res = await app.request('/admin/list', {
                method: 'GET',
                headers: { 'Authorization': 'Bearer mock_token_1' },
            }, env);

            expect(res.status).toBe(401);
        });

        it('filters by username or email', async () => {
            const res = await app.request('/admin/list?search=admin', {
                method: 'GET',
                headers: { 'Authorization': 'Bearer mock_token_2' },
            }, env);

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.data).toHaveLength(1);
            expect(data.data[0].username).toBe('admin');
        });
    });

    describe('PUT /admin/:id - Admin update user', () => {
        it('updates username, email, password and permission', async () => {
            const res = await app.request('/admin/1', {
                method: 'PUT',
                headers: {
                    'Authorization': 'Bearer mock_token_2',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    username: 'member',
                    email: 'Member@Example.com',
                    avatar: 'https://example.com/avatar.png',
                    newPassword: 'newpassword123',
                    permission: true,
                }),
            }, env);

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.success).toBe(true);
            expect(data.user.username).toBe('member');
            expect(data.user.email).toBe('member@example.com');
            expect(data.user.emailVerified).toBe(true);
            expect(data.user.hasPassword).toBe(true);
            expect(data.user.permission).toBe(true);
            expect(data.user.password).toBeUndefined();

            const row = sqlite.prepare('SELECT username, email, email_verified_at, password, permission, avatar FROM users WHERE id = 1').get() as any;
            expect(row.username).toBe('member');
            expect(row.email).toBe('member@example.com');
            expect(row.email_verified_at).not.toBeNull();
            expect(row.permission).toBe(1);
            expect(row.avatar).toBe('https://example.com/avatar.png');
            expect(row.password.startsWith('v1:')).toBe(true);
        });

        it('rejects a non-admin without changing the target', async () => {
            const res = await app.request('/admin/1', {
                method: 'PUT',
                headers: {
                    'Authorization': 'Bearer mock_token_1',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username: 'hacked' }),
            }, env);

            expect(res.status).toBe(401);
            const row = sqlite.prepare('SELECT username FROM users WHERE id = 1').get() as any;
            expect(row.username).toBe('user1');
        });

        it('rejects the reserved admin username', async () => {
            const res = await app.request('/admin/1', {
                method: 'PUT',
                headers: {
                    'Authorization': 'Bearer mock_token_2',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username: 'admin' }),
            }, env);

            expect(res.status).toBe(409);
            const row = sqlite.prepare('SELECT username FROM users WHERE id = 1').get() as any;
            expect(row.username).toBe('user1');
        });

        it('rejects removing the acting admin permission', async () => {
            const res = await app.request('/admin/2', {
                method: 'PUT',
                headers: {
                    'Authorization': 'Bearer mock_token_2',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ permission: false }),
            }, env);

            expect(res.status).toBe(400);
            const row = sqlite.prepare('SELECT permission FROM users WHERE id = 2').get() as any;
            expect(row.permission).toBe(1);
        });

        it('can clear an email after setting one', async () => {
            await app.request('/admin/1', {
                method: 'PUT',
                headers: {
                    'Authorization': 'Bearer mock_token_2',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email: 'temp@example.com' }),
            }, env);

            const res = await app.request('/admin/1', {
                method: 'PUT',
                headers: {
                    'Authorization': 'Bearer mock_token_2',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email: '' }),
            }, env);

            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data.user.email).toBeNull();
            expect(data.user.emailVerified).toBe(false);
        });
    });

    describe('POST /logout - Logout', () => {
        it('should clear token cookie', async () => {
            const res = await app.request('/logout', { method: 'POST' }, env);
            
            expect(res.status).toBe(200);
            const data = await res.json() as any;
            expect(data).toBeDefined();
        });
    });
});
