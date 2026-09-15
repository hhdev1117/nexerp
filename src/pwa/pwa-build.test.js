import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';

let outputDirectory;
const readOutput = (name) => {
    const path = join(outputDirectory, name);
    return existsSync(path) ? readFileSync(path) : null;
};

beforeAll(async () => {
    const cacheDirectory = resolve('.cache');
    mkdirSync(cacheDirectory, { recursive: true });
    outputDirectory = mkdtempSync(join(cacheDirectory, 'pwa-test-'));
    await build({ configFile: resolve('vite.config.mjs'), logLevel: 'silent', build: { outDir: outputDirectory, emptyOutDir: true } });
}, 90000);

afterAll(() => {
    if (outputDirectory?.startsWith(join(resolve('.cache'), 'pwa-test-'))) rmSync(outputDirectory, { recursive: true, force: true });
});

describe('PWA build output', () => {
    it('publishes an installable standalone NEXERP manifest linked from the app shell', () => {
        const manifest = JSON.parse(readOutput('manifest.webmanifest')?.toString() || '{}');
        expect(manifest).toMatchObject({ name: 'NEXERP', short_name: 'NEXERP', display: 'standalone', start_url: '/', scope: '/', theme_color: '#10b981', background_color: '#ffffff' });
        expect(readOutput('index.html').toString()).toContain('href="/manifest.webmanifest"');
        expect(manifest.icons).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png' }),
                expect.objectContaining({ src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png' }),
                expect.objectContaining({ src: '/pwa/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' })
            ])
        );
    });

    it.each([
        ['icon-192.png', 192],
        ['icon-512.png', 512],
        ['maskable-512.png', 512]
    ])('publishes a real PNG with the required dimensions: %s', (name, size) => {
        const bytes = readOutput(`pwa/${name}`);
        expect(bytes).not.toBeNull();
        expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
        expect(bytes.readUInt32BE(16)).toBe(size);
        expect(bytes.readUInt32BE(20)).toBe(size);
    });

    it('precaches only app shell assets and never registers runtime data caching', () => {
        const source = readOutput('sw.js');
        expect(source).not.toBeNull();
        const precached = [];
        const routes = [];
        let skipWaitingCalled = false;
        let clientsClaimCalled = false;
        const workbox = {
            precacheAndRoute(entries) {
                precached.push(...entries);
            },
            cleanupOutdatedCaches() {},
            skipWaiting() {
                skipWaitingCalled = true;
            },
            clientsClaim() {
                clientsClaimCalled = true;
            },
            createHandlerBoundToURL(url) {
                return { url };
            },
            NavigationRoute: class {
                constructor(handler, options) {
                    this.handler = handler;
                    this.options = options;
                }
            },
            registerRoute(route) {
                routes.push(route);
            }
        };
        const define = (_dependencies, factory) => factory(workbox);
        runInNewContext(source.toString(), {
            define,
            self: {
                define,
                addEventListener() {},
                skipWaiting() {
                    skipWaitingCalled = true;
                }
            }
        });

        expect(precached.length).toBeGreaterThan(0);
        const precachedUrls = precached.map(({ url }) => url);
        expect(new Set(precachedUrls).size).toBe(precachedUrls.length);
        expect(precachedUrls.filter((url) => url.startsWith('pwa/')).sort()).toEqual(['pwa/icon-192.png', 'pwa/icon-512.png', 'pwa/maskable-512.png']);
        expect(precached.some(({ url }) => url === 'index.html')).toBe(true);
        for (const { url } of precached) {
            expect(url).toMatch(/^(index\.html|manifest\.webmanifest|pwa\/[\w-]+\.png|assets\/[\w.-]+\.(?:js|css|woff2?|ttf))$/);
        }
        expect(routes).toHaveLength(1);
        expect(routes[0].handler.url).toBe('index.html');
        for (const pathname of ['/api', '/api/me', '/api/admin/accounts', '/api/admin/infrastructure/usage?range=24h']) {
            expect(routes[0].options.denylist.some((pattern) => pattern.test(pathname))).toBe(true);
        }
        expect(routes[0].options.denylist.some((pattern) => pattern.test('/sales/orders'))).toBe(false);
        expect(skipWaitingCalled).toBe(true);
        expect(clientsClaimCalled).toBe(true);
    });

    it('registers the generated service worker without an application prompt', () => {
        const shell = readOutput('index.html')?.toString() || '';
        const registration = readOutput('registerSW.js')?.toString() || '';

        expect(shell).toContain('src="/registerSW.js"');
        expect(registration).toContain("navigator.serviceWorker.register('/sw.js'");
    });

    it('ships Cloudflare revalidation headers for the service worker and manifest', () => {
        const source = readOutput('_headers')?.toString() || '';
        const rules = new Map();
        let path;
        for (const line of source.split(/\r?\n/)) {
            if (line.startsWith('/')) {
                path = line.trim();
                rules.set(path, {});
            } else if (line.trim() && path) {
                const separator = line.indexOf(':');
                rules.get(path)[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
            }
        }
        expect(rules.get('/sw.js')?.['cache-control']).toBe('no-cache, no-store, must-revalidate');
        expect(rules.get('/manifest.webmanifest')?.['cache-control']).toBe('no-cache');
    });
});
