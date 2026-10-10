export * from "./conversations";
export * from "./messages";
export * from "./files";

import * as conversationsApi from "./conversations";
import * as messagesApi from "./messages";
import * as filesApi from "./files";

const api = {
  ...conversationsApi,
  ...messagesApi,
  ...filesApi,
};

export default api;
