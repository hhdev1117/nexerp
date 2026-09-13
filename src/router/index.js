import { erpMenu, flattenMenuRoutes } from '@/data/erp';
import AppLayout from '@/layout/AppLayout.vue';
import { useAccessStore } from '@/stores/access';
import { useAuthStore } from '@/stores/auth';
import { createRouter, createWebHistory } from 'vue-router';
import { createAuthGuard } from './authGuard';

const dedicatedViews = {
    '/': () => import('@/views/Dashboard.vue'),
    '/approvals': () => import('@/views/erp/Approvals.vue'),
    '/sales/orders': () => import('@/views/erp/SalesOrders.vue'),
    '/inventory/stock': () => import('@/views/erp/InventoryStock.vue'),
    '/finance/summary': () => import('@/views/erp/FinanceSummary.vue'),
    '/settings/accounts': () => import('@/views/admin/AccountManagement.vue'),
    '/settings/menu-permissions': () => import('@/views/admin/MenuPermissionManagement.vue'),
    '/settings/infrastructure-usage': () => import('@/views/admin/InfrastructureUsage.vue')
};

const routeName = (path) => (path === '/' ? 'dashboard' : path.slice(1).replaceAll('/', '-'));

const erpRoutes = flattenMenuRoutes(erpMenu).map((item) => ({
    path: item.to,
    name: routeName(item.to),
    component: dedicatedViews[item.to] || (() => import('@/views/erp/GenericModule.vue')),
    meta: {
        title: item.label,
        description: item.description,
        icon: item.icon,
        menuKey: item.menuKey,
        ...(['/settings/accounts', '/settings/menu-permissions', '/settings/infrastructure-usage'].includes(item.to) ? { roles: ['admin'], fixedAccess: true } : {})
    }
}));

const router = createRouter({
    history: createWebHistory(),
    scrollBehavior: () => ({ top: 0 }),
    routes: [
        {
            path: '/auth/login',
            name: 'login',
            component: () => import('@/views/auth/LoginView.vue'),
            meta: { title: '로그인', public: true, guestOnly: true }
        },
        {
            path: '/auth/setup',
            name: 'setup-required',
            component: () => import('@/views/auth/SetupRequiredView.vue'),
            meta: { title: '연결 설정', public: true }
        },
        {
            path: '/auth/mfa',
            name: 'mfa',
            component: () => import('@/views/auth/MfaView.vue'),
            meta: { title: '2단계 인증', public: true }
        },
        {
            path: '/auth/access-denied',
            name: 'access-denied',
            component: () => import('@/views/auth/AccessDeniedView.vue'),
            meta: { title: '접근 권한 없음' }
        },
        {
            path: '/',
            component: AppLayout,
            children: [
                ...erpRoutes,
                { path: '/settings/security', name: 'settings-security', component: () => import('@/views/admin/SecuritySettings.vue'), meta: { title: '2단계 인증 관리' } }
            ]
        },
        {
            path: '/:pathMatch(.*)*',
            name: 'notfound',
            component: () => import('@/views/pages/NotFound.vue')
        }
    ]
});

router.beforeEach(createAuthGuard(useAuthStore(), useAccessStore()));

router.afterEach((to) => {
    document.title = to.meta.title ? `${to.meta.title} | NEXERP` : 'NEXERP';
});

export default router;
