import { ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const asText = (value) => (Array.isArray(value) ? value[0] : value);

// Keeps list filters and paging in the URL so a shared link, a browser back, or a reload restores the same view.
export function useQueryState(definitions) {
    const route = useRoute();
    const router = useRouter();
    const entries = Object.entries(definitions).map(([key, definition]) => ({
        key,
        param: definition.param || key,
        fallback: definition.fallback ?? null,
        parse: definition.parse || ((value) => value),
        serialize: definition.serialize || ((value) => (value === null || value === undefined || value === '' ? null : String(value)))
    }));

    const readParam = (entry) => {
        const raw = asText(route.query[entry.param]);
        if (raw === undefined || raw === null || raw === '') return entry.fallback;
        const parsed = entry.parse(raw);
        return parsed === undefined ? entry.fallback : parsed;
    };

    const state = {};
    for (const entry of entries) state[entry.key] = ref(readParam(entry));

    const currentQuery = () => {
        const query = { ...route.query };
        for (const entry of entries) {
            const serialized = entry.serialize(state[entry.key].value);
            const fallback = entry.serialize(entry.fallback);
            if (serialized === null || serialized === fallback) delete query[entry.param];
            else query[entry.param] = serialized;
        }
        return query;
    };

    const sameQuery = (left, right) => {
        const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
        for (const key of keys) if (asText(left[key]) !== asText(right[key])) return false;
        return true;
    };

    let applyingRoute = false;
    // The latest query this composable asked for. Route updates that predate it are stale and must not resurrect old state.
    let pendingQuery = null;

    watch(
        entries.map((entry) => state[entry.key]),
        () => {
            if (applyingRoute) return;
            // Before the router resolves its first location there is nothing to write the query onto.
            if (!route.matched.length) return;
            const next = currentQuery();
            // With a write already in flight the url is about to change, so this state still needs its own replace.
            if (!pendingQuery && sameQuery(next, route.query)) return;
            pendingQuery = next;
            // replace keeps the browser history focused on real navigation instead of every keystroke.
            router
                .replace({ query: next })
                .catch(() => {})
                .finally(() => {
                    if (pendingQuery === next) pendingQuery = null;
                });
        }
    );

    watch(
        () => route.query,
        () => {
            if (pendingQuery && !sameQuery(pendingQuery, route.query)) return;
            pendingQuery = null;
            applyingRoute = true;
            for (const entry of entries) {
                const value = readParam(entry);
                if (state[entry.key].value !== value) state[entry.key].value = value;
            }
            applyingRoute = false;
        }
    );

    const reset = () => {
        for (const entry of entries) state[entry.key].value = entry.fallback;
    };

    return { ...state, reset };
}

export const numberParam = (fallback) => ({
    fallback,
    parse: (value) => {
        const parsed = Number.parseInt(value, 10);
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
    }
});
