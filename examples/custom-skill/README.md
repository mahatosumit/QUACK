# Custom Skill Example

A QUACK skill that performs text summarization.

## Usage

```bash
node dist/cli.js start --goal "Summarize the following text using custom-skill"
```

## Structure

A skill is a class that implements the `Skill` interface with `execute()` and `getManifest()` methods.

```typescript
import { type Skill, type SkillManifest } from "../../src/skills/skill.js";

export class SummarizeSkill implements Skill {
  getManifest(): SkillManifest {
    return {
      id: "custom.summarize",
      name: "Summarize",
      version: "1.0.0",
      description: "Summarizes input text",
      capabilities: ["text-processing", "summarization"],
    };
  }

  async execute(input: string): Promise<string> {
    // Your summarization logic here
    const sentences = input.split(".");
    const summary = sentences.slice(0, 3).join(".") + ".";
    return summary;
  }
}
```
