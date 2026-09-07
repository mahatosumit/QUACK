# Hello World Plugin

A minimal QUACK plugin that registers a greeting command.

## Structure

```
hello-world-plugin/
  index.js        # Plugin implementation
  package.json    # Plugin manifest
```

## Usage

```bash
# Load the plugin
node dist/cli.js start --goal "Load plugin from examples/hello-world-plugin"
```

## Plugin Manifest (`package.json`)

```json
{
  "name": "hello-world-plugin",
  "version": "1.0.0",
  "description": "A simple greeting plugin",
  "quack": {
    "type": "plugin",
    "api": "1.0",
    "hooks": ["onReady"]
  }
}
```

## Plugin Implementation (`index.js`)

```javascript
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
```
