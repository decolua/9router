function time(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

export const log = (msg: string | any, ...args: any[]): void => {
  if (args.length > 0) {
    console.log(`[${time()}] [MITM] ${msg}`, ...args);
  } else {
    console.log(`[${time()}] [MITM] ${msg}`);
  }
};

export const err = (msg: string | any, ...args: any[]): void => {
  if (args.length > 0) {
    console.error(`[${time()}] ❌ [MITM] ${msg}`, ...args);
  } else {
    console.error(`[${time()}] ❌ [MITM] ${msg}`);
  }
};
