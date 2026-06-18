declare module 'inquirer' {
  interface PromptQuestion {
    type: string;
    name: string;
    message: string;
    choices?: Array<{ name: string; value: unknown } | string | unknown>;
    validate?: (input: string) => boolean | string;
  }

  class Separator {
    constructor(line?: string);
  }

  interface Inquirer {
    prompt<T = Record<string, unknown>>(questions: PromptQuestion[]): Promise<T>;
    Separator: typeof Separator;
  }

  const inquirer: Inquirer;
  export default inquirer;
}
