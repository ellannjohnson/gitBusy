export const gitignoreTemplates = {
  Node: `node_modules\ndist\n.env\n.DS_Store\n`,
  Python: `__pycache__/\n*.pyc\n.venv/\n.env\n.DS_Store\n`,
  Go: `*.exe\n*.dll\n*.so\n*.dylib\n.bin/\n`,
  Java: `target/\n*.class\n*.jar\n.DS_Store\n`,
  Empty: `\n`,
} as const

export type GitignoreTemplate = keyof typeof gitignoreTemplates
