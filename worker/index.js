import { createWorkerApp } from './app';

export default {
    fetch: createWorkerApp().fetch
};
