import { createSSRApp } from "vue";
import { createPinia } from 'pinia';
import App from "./App.vue";
import { useAuthStore } from './stores/auth';
import { setAuthStore } from './libs/http';

export function createApp() {
  const app = createSSRApp(App);
  const pinia = createPinia();
  app.use(pinia);
  
  // Inject auth store into http utility to avoid circular dependency
  const auth = useAuthStore(pinia);
  setAuthStore(auth);

  return {
    app,
    pinia,
  };
}
