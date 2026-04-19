# Unsafe command execution

Avoid shell interpolation for external commands.

Bad:
```ts
await exec(`bd list --all --format json --cwd ${projectPath}`);
```

Good:
```ts
await execFile("bd", ["list", "--all", "--format", "json"], { cwd: projectPath });
```
