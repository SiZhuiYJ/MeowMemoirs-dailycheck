
// import auth from "./modules/auth";
import type { App, Directive } from "vue";
import waterMarker from "./modules/waterMarker";
import draggable from "./modules/draggable";
import debounce from "./modules/debounce";
import debounceInput from "./modules/debounceInput";
import throttle from "./modules/throttle";
import throttleInput from "./modules/throttleInput";
import adaptive from "./modules/adaptive";
import adaptiveTree from "./modules/adaptiveTree";
import copy from "./modules/copy";
import videoPlay from "./modules/videoplay";
import viewport from './modules/viewport'
import slideIn from "./modules/slideIn";
import progressive from "./modules/progressive";

const directivesList: { [key: string]: Directive } = {
  // auth,
  waterMarker,
  draggable,
  debounce,
  debounceInput,
  throttle,
  throttleInput,
  adaptive,
  adaptiveTree,
  copy,
  videoPlay,
  viewport,
  slideIn,
  progressive,
};

const directives = {
  install: function (app: App<Element>) {
    Object.keys(directivesList).forEach((key) => {
      // 注册所有自定义指令
      const directive = directivesList[key];
      if (directive) {
        app.directive(key, directive);
      }
    });
  },
};

export default directives;
