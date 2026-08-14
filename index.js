import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerTransientTools } from "./core.js";

const plugin = definePluginEntry({
  id: "transient-tools",
  name: "Transient Tool Context",
  description:
    "Keeps recent tool interactions in bounded process memory and out of persistent OpenClaw session transcripts.",
  register(api) {
    registerTransientTools(api);
  }
});

export { registerTransientTools } from "./core.js";
export * from "./core.js";
export default plugin;
