declare module '@homebridge/node-pty-prebuilt-multiarch' {
  export function spawn(
    shell: string,
    args: string[],
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
    },
  ): {
    onData: (handler: (data: string) => void) => { dispose: () => void };
    onExit: (
      handler: (e: { exitCode: number; signal?: number }) => void,
    ) => { dispose: () => void };
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    kill: (signal?: string) => void;
    pid: number;
  };
}
