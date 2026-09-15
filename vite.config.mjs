import { fileURLToPath, URL } from 'node:url';

import { PrimeVueResolver } from '@primevue/auto-import-resolver';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import Components from 'unplugin-vue-components/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vitejs.dev/config/
export default defineConfig({
    optimizeDeps: {
        noDiscovery: true
    },
    plugins: [
        vue(),
        tailwindcss(),
        Components({
            resolvers: [PrimeVueResolver()]
        }),
        VitePWA({
            registerType: 'prompt',
            injectRegister: null,
            includeAssets: [],
            manifest: {
                id: '/',
                name: 'NEXERP',
                short_name: 'NEXERP',
                description: 'NEXERP 업무관리 시스템',
                lang: 'ko',
                start_url: '/',
                scope: '/',
                display: 'standalone',
                theme_color: '#10b981',
                background_color: '#ffffff',
                icons: [
                    { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
                    { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
                    { src: '/pwa/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
                ]
            },
            workbox: {
                globPatterns: ['index.html', 'assets/*.{js,css,woff,woff2,ttf}'],
                navigateFallback: 'index.html',
                navigateFallbackDenylist: [/^\/api(?:\/|\?|$)/],
                runtimeCaching: [],
                cleanupOutdatedCaches: true,
                skipWaiting: false,
                clientsClaim: false
            }
        })
    ],
    resolve: {
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url))
        }
    },
    test: {
        // Stale worktree copies would otherwise be collected as duplicate suites.
        exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**'],
        // PrimeVue data tables render slowly under jsdom; the default 5s budget is not a product signal.
        testTimeout: 20000
    },
    css: {
        preprocessorOptions: {
            scss: {
                api: 'modern-compiler'
            }
        }
    }
});
