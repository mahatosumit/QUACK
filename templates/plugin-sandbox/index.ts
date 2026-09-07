import { type QuackPlugin, type PluginContext } from "@quack/os";

export class CustomPlugin implements QuackPlugin {
  readonly id = "my-custom-plugin";
  readonly version = "1.0.0";

  async onMount(context: PluginContext): Promise<void> {
    // Access the isolated event bus
    context.events.subscribe("workflow.completed", (evt) => {
      console.log("Workflow completed:", evt);
    });

    // Register a sandboxed tool
    context.tools.register({
      id: "custom-echo-tool",
      description: "Echoes input back",
      execute: async (args) => {
        return `Echo: ${args.message}`;
      }
    });
  }

  async onUnmount(): Promise<void> {
    // Cleanup resources
  }
}
