import { Type } from "typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "current_datetime",
    label: "Current Date/Time",
    description: "Get the current date, time, and day of the week using the Linux date command",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, _ctx) {
      const result = await pi.exec("date", ["+" + "%Y-%m-%d %H:%M:%S %A %Z"], { signal, timeout: 5000 });
      if (result.code !== 0) {
        return {
          content: [{ type: "text", text: `Error: ${result.stderr}` }],
          isError: true,
        };
      }
      return {
        content: [{ type: "text", text: result.stdout.trim() }],
      };
    },
  });
}
