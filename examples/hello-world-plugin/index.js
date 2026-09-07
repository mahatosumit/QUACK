export default {
  name: "hello-world",
  version: "1.0.0",

  onReady(context) {
    console.log("Hello World plugin loaded!");
    context.events.on("greet", (event) => {
      console.log(`Hello, ${event.name}!`);
    });
  },
};
