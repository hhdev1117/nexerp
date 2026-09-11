<script setup>
defineProps({
    metrics: {
        type: Array,
        default: () => []
    }
});

const toneClasses = {
    blue: {
        container: 'bg-blue-100 dark:bg-blue-400/10',
        icon: 'text-blue-500'
    },
    orange: {
        container: 'bg-orange-100 dark:bg-orange-400/10',
        icon: 'text-orange-500'
    },
    cyan: {
        container: 'bg-cyan-100 dark:bg-cyan-400/10',
        icon: 'text-cyan-500'
    },
    purple: {
        container: 'bg-purple-100 dark:bg-purple-400/10',
        icon: 'text-purple-500'
    }
};
</script>

<template>
    <div v-for="metric in metrics" :key="metric.label" class="col-span-12 lg:col-span-6 xl:col-span-3">
        <div class="card mb-0 h-full">
            <div class="flex justify-between mb-4">
                <div>
                    <span class="block text-muted-color font-medium mb-4">{{ metric.label }}</span>
                    <Transition name="metric-value" mode="out-in">
                        <div :key="metric.value" class="text-surface-900 dark:text-surface-0 font-medium text-xl">{{ metric.value }}</div>
                    </Transition>
                </div>
                <div class="flex items-center justify-center rounded-border" :class="toneClasses[metric.tone]?.container" style="width: 2.5rem; height: 2.5rem">
                    <i class="pi text-xl!" :class="[metric.icon, toneClasses[metric.tone]?.icon]" aria-hidden="true"></i>
                </div>
            </div>
            <span class="text-primary font-medium">{{ metric.delta }} </span>
            <span class="text-muted-color">{{ metric.note }}</span>
        </div>
    </div>
</template>

<style scoped>
.metric-value-enter-active,
.metric-value-leave-active {
    transition:
        opacity 0.2s ease,
        transform 0.2s ease;
}

.metric-value-enter-from {
    opacity: 0;
    transform: translateY(0.25rem);
}

.metric-value-leave-to {
    opacity: 0;
    transform: translateY(-0.25rem);
}
</style>
