import { createDemoErpRepository } from './demoErpRepository';

// Every ERP data source must implement this asynchronous contract. Reads return plain arrays;
// writes return the persisted record so callers never guess server-assigned fields.
export const ERP_REPOSITORY_METHODS = Object.freeze(['listOrders', 'createOrder', 'updateOrder', 'deleteOrder', 'listApprovals', 'updateApprovalStatus', 'listGenericRecords', 'createGenericRecord']);

const describeMethods = (methods) => `${methods.slice(0, -1).join(', ')}, and ${methods.at(-1)}`;

let currentRepository = createDemoErpRepository();

export function getErpRepository() {
    return currentRepository;
}

export function setErpRepository(repository) {
    if (!repository || ERP_REPOSITORY_METHODS.some((method) => typeof repository[method] !== 'function')) {
        throw new TypeError(`ERP repository must implement ${describeMethods(ERP_REPOSITORY_METHODS)}.`);
    }

    currentRepository = repository;
}

export function resetErpRepository() {
    currentRepository = createDemoErpRepository();
}
