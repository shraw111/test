import type * as TS from "typescript";
import { createSystem, createVirtualTypeScriptEnvironment, type VirtualTypeScriptEnvironment } from "@typescript/vfs";
import type { Diagnostic, Files } from "./types";

type TypeFiles = Record<string, string>;

const IS_CHECKED = /\.(tsx?|jsx?)$/;

/**
 * Type-checks user files against React and design-system declarations in an
 * in-memory TypeScript environment. The environment is created once (loading
 * libs is the expensive part) and updated incrementally on each check.
 */
export class TypeChecker {
  private env: VirtualTypeScriptEnvironment;
  private known = new Set<string>();
  private knownAmbient = new Set<string>();

  constructor(private ts: typeof TS, typeFiles: TypeFiles) {
    const options: TS.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      lib: ["lib.es2020.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.ReactJSX,
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      allowJs: true,
      checkJs: false,
      types: [],
      esModuleInterop: true,
      resolveJsonModule: true,
    };
    const system = createSystem(new Map(Object.entries(typeFiles)));
    // Root files must exist up front; user files are added by createFile/updateFile.
    const roots = Object.keys(typeFiles).filter((f) => f === "/ambient.d.ts");
    this.env = createVirtualTypeScriptEnvironment(system, roots, ts, options);
  }

  /**
   * `ambient` adds declaration files that are visible to the project but never
   * reported on (absolute paths), e.g. types generated from loaded content.
   */
  check(files: Files, ambient: Record<string, string> = {}): Diagnostic[] {
    for (const path of this.knownAmbient) {
      if (!(path in ambient)) this.env.deleteFile(path);
    }
    for (const [path, content] of Object.entries(ambient)) {
      if (this.env.getSourceFile(path)) this.env.updateFile(path, content);
      else this.env.createFile(path, content);
    }
    this.knownAmbient = new Set(Object.keys(ambient));

    const paths = Object.keys(files).filter((name) => IS_CHECKED.test(name)).map((name) => `/${name}`);

    for (const path of this.known) {
      if (!paths.includes(path)) this.env.deleteFile(path);
    }
    this.known = new Set(paths);
    for (const path of paths) {
      const content = files[path.slice(1)];
      if (this.env.getSourceFile(path)) this.env.updateFile(path, content);
      else this.env.createFile(path, content);
    }

    const diagnostics: Diagnostic[] = [];
    for (const path of paths) {
      // JS files are only parsed, not type-checked (checkJs is off), so they
      // add syntactic diagnostics at most.
      const raw = [
        ...this.env.languageService.getSyntacticDiagnostics(path),
        ...(/\.tsx?$/.test(path) ? this.env.languageService.getSemanticDiagnostics(path) : []),
      ];
      for (const d of raw) diagnostics.push(this.convert(d, path));
    }
    return diagnostics;
  }

  private convert(d: TS.Diagnostic, path: string): Diagnostic {
    const position = d.file && d.start != null ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
    return {
      severity: d.category === this.ts.DiagnosticCategory.Error ? "error" : "warning",
      source: "typescript",
      code: d.code,
      file: path.slice(1),
      line: position ? position.line + 1 : undefined,
      column: position?.character,
      message: this.ts.flattenDiagnosticMessageText(d.messageText, "\n"),
    };
  }
}
