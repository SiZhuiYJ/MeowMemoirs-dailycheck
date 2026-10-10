declare module 'pinia-plugin-persistedstate' {
  import { PiniaPluginContext } from 'pinia';
  
  const persist: (context: PiniaPluginContext) => void;
  
  export default persist;
}