import { createDemoErpRepository } from './demoErpRepository';

const requiredMethods = ['listOrders', 'listApprovals', 'listGenericRecords'];
let currentRepository = createDemoErpRepository();

export function getErpRepository() {
    return currentRepository;
}

export function setErpRepository(repository) {
    if (!repository || requiredMethods.some((method) => typeof repository[method] !== 'function')) {
        throw new TypeError('ERP repository must implement listOrders, listApprovals, and listGenericRecords.');
    }

    currentRepository = repository;
}

export function resetErpRepository() {
    currentRepository = createDemoErpRepository();
}
