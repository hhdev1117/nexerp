import { erpMenu, flattenMenuRoutes } from '@/data/erp';
import AppLayout from '@/layout/AppLayout.vue';
import { createRouter, createWebHistory } from 'vue-router';

const dedicatedViews = {
    '/': () => import('@/views/Dashboard.vue'),
    '/approvals': () => import('@/views/erp/Approvals.vue'),
    '/sales/orders': () => import('@/views/erp/SalesOrders.vue'),
    '/inventory/stock': () => import('@/views/erp/InventoryStock.vue'),
    '/finance/summary': () => import('@/views/erp/FinanceSummary.vue')
};

const routeName = (path) => (path === '/' ? 'dashboard' : path.slice(1).replaceAll('/', '-'));

const erpRoutes = flattenMenuRoutes(erpMenu).map((item) => ({
    path: item.to,
    name: routeName(item.to),
    component: dedicatedViews[item.to] || (() => import('@/views/erp/GenericModule.vue')),
    meta: {
        title: item.label,
        description: item.description,
        icon: item.icon
    }
}));

const router = createRouter({
    history: createWebHistory(),
    scrollBehavior: () => ({ top: 0 }),
    routes: [
        {
            path: '/',
            component: AppLayout,
            children: erpRoutes
        },
        {
            path: '/:pathMatch(.*)*',
            name: 'notfound',
            component: () => import('@/views/pages/NotFound.vue')
        }
    ]
});

router.afterEach((to) => {
    document.title = to.meta.title ? `${to.meta.title} | Sakai ERP` : 'Sakai ERP';
});

export default router;
