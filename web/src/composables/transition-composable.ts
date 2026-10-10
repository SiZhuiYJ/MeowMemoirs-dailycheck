import { reactive } from 'vue';

const transitionState = reactive<{
    transitionComplete: boolean | null;
}>({
    transitionComplete: null,
});

export const useTransitionComposable = () => {
    const toggleTransitionComplete = (value: boolean) => {
        transitionState.transitionComplete = value;
    };

    return {
        transitionState,
        toggleTransitionComplete,
    };
};